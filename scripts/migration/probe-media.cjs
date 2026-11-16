const { MongoClient } = require('mongodb')
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3')

const collections = [
  'ads',
  'cast_enums',
  'episodes',
  'poster_images',
  'sub_titles',
  'trailers',
  'upcomings',
  'video_uploads',
  'videos',
]

const addReferences = (value, refs, inheritedBucket) => {
  if (Array.isArray(value)) {
    value.forEach(item => addReferences(item, refs, inheritedBucket))
    return
  }
  if (!value || typeof value !== 'object') return

  const bucket = value.Bucket || value.bucket || inheritedBucket
  const key = value.Key || value.key
  if (typeof bucket === 'string' && typeof key === 'string') {
    if (!refs.has(bucket)) refs.set(bucket, new Set())
    refs.get(bucket).add(key)
  }
  if (bucket && Array.isArray(value.resolutions)) {
    for (const resolution of value.resolutions) {
      if (typeof resolution?.key === 'string') {
        if (!refs.has(bucket)) refs.set(bucket, new Set())
        refs.get(bucket).add(resolution.key)
      }
    }
  }
  Object.values(value).forEach(item => addReferences(item, refs, bucket))
}

async function main() {
  const mongo = new MongoClient(process.env.SOURCE_MONGO_URL, { serverSelectionTimeoutMS: 15000 })
  await mongo.connect()
  const refs = new Map()
  try {
    const db = mongo.db(process.env.SOURCE_MONGO_DB_NAME || mongo.options.dbName || 'reeplayDB')
    for (const name of collections) {
      const cursor = db.collection(name).find({})
      for await (const document of cursor) addReferences(document, refs)
    }
  } finally {
    await mongo.close()
  }

  const explicitCredentials =
    process.env.SOURCE_S3_ACCESS_KEY && process.env.SOURCE_S3_SECRET_KEY
      ? {
          accessKeyId: process.env.SOURCE_S3_ACCESS_KEY,
          secretAccessKey: process.env.SOURCE_S3_SECRET_KEY,
        }
      : undefined
  const s3 = new S3Client({
    region: process.env.SOURCE_S3_REGION,
    credentials: explicitCredentials,
  })

  const report = {}
  for (const [bucket, keys] of refs) {
    const probeLimit = Number(process.env.PROBE_LIMIT || 0)
    const keysToProbe = probeLimit > 0 ? [...keys].slice(0, probeLimit) : [...keys]
    const queue = [...keysToProbe]
    const results = await Promise.all(
      Array.from({ length: Math.min(12, queue.length) }, async () => {
        const workerResults = []
        while (queue.length) {
          const key = queue.shift()
          try {
            const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
            workerResults.push({ status: 'accessible', bytes: head.ContentLength || 0 })
          } catch (error) {
            const status = error?.$metadata?.httpStatusCode
            workerResults.push({
              status: status === 404 || error?.name === 'NotFound' ? 'missing' : 'denied',
              bytes: 0,
            })
          }
        }
        return workerResults
      }),
    )
    const flatResults = results.flat()
    const accessible = flatResults.filter(item => item.status === 'accessible').length
    const missing = flatResults.filter(item => item.status === 'missing').length
    const denied = flatResults.filter(item => item.status === 'denied').length
    const bytes = flatResults.reduce((total, item) => total + item.bytes, 0)
    report[bucket] = { referenced: keys.size, probed: keysToProbe.length, accessible, missing, denied, bytes }
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message }))
  process.exitCode = 1
})
