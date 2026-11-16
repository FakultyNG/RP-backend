const { mongo: { MongoClient } } = require('mongoose')
const { HeadObjectCommand, S3Client } = require('@aws-sdk/client-s3')

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sourceMongoUrl = required('SOURCE_MONGO_URL')
const destinationMongoUrl = required('DEST_MONGO_URL')
const destinationBucket = required('DEST_S3_BUCKET')
const cdnBaseUrl = required('CDN_IMAGES_BASE_URL').replace(/\/+$/, '')

const sourceS3 = new S3Client({
  region: required('SOURCE_S3_REGION'),
  followRegionRedirects: true,
})
const destinationS3 = new S3Client({
  region: required('DEST_S3_REGION'),
  credentials: {
    accessKeyId: required('DEST_S3_ACCESS_KEY'),
    secretAccessKey: required('DEST_S3_SECRET_KEY'),
  },
})

const exists = async (client, bucket, key) => {
  if (!bucket || !key) return false
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey'
    ) {
      return false
    }
    throw error
  }
}

const cdnStatus = async key => {
  if (!key) return 0
  try {
    const response = await fetch(
      `${cdnBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'HEAD' },
    )
    return response.status
  } catch {
    return -1
  }
}

const mediaReferences = (sourceVideos, sourceCasts) => [
  ...sourceVideos.flatMap(video => [
    {
      kind: 'vod-landscape',
      id: String(video._id),
      label: video.title,
      sourceBucket: video.landscapePhoto?.Bucket,
      key: video.landscapePhoto?.Key,
    },
    {
      kind: 'vod-portrait',
      id: String(video._id),
      label: video.title,
      sourceBucket: video.portraitPhoto?.Bucket,
      key: video.portraitPhoto?.Key,
    },
  ]),
  ...sourceCasts.map(cast => ({
    kind: 'cast',
    id: String(cast._id),
    label: cast.name,
    sourceBucket: cast.bucket,
    key: cast.key,
  })),
]

async function main() {
  const sourceClient = new MongoClient(sourceMongoUrl, { serverSelectionTimeoutMS: 15000 })
  const destinationClient = new MongoClient(destinationMongoUrl, { serverSelectionTimeoutMS: 15000 })
  await Promise.all([sourceClient.connect(), destinationClient.connect()])

  try {
    const sourceDb = sourceClient.db(process.env.SOURCE_MONGO_DB_NAME || 'reeplayDB')
    const destinationDb = destinationClient.db(process.env.DEST_MONGO_DB_NAME || 'reeplayDB')
    const [sourceVideos, sourceCasts, destinationVideos, destinationCasts] = await Promise.all([
      sourceDb.collection('videos').find({}, { projection: { title: 1, landscapePhoto: 1, portraitPhoto: 1 } }).toArray(),
      sourceDb.collection('cast_enums').find({}, { projection: { name: 1, bucket: 1, key: 1 } }).toArray(),
      destinationDb.collection('videos').find({}, { projection: { landscapePhoto: 1, portraitPhoto: 1 } }).toArray(),
      destinationDb.collection('cast_enums').find({}, { projection: { bucket: 1, key: 1 } }).toArray(),
    ])

    const destinationVideoById = new Map(destinationVideos.map(item => [String(item._id), item]))
    const destinationCastById = new Map(destinationCasts.map(item => [String(item._id), item]))
    const references = mediaReferences(sourceVideos, sourceCasts)
    const queue = [...references]
    const results = []

    await Promise.all(Array.from({ length: Math.min(10, queue.length) }, async () => {
      while (queue.length) {
        const reference = queue.shift()
        const destinationDocument = reference.kind === 'cast'
          ? destinationCastById.get(reference.id)
          : destinationVideoById.get(reference.id)
        const destinationPointer = reference.kind === 'cast'
          ? { bucket: destinationDocument?.bucket, key: destinationDocument?.key }
          : reference.kind === 'vod-landscape'
            ? { bucket: destinationDocument?.landscapePhoto?.Bucket, key: destinationDocument?.landscapePhoto?.Key }
            : { bucket: destinationDocument?.portraitPhoto?.Bucket, key: destinationDocument?.portraitPhoto?.Key }

        const [sourceExists, destinationExists, status] = await Promise.all([
          exists(sourceS3, reference.sourceBucket, reference.key),
          exists(destinationS3, destinationBucket, reference.key),
          cdnStatus(reference.key),
        ])
        results.push({
          ...reference,
          destinationPointer,
          sourceExists,
          destinationExists,
          cdnStatus: status,
        })
      }
    }))

    const broken = results.filter(item =>
      !item.sourceExists ||
      !item.destinationExists ||
      item.cdnStatus < 200 ||
      item.cdnStatus >= 400 ||
      item.destinationPointer?.key !== item.key ||
      item.destinationPointer?.bucket !== destinationBucket
    )

    const summary = {
      totalReferences: results.length,
      sourceAvailable: results.filter(item => item.sourceExists).length,
      destinationAvailable: results.filter(item => item.destinationExists).length,
      cdnAvailable: results.filter(item => item.cdnStatus >= 200 && item.cdnStatus < 400).length,
      destinationPointersCorrect: results.filter(item =>
        item.destinationPointer?.key === item.key && item.destinationPointer?.bucket === destinationBucket
      ).length,
      broken: broken.length,
      brokenByKind: Object.fromEntries(
        ['vod-landscape', 'vod-portrait', 'cast'].map(kind => [
          kind,
          broken.filter(item => item.kind === kind).length,
        ]),
      ),
    }

    console.log(JSON.stringify({ summary, broken }, null, 2))
  } finally {
    await Promise.allSettled([sourceClient.close(), destinationClient.close()])
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message,
    name: error.name,
    status: error?.$metadata?.httpStatusCode,
    stack: error.stack,
  }))
  process.exitCode = 1
})
