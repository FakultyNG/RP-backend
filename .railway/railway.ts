import { defineRailway, project, service } from "railway/iac";

export const partial = "reeplay-backend";

export default defineRailway(() => {
  const reeplayApi = service("reeplay-api", {
    build: { buildEnvironment: "V3", builder: "NIXPACKS" },
    start: "npm start",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { iad: 1 },
  });

  const reeplayMedia = service("reeplay-media", {
    build: { buildEnvironment: "V3", builder: "NIXPACKS" },
    start: "npm start",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { iad: 1 },
    networking: { tcpProxies: { "1935": {} } },
  });

  return project("reeplay-backend-dev", {
    variables: { managed: false },
    resources: [reeplayApi, reeplayMedia],
  });
});
