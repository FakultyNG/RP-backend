# AWS Test Environment Proposal

Status: proposal only — nothing has been provisioned.

## Confirmed code requirements

The application uses S3 `PutObject`, `GetObject`, `DeleteObject`, listing, presigned reads, and multipart upload operations. Successful video uploads immediately request an AWS MediaConvert job using an IAM service role. CloudFront signing is a separate path. S3-only tests can cover images, subtitles, basic upload/download/delete, and signed S3 URLs; full VOD delivery requires isolated MediaConvert outputs and possibly a staging CloudFront distribution.

## Proposed bucket

- Globally unique name based on `reeplay-dev-media-<account>-<region>`
- Same region as the approved development runtime
- S3 Block Public Access enabled at account and bucket level
- Bucket-owner-enforced object ownership
- Default SSE-S3 encryption (or SSE-KMS only if a test KMS key is approved)
- TLS-only bucket policy
- Versioning disabled initially to control cost, unless production behavior requires it
- Lifecycle rule to abort incomplete multipart uploads after 1 day
- Lifecycle expiry for `fixtures/` and `transcode/` test objects after 7 days
- No production replication, inventory, or event destinations
- CORS limited to explicitly approved local/staging origins and required methods

## Least-privilege application policy template

Replace the placeholder bucket name only after approval. Use a new development identity; never reuse keys exposed in Git.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListTestPrefixes",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::reeplay-dev-media-PLACEHOLDER",
      "Condition": {
        "StringLike": {"s3:prefix": ["fixtures/*", "photos/*", "videos/*", "subtitles/*", "transcode/*"]}
      }
    },
    {
      "Sid": "ManageTestObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::reeplay-dev-media-PLACEHOLDER/*"
    }
  ]
}
```

MediaConvert requires a separate submission policy and a service role scoped to the test bucket. That policy must be derived from the verified production job shape and approved before creation.

## Cost controls

- Store only small fixtures and expire them automatically.
- Set an AWS Budget alert before enabling MediaConvert.
- Do not upload the production media library.
- Review the selected region's current S3 storage/request, data-transfer, MediaConvert, CloudFront, and KMS prices before provisioning.
- A precise estimate cannot be produced until region, fixture volume, transcoded minutes, output renditions, and expected test traffic are supplied.

## Approval gate

Before creation, approve the bucket name/region, retention, CORS origins, IAM identity type, monthly budget threshold, and whether MediaConvert/CloudFront staging is in scope. Creation is intentionally blocked until then.
