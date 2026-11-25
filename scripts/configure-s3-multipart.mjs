import 'dotenv/config'
import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3'

const bucket = process.env.S3BUCKET
if (!bucket) throw new Error('S3BUCKET is required')

const client = new S3Client({
  region: process.env.S3REGION,
  credentials: process.env.S3ACCESS_KEY && process.env.S3SECRET_KEY
    ? { accessKeyId: process.env.S3ACCESS_KEY, secretAccessKey: process.env.S3SECRET_KEY }
    : undefined,
})

const readOrEmpty = async (command, property) => {
  try {
    return (await client.send(command))[property] ?? []
  } catch (error) {
    if (error?.name === 'NoSuchCORSConfiguration' || error?.name === 'NoSuchLifecycleConfiguration') {
      return []
    }
    throw error
  }
}

const corsRules = await readOrEmpty(new GetBucketCorsCommand({ Bucket: bucket }), 'CORSRules')
const multipartCorsRule = {
  AllowedHeaders: ['*'],
  AllowedMethods: ['PUT', 'GET', 'HEAD'],
  AllowedOrigins: ['*'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3600,
}
const hasMultipartCors = corsRules.some(rule =>
  rule.AllowedMethods?.includes('PUT') && rule.ExposeHeaders?.includes('ETag'),
)
await client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: { CORSRules: hasMultipartCors ? corsRules : [...corsRules, multipartCorsRule] },
}))

const lifecycleRules = await readOrEmpty(
  new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
  'Rules',
)
const lifecycleId = 'railway-abort-incomplete-multipart-uploads'
const lifecycleV2Rules = lifecycleRules
  .filter(rule => rule.ID !== lifecycleId)
  .map(rule => {
    if (rule.Filter || rule.Prefix === undefined) return rule
    const { Prefix, ...rest } = rule
    return { ...rest, Filter: { Prefix } }
  })
await client.send(new PutBucketLifecycleConfigurationCommand({
  Bucket: bucket,
  LifecycleConfiguration: {
    Rules: [
      ...lifecycleV2Rules,
      {
        ID: lifecycleId,
        Status: 'Enabled',
        Filter: { Prefix: 'railway-uploads/' },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      },
    ],
  },
}))

console.log(`Configured resumable multipart upload CORS and cleanup on ${bucket}`)
