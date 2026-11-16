import { defineRailway, project, service } from 'railway/iac'

export const partial = 'reeplay-backend-typescript'

export default defineRailway(() => {
  const reeplayApiTypescript = service('reeplay-api-ts', {
    build: { buildEnvironment: 'V3', builder: 'NIXPACKS' },
    start: 'npm start',
    healthcheck: '/health',
    healthcheckTimeout: 300,
    replicas: { iad: 1 },
  })

  return project('reeplay-backend-dev', {
    variables: { managed: false },
    resources: [reeplayApiTypescript],
  })
})
