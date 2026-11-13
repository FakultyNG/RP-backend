# Local Development

## Prerequisites

- Node.js 20 LTS
- Docker Desktop using the WSL2 backend
- PowerShell 7 or Windows PowerShell 5.1

Docker Desktop is not currently installed on this machine, so container commands have not yet been executed here.
WSL is also unavailable and Windows reports no active hypervisor. Docker Desktop cannot be validated until hardware virtualization is enabled and WSL2/Docker Desktop are installed.

## First-time setup

```powershell
.\tools\reeplay.ps1 Setup
```

Review `.env.development` and `.env.test`. They must contain only local or isolated test values.

## Common commands

```powershell
# Start local MongoDB, then run the API with automatic reload
.\tools\reeplay.ps1 Start

# In another terminal
.\tools\reeplay.ps1 Health
.\tools\reeplay.ps1 Test
.\tools\reeplay.ps1 Seed
.\tools\reeplay.ps1 Logs

# Start optional Mongo Express at http://127.0.0.1:8081
.\tools\reeplay.ps1 Tools

# Stop containers without deleting data
.\tools\reeplay.ps1 Stop

# Delete and recreate only the reeplay-local MongoDB volume, then seed it
.\tools\reeplay.ps1 Reset
```

The API runs at `http://127.0.0.1:3000`. Health endpoints are `/health` and `/ready`.

## Safety behavior

Development and test startup fails when:

- `MONGO_URL` is missing;
- MongoDB is remote without `ALLOW_REMOTE_DEV_DATABASE=true`;
- AWS credentials are present without `ALLOW_AWS_IN_DEVELOPMENT=true`; or
- a non-test Paystack key is present without explicit external-payment opt-in.

Enabling an isolated remote test service is a deliberate action. Never point these files at production.

## Firebase

Firebase is disabled locally. For an approved development Firebase project, place its credential outside the repository, set `GOOGLE_APPLICATION_CREDENTIALS` to that file, and set `ENABLE_FIREBASE=true`.

## Tests

`npm test` runs isolated tests. Legacy external media tests run only with `npm run test:external` and require explicit sandbox credentials and `TEST_CUSTOMER_TOKEN`.
