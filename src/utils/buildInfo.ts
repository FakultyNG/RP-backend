import fs from 'node:fs'
import path from 'node:path'

const backendVersion = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
).version as string

export const getBuildInfo = () => ({
  version: backendVersion,
  commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? 'local',
  deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? 'local',
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'development',
  service: process.env.RAILWAY_SERVICE_NAME ?? 'reeplay-backend-typescript',
})
