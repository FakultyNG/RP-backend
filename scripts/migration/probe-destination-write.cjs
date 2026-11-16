const { MongoClient } = require('mongodb')
const {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3')

async function findReference(db, collection) {
  const document = await db.collection(collection).findOne({ bucket: { $type: 'string' }, key: { $type: 'string' } })
  return document ? { bucket: document.bucket, key: document.key } : null
}

async function main() {
  const mongo = new MongoClient(process.env.SOURCE_MONGO_URL)
  await mongo.connect()
  let references
  try {
    const db = mongo.db(process.env.SOURCE_MONGO_DB_NAME || mongo.options.dbName || 'reeplayDB')
    references = [
      await findReference(db, 'poster_images'),
      await findReference(db, 'video_uploads'),
    ].filter(Boolean)
  } finally {
    await mongo.close()
  }

  const region = process.env.SOURCE_S3_REGION
  const source = new S3Client({ region })
  const destination = new S3Client({
    region: process.env.DEST_S3_REGION || region,
    credentials: {
      accessKeyId: process.env.DEST_S3_ACCESS_KEY,
      secretAccessKey: process.env.DEST_S3_SECRET_KEY,
    },
  })
  const targetBucket = process.env.DEST_S3_BUCKET
  const results = []

  for (const [index, reference] of references.entries()) {
    const head = await source.send(new HeadObjectCommand({ Bucket: reference.bucket, Key: reference.key }))
    const targetKey = `migration-probe/${Date.now()}-${index}`
    let method = 'server-side-copy'
    try {
      await source.send(new CopyObjectCommand({
        Bucket: targetBucket,
        Key: targetKey,
        CopySource: encodeURIComponent(`${reference.bucket}/${reference.key}`).replace(/%2F/g, '/'),
      }))
    } catch {
      method = 'stream'
      const object = await source.send(new GetObjectCommand({ Bucket: reference.bucket, Key: reference.key }))
      await destination.send(new PutObjectCommand({
        Bucket: targetBucket,
        Key: targetKey,
        Body: object.Body,
        ContentLength: head.ContentLength,
        ContentType: head.ContentType,
      }))
    }

    const copied = await destination.send(new HeadObjectCommand({ Bucket: targetBucket, Key: targetKey }))
    await destination.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: targetKey }))
    results.push({ sourceBucket: reference.bucket, bytes: head.ContentLength || 0, method, verified: copied.ContentLength === head.ContentLength })
  }

  console.log(JSON.stringify(results, null, 2))
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message, name: error.name }))
  process.exitCode = 1
})
