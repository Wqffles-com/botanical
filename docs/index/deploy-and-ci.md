# Deploy and CI

[Index](README.md)

Images, compose, release zip, and the one workflow. The API process inside the supported image is still `packages/server` (see [server](server.md)).

## Images and compose

| Path | Purpose |
|------|---------|
| `Dockerfile` | API image. Installs the workspace, copies `deploy/scripts/server-entrypoint.sh` and `config/mcp.json`. Strips CR from the entrypoint before it runs |
| `web.Dockerfile` | Next standalone image. Build calls `deploy/scripts/ensure-next-standalone.mjs` and `deploy/scripts/stage-next-standalone.sh`. Strips CR from those shell scripts before `sh` runs them |
| `packages/server/Dockerfile` | Package-only image. Comment in the file says the supported build is the root `Dockerfile` |
| `docker-compose.yml` | `postgres`, `server` (root `Dockerfile`), `web` (`web.Dockerfile`). Host ports default to web 3000, API `127.0.0.1:8788`, Postgres `127.0.0.1:5433` |
| `docker-compose.cli.yml` | Extra env and volumes for coding CLIs on `server` |
| `docker-compose.saas.yml` | Sets deployment mode to `SAAS` and does not start bundled Postgres |
| `start.sh` | Repo-root launcher: Docker/Compose checks, `.env` from `.env.example`, generated secrets, prompts, `docker compose up --build -d` |
| `start.ps1` | Same launcher for Windows PowerShell 5.1+ and pwsh. Writes `.env` UTF-8 without BOM, LF endings |
| `.gitattributes` | LF for `*.sh`, `*Dockerfile*`, `*.mjs`, `*.ts`, `*.json`, `*.yml`, `*.yaml`, and `.env.example`. `*.ps1` stays auto |
| `.dockerignore` | Docker build context filter |
| `packages/db/docker-compose.test.yml` | Test-only Postgres. Do not start it unless asked |

`deploy/scripts/server-entrypoint.sh` normalizes `DEPLOYMENT_MODE` / `BOTANICAL_DEPLOYMENT_MODE` into `BOTANICAL_DEPLOYMENT_MODE`, warns when `BOTANICAL_ENCRYPTION_KEY` is unset, runs `bun run db:migrate` when `DATABASE_URL` is set, then `bun src/serve.ts` in `packages/server`.

## `deploy/`

| Path | Purpose |
|------|---------|
| `deploy/scripts/server-entrypoint.sh` | Compose API entry (above) |
| `deploy/scripts/web-entrypoint.sh` | Web container entry |
| `deploy/scripts/entrypoint.sh` | Older bootstrap: monorepo server if present, else `deploy/server` |
| `deploy/scripts/build-server.sh` | Assemble that bootstrap image layout |
| `deploy/scripts/build-web.sh` | Assemble static `public` for the bootstrap |
| `deploy/scripts/ensure-next-standalone.mjs` | Checks the Next build; reads `BOTANICAL_API_URL` |
| `deploy/scripts/stage-next-standalone.sh` | Copies standalone output for `web.Dockerfile` |
| `deploy/postgres/init/01-timezone.sh` | First-boot `ALTER DATABASE` timezone UTC only. Schema is `packages/db` |
| `deploy/web/static-server.mjs` | Tiny static server plus API proxy (`PORT`, `WEB_ROOT`, `API_UPSTREAM`) |
| `deploy/web/default.conf.template` | Proxy template for a static web image |
| `deploy/web/proxy-params.conf` | Proxy header snippet |
| `deploy/web/public` | Bootstrap static assets |
| `deploy/server/src/index.ts` | Alternate HTTP server (static files + a small session API). Not what `docker-compose.yml` runs |
| `deploy/server/src/config.ts` | Env validation for that bootstrap |
| `deploy/server/src/session.ts` | Signed session cookie for that bootstrap |
| `deploy/server/test` | `bun test` for the bootstrap config and session |

Bootstrap routes in `deploy/server/src/index.ts` (separate from `packages/server`): `GET /health`, `GET /ready`, `GET /api/meta`, `POST /api/session`, `DELETE /api/session`, `GET /api/me`, plus static files when `SERVE_WEB` is on.

