const fs = require('fs')
const os = require('os')
const path = require('path')
const { EJSON } = require('bson')
const { MongoClient } = require('mongodb')
const {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCopyCommand,
} = require('@aws-sdk/client-s3')

const APPLY = process.argv.includes('--apply')
const COLLECTIONS = [
  'category_enums',
  'genre_enums',
  'cast_enums',
  'video_uploads',
  'poster_images',
  'trailers',
  'videos',
  'seasons',
  'episodes',
  'sub_titles',
  'ads',
  'upcomings',
]
const FORBIDDEN = /(user|admin-notification|client|auth|session|token|subscription|payment|wallet|gift|payout|comment|like|rating|watch|search|suggest|notification|device|interest|vote|donat|subscriber|live)/i
const MAX_SINGLE_COPY = 5 * 1024 ** 3
const COPY_PART_SIZE = 512 * 1024 ** 2

for (const name of COLLECTIONS) {
  if (FORBIDDEN.test(name)) throw new Error(`Forbidden migration collection: ${name}`)
}

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sourceMongoUrl = required('SOURCE_MONGO_URL')
const destinationMongoUrl = required('DEST_MONGO_URL')
const sourceDbName = process.env.SOURCE_MONGO_DB_NAME || 'reeplayDB'
const destinationDbName = process.env.DEST_MONGO_DB_NAME || 'reeplayDB'
const sourceRegion = required('SOURCE_S3_REGION')
const destinationRegion = required('DEST_S3_REGION')
const destinationBucket = required('DEST_S3_BUCKET')

const sourceS3 = new S3Client({ region: sourceRegion })
const copyS3 = new S3Client({ region: destinationRegion })
const destinationS3 = new S3Client({
  region: destinationRegion,
  credentials: {
    accessKeyId: required('DEST_S3_ACCESS_KEY'),
    secretAccessKey: required('DEST_S3_SECRET_KEY'),
  },
})

const encodeCopySource = (bucket, key) =>
  `${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`

const addMediaReference = (references, bucket, key) => {
  if (typeof bucket !== 'string' || typeof key !== 'string') return
  references.set(`${bucket}\u0000${key}`, { bucket, key })
}

const collectMediaReferences = (value, references, inheritedBucket) => {
  if (Array.isArray(value)) {
    value.forEach(item => collectMediaReferences(item, references, inheritedBucket))
    return
  }
  if (!value || typeof value !== 'object') return

  const bucket = value.Bucket || value.bucket || inheritedBucket
  const key = value.Key || value.key
  addMediaReference(references, bucket, key)
  if (bucket && Array.isArray(value.resolutions)) {
    value.resolutions.forEach(resolution => addMediaReference(references, bucket, resolution?.key))
  }
  Object.values(value).forEach(item => collectMediaReferences(item, references, bucket))
}

const rewriteMediaPointers = (value, inheritedBucket) => {
  if (Array.isArray(value)) {
    value.forEach(item => rewriteMediaPointers(item, inheritedBucket))
    return
  }
  if (!value || typeof value !== 'object') return

  const localBucket = value.Bucket || value.bucket || inheritedBucket
  if (typeof (value.Key || value.key) === 'string' && typeof localBucket === 'string') {
    if (Object.prototype.hasOwnProperty.call(value, 'Bucket')) value.Bucket = destinationBucket
    if (Object.prototype.hasOwnProperty.call(value, 'bucket')) value.bucket = destinationBucket
  }
  if (Array.isArray(value.resolutions) && typeof localBucket === 'string') {
    if (Object.prototype.hasOwnProperty.call(value, 'bucket')) value.bucket = destinationBucket
    if (Object.prototype.hasOwnProperty.call(value, 'Bucket')) value.Bucket = destinationBucket
  }
  Object.values(value).forEach(item => rewriteMediaPointers(item, localBucket))
}

const transformDocument = (collection, document, destinationAdminId) => {
  const cloned = EJSON.parse(EJSON.stringify(document))
  rewriteMediaPointers(cloned)

  if (collection === 'videos') {
    cloned.adminId = destinationAdminId
    cloned.upcomingSubscribers = []
  }
  if (collection === 'seasons' || collection === 'episodes') cloned.admin = destinationAdminId
  if (collection === 'upcomings') cloned.reminder = []
  return cloned
}

const normalized = value => String(value || '').trim().toLowerCase()

