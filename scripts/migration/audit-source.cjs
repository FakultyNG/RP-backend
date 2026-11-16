const { MongoClient } = require('mongodb')
const { S3Client, ListObjectsV2Command, HeadBucketCommand } = require('@aws-sdk/client-s3')

const uri = process.env.SOURCE_MONGO_URL || process.env.MONGO_DB_URL
if (!uri) throw new Error('SOURCE_MONGO_URL or MONGO_DB_URL is required')

const allowedCollection = /^(categor|genre|cast|video|movie|skit|music|series|season|episode|poster|subtitle|trailer|featured|live|upcoming|ad)/i
const excludedCollection = /(user|admin|client|auth|session|token|password|subscription|payment|wallet|gift|payout|comment|like|rating|watch|search|suggest|notification|device|interest|vote|donat|subscriber)/i

async function auditMongo() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
  await client.connect()
  try {
    const dbName = process.env.SOURCE_MONGO_DB_NAME || process.env.MONGO_DB_NAME || client.options.dbName
    if (!dbName) throw new Error('Source database name is missing from URI and SOURCE_MONGO_DB_NAME')
    const db = client.db(dbName)
    const collections = await db.listCollections({}, { nameOnly: true }).toArray()
    const allCollectionNames = collections.map(item => item.name).sort()
    const selected = allCollectionNames
      .filter(name => allowedCollection.test(name) && !excludedCollection.test(name))

    const counts = {}
    const mediaReferences = new Map()
    const visit = value => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!value || typeof value !== 'object') return

      const bucket = value.Bucket || value.bucket
      const key = value.Key || value.key
      if (typeof bucket === 'string' && typeof key === 'string') {
        if (!mediaReferences.has(bucket)) mediaReferences.set(bucket, new Set())
        mediaReferences.get(bucket).add(key)
      }
      Object.values(value).forEach(visit)
    }

    for (const name of selected) {
      counts[name] = await db.collection(name).estimatedDocumentCount()
      const cursor = db.collection(name).find({})
      for await (const document of cursor) visit(document)
    }

    return {
      report: {
        database: dbName,
        allCollectionNames,
        selectedCollections: counts,
        referencedMedia: Object.fromEntries(
          [...mediaReferences].map(([bucket, keys]) => [bucket, keys.size]),
        ),
      },
      mediaReferences,
    }
  } finally {
    await client.close()
  }
}

async function auditBucket(client, bucket) {
  if (!bucket) return null
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  let continuationToken
  let objects = 0
  let bytes = 0
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }))
    for (const item of page.Contents || []) {
      objects += 1
      bytes += item.Size || 0
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)
  return { bucket, objects, bytes }
}

async function auditS3() {
  const region = process.env.SOURCE_S3_REGION || process.env.S3REGION || process.env.AWS_REGION
  const accessKeyId = process.env.SOURCE_S3_ACCESS_KEY || process.env.S3ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.SOURCE_S3_SECRET_KEY || process.env.S3SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY
  if (!region || !accessKeyId || !secretAccessKey) return { configured: false, buckets: [] }

  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  const buckets = [...new Set([
    process.env.SOURCE_S3_VIDEO_BUCKET || process.env.S3BUCKET,
    process.env.SOURCE_S3_IMAGE_BUCKET || process.env.S3_IMAGE_BUCKET,
    process.env.SOURCE_S3_OUTPUT_BUCKET || process.env.OUTPUT_BUCKET_NAME,
  ].filter(Boolean))]
  const results = []
  for (const bucket of buckets) {
    try {
      results.push(await auditBucket(client, bucket))
    } catch (error) {
      results.push({ bucket, error: error.name || 'AccessError' })
    }
  }
  return { configured: true, buckets: results }
}

Promise.all([auditMongo(), auditS3()])
  .then(([mongoResult, s3]) => console.log(JSON.stringify({ mongo: mongoResult.report, s3 }, null, 2)))
  .catch(error => {
    console.error(JSON.stringify({ error: error.message }))
    process.exitCode = 1
  })