Bootstrap env read in `deploy/server/src/config.ts` includes `DEPLOYMENT_MODE`, `BOTANICAL_PASSCODE`, `BOTANICAL_SESSION_SECRET`, `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX`, `BOTANICAL_PUBLIC_ORIGIN`, `COOKIE_SECURE`, `PORT`, `HOST`, `TRUST_PROXY`, `LOG_LEVEL`, `BOTANICAL_SESSION_TTL_SECONDS`, `BOTANICAL_WORKSPACE`, `WEB_ROOT`, `SERVE_WEB`, `BOTANICAL_VERSION`, `USE_BUNDLED_DATABASE`, `POSTGRES_PASSWORD`, and the provider / search key names listed at the top of that file (`FILE_BACKED_ENV` also accepts `<NAME>_FILE`). The main API does not read `BOTANICAL_SESSION_SECRET`, `COOKIE_SECURE`, or `TRUST_PROXY` (it uses `BOTANICAL_COOKIE_SECURE` and `BOTANICAL_TRUST_PROXY`).

## `scripts/`

| Path | Purpose |
|------|---------|
| `scripts/check-index.ts` | `bun run check:index` |
| `scripts/e2e/run.mjs` | Playwright runner (see [e2e](e2e.md)) |
| `scripts/release/package.sh` | Builds the API and web into a zip |
| `scripts/release/start.sh` | Unzipped release: API and web. Also maps `BOTANICAL_PASSCODE` → `BOTANICAL_PASSWORD` |
| `scripts/release/docker-compose.yml` | Postgres only, for the zip |
| `scripts/release/env.example` | Env template copied into the zip |
| `scripts/release/README.md` | How to run a release zip |
| `scripts/smoke/run.mjs` | Smoke/golden path. Default boots an in-process mock, not compose |
| `scripts/smoke/mock-server.mjs` | That mock |
| `scripts/smoke/scenario.mjs` | Steps |
| `scripts/smoke/harness.test.mjs` | Harness unit test |

Smoke env (not the API): `BOTANICAL_SMOKE_BOOT`, `BOTANICAL_BASE_URL`, `BOTANICAL_API_PREFIX`, `BOTANICAL_MOCK_PROVIDER`, `BOTANICAL_SMOKE_SEND_MESSAGE`, `BOTANICAL_PASSCODE`, `BOTANICAL_PASSWORD`, `BOTANICAL_PORT`, `PORT`, `DEPLOYMENT_MODE` in `scripts/smoke/run.mjs`.

## `config/`

| Path | Purpose |
|------|---------|
| `config/mcp.json` | Default MCP document (no servers). Copied to the API image |
| `config/mcp.example.json` | Sample stdio server. Not the image default |

## CI

`.github/workflows/ci.yml`:

1. `check` — typecheck and `bun test` for every package except `packages/e2e`, after enabling unprivileged user namespaces for the shell jail.
2. `package` — `scripts/release/package.sh`, unzip, `scripts/release/start.sh`, curl API health and `/login`.
3. `release` — on `v*` tags, upload the zip.

Issue forms: `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`. PR checklist: `.github/pull_request_template.md`.

## Where to change X

- **Change the one-command start.** `start.sh` and `start.ps1` together. They read `.env.example` and call `docker-compose.yml` / `docker-compose.cli.yml`.
- **Change the compose API boot.** `deploy/scripts/server-entrypoint.sh` and `Dockerfile`. Pass new env through `docker-compose.yml` only if the process reads it (see [server](server.md)).
- **Change the web image.** `web.Dockerfile` and `packages/web/next.config.ts` (`BOTANICAL_API_URL` is a build arg).
- **Change the release zip.** `scripts/release/package.sh` and `scripts/release/start.sh`.
- **Change CI.** `.github/workflows/ci.yml`. Keep e2e off the default jobs unless a live stack is an explicit decision.
- **Add an env var to the image.** Read it in the owning package, document it in `.env.example`, and add a compose `environment` entry if the container must receive it. `docker-compose.yml` already passes `BOTANICAL_PUBLIC_ORIGIN` (webhook URLs). Scheduler on/off, tick interval, background concurrency, and webhook size are `always_on.*` rows in `settings`, edited from the web Settings page, not compose env. See [db](db.md).