async function resolveTaxonomyConflicts(sourceDocs, destinationDb) {
  const report = { categoryIdRemaps: 0, genreIdRemaps: 0, castIdRemaps: 0, positionRemaps: 0 }
  const maps = { category_enums: new Map(), genre_enums: new Map(), cast_enums: new Map() }

  for (const name of ['category_enums', 'genre_enums']) {
    const existing = await destinationDb.collection(name).find({}).toArray()
    const byName = new Map(existing.map(item => [normalized(item.name), item]))
    const usedPositions = new Set(existing.map(item => item.position).filter(Number.isFinite))
    let nextPosition = Math.max(0, ...usedPositions, ...sourceDocs[name].map(item => item.position || 0)) + 1

    for (const item of sourceDocs[name]) {
      const originalId = String(item._id)
      const match = byName.get(normalized(item.name))
      if (match) {
        item._id = match._id
        item.position = match.position
        maps[name].set(originalId, match._id)
        report[name === 'category_enums' ? 'categoryIdRemaps' : 'genreIdRemaps'] += originalId === String(match._id) ? 0 : 1
        continue
      }
      maps[name].set(originalId, item._id)
      if (usedPositions.has(item.position)) {
        while (usedPositions.has(nextPosition)) nextPosition += 1
        item.position = nextPosition
        nextPosition += 1
        report.positionRemaps += 1
      }
      usedPositions.add(item.position)
    }
  }

  const existingCasts = await destinationDb.collection('cast_enums').find({}).toArray()
  const castsByIdentity = new Map(
    existingCasts.map(item => [`${normalized(item.title)}\u0000${normalized(item.name)}`, item]),
  )
  for (const item of sourceDocs.cast_enums) {
    const originalId = String(item._id)
    const match = castsByIdentity.get(`${normalized(item.title)}\u0000${normalized(item.name)}`)
    if (match) {
      item._id = match._id
      maps.cast_enums.set(originalId, match._id)
      report.castIdRemaps += originalId === String(match._id) ? 0 : 1
    } else maps.cast_enums.set(originalId, item._id)
  }

  for (const video of sourceDocs.videos) {
    video.category = (video.category || []).map(id => maps.category_enums.get(String(id)) || id)
    video.genre = (video.genre || []).map(id => maps.genre_enums.get(String(id)) || id)
    video.cast = (video.cast || []).map(id => maps.cast_enums.get(String(id)) || id)
  }
  return report
}

async function copyMultipart(reference, head) {
  const create = await copyS3.send(new CreateMultipartUploadCommand({
    Bucket: destinationBucket,
    Key: reference.key,
    ContentType: head.ContentType,
    Metadata: head.Metadata,
  }))
  const uploadId = create.UploadId
  if (!uploadId) throw new Error('Multipart copy did not return an upload id')
  try {
    const parts = []
    for (let start = 0, partNumber = 1; start < head.ContentLength; start += COPY_PART_SIZE, partNumber += 1) {
      const end = Math.min(start + COPY_PART_SIZE, head.ContentLength) - 1
      const result = await copyS3.send(new UploadPartCopyCommand({
        Bucket: destinationBucket,
        Key: reference.key,
        UploadId: uploadId,
        PartNumber: partNumber,
        CopySource: encodeCopySource(reference.bucket, reference.key),
        CopySourceRange: `bytes=${start}-${end}`,
      }))
      parts.push({ ETag: result.CopyPartResult?.ETag, PartNumber: partNumber })
    }
    await copyS3.send(new CompleteMultipartUploadCommand({
      Bucket: destinationBucket,
      Key: reference.key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }))
  } catch (error) {
    await copyS3.send(new AbortMultipartUploadCommand({
      Bucket: destinationBucket,
      Key: reference.key,
      UploadId: uploadId,
    })).catch(() => {})
    throw error
  }
}

async function copyReference(reference) {
  let sourceHead
  try {
    sourceHead = await sourceS3.send(new HeadObjectCommand({ Bucket: reference.bucket, Key: reference.key }))
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return { status: 'missing', bytes: 0 }
    throw error
  }

  try {
    const destinationHead = await destinationS3.send(new HeadObjectCommand({
      Bucket: destinationBucket,
      Key: reference.key,
    }))
    if (destinationHead.ContentLength === sourceHead.ContentLength) {
      return { status: 'existing', bytes: sourceHead.ContentLength || 0 }
    }
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') throw error
  }

  if (sourceHead.ContentLength > MAX_SINGLE_COPY) await copyMultipart(reference, sourceHead)
  else {
    await copyS3.send(new CopyObjectCommand({
      Bucket: destinationBucket,
      Key: reference.key,
      CopySource: encodeCopySource(reference.bucket, reference.key),
      MetadataDirective: 'COPY',
    }))
  }

  const verification = await destinationS3.send(new HeadObjectCommand({
    Bucket: destinationBucket,
    Key: reference.key,
  }))
  if (verification.ContentLength !== sourceHead.ContentLength) {
    throw new Error(`Copied object size mismatch in destination bucket`)
  }
  return { status: 'copied', bytes: sourceHead.ContentLength || 0 }
}

async function copyMedia(references) {
  const queue = [...references.values()]
  const results = []
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const reference = queue.shift()
      let lastError
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          results.push(await copyReference(reference))
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        }
      }
      if (lastError) throw lastError
    }
  })
  await Promise.all(workers)
  return {
    referenced: references.size,
    copied: results.filter(item => item.status === 'copied').length,
    existing: results.filter(item => item.status === 'existing').length,
    missingAtSource: results.filter(item => item.status === 'missing').length,
    verifiedBytes: results.reduce((total, item) => total + item.bytes, 0),
  }
}

