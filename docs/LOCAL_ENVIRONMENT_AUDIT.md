# Reeplay Local Environment Audit

Audit date: 2026-11-13

## Executive finding

This workspace is a direct clone of `Fakulty-Media-and-Technology/RP-backend` at commit `4bcf278` on `main`. The checked-in application is a CommonJS Node.js/Express monolith backed by MongoDB through Mongoose. It contains no PostgreSQL client, SQL ORM, SQL migrations, or PostgreSQL connection configuration. The earlier PostgreSQL requirement therefore conflicts with the verified repository.

Production infrastructure was not queried or modified. AWS CLI, Docker, `mongosh`, and `mongodump` are not installed on this computer, and no independently verified read-only production account was available.

## Confirmed application architecture

- Runtime: Node.js; repository history used Node 20, while the local machine has Node 22.23.5. CI is pinned to Node 20.
- Package manager: npm with lockfile version 3.
- Entry point: `src/index.js`; HTTP application: `src/app.js`.
- Framework: Express 4 with Socket.IO.
- Database: MongoDB via Mongoose 8.4.3, database name defaulting to `reeplayDB`.
- API prefix: `/api/v1`.
- API surfaces: customer (64 routes), client/creator (20 routes), super-admin (80 routes), and an empty regular-admin router.
- Authentication: custom JWT headers and role-specific middleware; passwords use bcrypt.
- Media: AWS SDK integrations for S3, CloudFront signed URLs, and MediaConvert.
- Live streaming: Node Media Server, RTMP, local HLS segments, and FFmpeg renditions.
- Realtime: Socket.IO.
- Jobs: `node-cron` and `node-schedule` for subscriptions, livestream state, and featured-content expiry.
- Payments: Paystack.
- Notifications: Firebase Admin and Nodemailer/Mailtrap.
- Tests: Jest and Supertest. The original two tests were live integration tests with an expired committed JWT and external dependencies.

## Database assessment

There are 29 Mongoose model exports under `src/models`. No migration history exists. Mongoose models describe application expectations but do not prove the live database's collections, validators, indexes, or MongoDB version. Exact production parity is **not established**.

Read-only production verification requires:

1. A MongoDB account limited to metadata operations on the Reeplay database.
2. Network access to the database endpoint.
3. Confirmation of the correct database name and whether the service is Atlas, DocumentDB, self-hosted MongoDB, or another compatible implementation.
4. Explicit `ALLOW_PRODUCTION_METADATA_READ=true` only for the metadata-capture command.

The supplied capture script reads server version, collection options, and indexes; it does not read application documents.

## Security findings

- The repository tracked `.env`, two RSA/CloudFront private-key files, and two Firebase service-account JSON files. They have been removed from the working tree and ignored going forward.
- Removing files from the current tree does not remove them from Git history. Every affected AWS, Firebase, MongoDB, JWT, email, and payment credential must be treated as exposed and rotated before further use.
- The historical Dockerfile downloaded a production environment file from an S3 URL during image creation. It was not restored.
- CORS currently permits every origin.
- Request and file-upload limits are 10 GB and in-memory uploads are enabled, creating denial-of-service and memory-exhaustion risk.
- No Helmet, rate limiting, request validation framework, or centralized structured logging was found despite README claims.
- A non-breaking `npm audit fix` reduced all-package findings from 76 to 21. The remaining production tree has 13 findings (9 moderate, 3 high, 1 critical) whose suggested remediations require breaking dependency upgrades. No `--force` upgrades were applied.
- The media-server signing secret is hardcoded in `src/livestream/nms.js`.

## Local isolation implemented

- Local MongoDB 6 container bound only to `127.0.0.1:27017`.
- Optional Mongo Express bound only to `127.0.0.1:8081`.
- Local/test environment files are Git-ignored.
- Development startup rejects remote MongoDB unless explicitly opted in.
- Development startup rejects configured AWS credentials and live Paystack keys unless explicitly opted in.
- Media uploads now require `S3_BUCKET`; the production bucket name is no longer hardcoded, allowing least-privilege test-bucket isolation.
- Cron jobs, RTMP/FFmpeg, Firebase, AWS, and external payments are disabled in local/test examples.
- Firebase now uses Application Default Credentials from an external path rather than a repository credential.
- `/health` reports process health; `/ready` reports MongoDB readiness.

## AWS status

Code confirms dependencies on S3, CloudFront, MediaConvert, and an IAM role ARN. It does **not** prove whether the Node process runs on EC2, ECS, Elastic Beanstalk, Lightsail, or another platform, nor whether MongoDB is hosted by AWS. No production AWS resource was inspected.

Minimum useful AWS discovery access is a dedicated read-only identity with narrowly scoped `List`/`Describe`/`Get` permissions for the known service set, plus CloudTrail-safe identity inspection. Do not reuse the exposed access keys from Git. No test bucket or other paid resource has been created; configuration and cost approval are required first.

## Deployment and CI status

No active CI/CD workflow existed at the audited commit. A test-only GitHub Actions workflow has been added for feature branches and pull requests. It does not deploy and contains no production credentials.

## Unverified items

- Actual production host/service topology
- Live MongoDB engine, version, collections, validators, and indexes
- Production S3 bucket policies, encryption, CORS, lifecycle, versioning, and CloudFront configuration
- Current production environment variables and secrets after rotation
- End-to-end media, payment, email, Firebase, RTMP, and HLS behavior

## Required production rollout configuration

These changes have not been deployed. Before a future controlled deployment, production must explicitly provide `NODE_ENV=production`, `MONGO_URL`, `MONGO_DB_NAME`, `S3_BUCKET=reeplay`, and externally managed Firebase credentials. Validate these in staging first.
