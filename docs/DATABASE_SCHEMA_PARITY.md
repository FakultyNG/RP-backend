# MongoDB Schema Parity

Status: **Not established**

The project brief requested exact PostgreSQL parity, but the cloned backend uses MongoDB/Mongoose exclusively. No PostgreSQL implementation exists in this repository. MongoDB parity must instead compare the live engine version, collection options/validators, and indexes.

## Evidence currently available

- 29 application-side Mongoose models
- Historical local Docker configuration using MongoDB 6.0
- Runtime connection through `MONGO_URL`
- No migration framework or database-version manifest

This evidence is insufficient to claim parity with production.

## Safe parity procedure

Use a newly issued, read-only production metadata account. Do not place its URI in a file or command history.

```powershell
$env:PRODUCTION_MONGO_READONLY_URL = '<supplied securely outside Git>'
$env:ALLOW_PRODUCTION_METADATA_READ = 'true'
node scripts/db/capture-mongo-metadata.js --uri-env=PRODUCTION_MONGO_READONLY_URL --out=tmp/production-metadata.json

$env:LOCAL_MONGO_URL = 'mongodb://reeplay_dev:reeplay-local-only@127.0.0.1:27017/reeplayDB?authSource=admin'
node scripts/db/capture-mongo-metadata.js --uri-env=LOCAL_MONGO_URL --out=tmp/local-metadata.json

node scripts/db/compare-mongo-metadata.js tmp/production-metadata.json tmp/local-metadata.json
```

The production capture reads metadata only. It does not export records. The comparison reports missing/extra collections plus collection-option and index differences.

## Known limitations

- Mongoose schemas are not server-side MongoDB validators unless explicitly installed as validators.
- MongoDB roles and permissions are not captured by the current script because the proposed account should not have role-administration access.
- Atlas, Amazon DocumentDB, and self-hosted MongoDB can expose different metadata and compatibility behavior.
- Exact parity cannot be claimed until the commands above run successfully and all differences are reviewed.

## Test data

`node scripts/db/seed-local.js` creates only synthetic local users, settings, a wallet, and fictional content metadata. Its environment guard rejects an unapproved remote database. No production documents are copied.