async function writeCollections(sourceDocs, destinationDb, destinationAdminId) {
  const backup = {}
  const insertedIds = {}
  for (const name of COLLECTIONS) {
    const ids = sourceDocs[name].map(document => document._id)
    backup[name] = ids.length ? await destinationDb.collection(name).find({ _id: { $in: ids } }).toArray() : []
    insertedIds[name] = ids
  }
  const backupPath = path.join(os.tmpdir(), `reeplay-railway-catalogue-backup-${Date.now()}.json`)
  fs.writeFileSync(backupPath, EJSON.stringify(backup, null, 2), { encoding: 'utf8', mode: 0o600 })

  try {
    for (const name of COLLECTIONS) {
      const transformed = sourceDocs[name].map(document => transformDocument(name, document, destinationAdminId))
      if (!transformed.length) continue
      await destinationDb.collection(name).bulkWrite(
        transformed.map(document => ({
          replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true },
        })),
        { ordered: true },
      )
    }
    return backupPath
  } catch (error) {
    for (const name of [...COLLECTIONS].reverse()) {
      const ids = insertedIds[name]
      if (ids.length) await destinationDb.collection(name).deleteMany({ _id: { $in: ids } })
      if (backup[name].length) await destinationDb.collection(name).insertMany(backup[name], { ordered: true })
    }
    throw error
  }
}

async function verify(sourceDocs, destinationDb) {
  const counts = {}
  for (const name of COLLECTIONS) {
    const ids = sourceDocs[name].map(document => document._id)
    counts[name] = ids.length ? await destinationDb.collection(name).countDocuments({ _id: { $in: ids } }) : 0
    if (counts[name] !== sourceDocs[name].length) throw new Error(`Verification failed for ${name}`)
  }

  const videoIds = new Set(sourceDocs.videos.map(item => String(item._id)))
  const categoryIds = new Set(sourceDocs.category_enums.map(item => String(item._id)))
  const genreIds = new Set(sourceDocs.genre_enums.map(item => String(item._id)))
  const castIds = new Set(sourceDocs.cast_enums.map(item => String(item._id)))
  let brokenTaxonomyReferences = 0
  for (const video of sourceDocs.videos) {
    brokenTaxonomyReferences += (video.category || []).filter(id => !categoryIds.has(String(id))).length
    brokenTaxonomyReferences += (video.genre || []).filter(id => !genreIds.has(String(id))).length
    brokenTaxonomyReferences += (video.cast || []).filter(id => !castIds.has(String(id))).length
  }
  const brokenSeasonReferences = sourceDocs.seasons.filter(item => !videoIds.has(String(item.video))).length

  return { counts, brokenTaxonomyReferences, brokenSeasonReferences }
}

async function main() {
  const sourceClient = new MongoClient(sourceMongoUrl, { serverSelectionTimeoutMS: 15000 })
  const destinationClient = new MongoClient(destinationMongoUrl, { serverSelectionTimeoutMS: 15000 })
  await Promise.all([sourceClient.connect(), destinationClient.connect()])
  try {
    const sourceDb = sourceClient.db(sourceDbName)
    const destinationDb = destinationClient.db(destinationDbName)
    const destinationAdmin = await destinationDb.collection('users').findOne(
      { role: 'superadmin', deleted: { $ne: true } },
      { projection: { _id: 1 } },
    )
    if (!destinationAdmin) throw new Error('No active Railway superadmin exists for content ownership remapping')

    const sourceDocs = {}
    const references = new Map()
    const destinationBefore = {}
    for (const name of COLLECTIONS) {
      sourceDocs[name] = await sourceDb.collection(name).find({}).toArray()
      destinationBefore[name] = await destinationDb.collection(name).estimatedDocumentCount()
    }
    const taxonomyResolution = await resolveTaxonomyConflicts(sourceDocs, destinationDb)
    for (const name of COLLECTIONS) {
      sourceDocs[name].forEach(document => collectMediaReferences(document, references))
    }

    const plan = {
      mode: APPLY ? 'apply' : 'dry-run',
      collections: Object.fromEntries(COLLECTIONS.map(name => [name, sourceDocs[name].length])),
      destinationBefore,
      referencedMediaObjects: references.size,
      taxonomyResolution,
      excluded: ['users', 'lives', 'payments', 'subscriptions', 'user activity and social collections'],
    }
    if (!APPLY) {
      console.log(JSON.stringify({ plan }, null, 2))
      return
    }

    const media = await copyMedia(references)
    const backupPath = await writeCollections(sourceDocs, destinationDb, destinationAdmin._id)
    const verification = await verify(sourceDocs, destinationDb)
    console.log(JSON.stringify({ plan, media, verification, backupPath }, null, 2))
  } finally {
    await Promise.allSettled([sourceClient.close(), destinationClient.close()])
  }
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message, name: error.name }))
  process.exitCode = 1
})
