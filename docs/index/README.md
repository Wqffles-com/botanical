# Codebase index

Map of this repo for coding agents. Per-package pages: [server](server.md), [agent-runtime](agent-runtime.md), [providers](providers.md), [tools](tools.md), [mcp](mcp.md), [db](db.md), [core](core.md), [web](web.md), [e2e](e2e.md), [deploy and CI](deploy-and-ci.md).

## Repo layout

| Path | Role |
|------|------|
| `package.json` | Root scripts and Bun workspaces (`packages/*`) |
| `bun.lock` | Lockfile for `bun install` |
| `tsconfig.base.json` | Shared TypeScript options |
| `Dockerfile` | API image. Entry `deploy/scripts/server-entrypoint.sh` |
| `web.Dockerfile` | Web image (Next standalone) |
| `packages/server/Dockerfile` | Single-package API image. The supported image is the root `Dockerfile` |
| `docker-compose.yml` | Postgres + API + web |
| `docker-compose.cli.yml` | Opt-in coding-CLI volumes and env on the API service |
| `docker-compose.saas.yml` | Hosted override: no bundled Postgres, mode `SAAS` |
| `profiles.example.json` | Example `BOTANICAL_PROFILES` document |
| `.env.example` | Annotated env template |
| `packages/` | Workspace packages (see graph below) |
| `deploy/` | Image entrypoints, Postgres init, static-web bootstrap, alternate `deploy/server` |
| `scripts/` | e2e runner, release zip, smoke harness |
| `config/` | `config/mcp.json` (empty servers) and `config/mcp.example.json` |
| `docs/` | Product and deploy docs, plus this index |
| `.github/workflows/ci.yml` | Typecheck, unit tests, release zip, smoke boot |
| `.github/pull_request_template.md` | PR checklist |

## Package graph

Declared `@botanical/*` dependencies, and matching imports under each package's `src` (tests excluded).

| Package | `package.json` deps | Imports in `src` |
|---------|---------------------|------------------|
| `@botanical/server` | agent-runtime, core, db, mcp, providers, tools, tools-shell, tools-web | same set |
| `@botanical/web` | core (`file:../core`) | core |
| `@botanical/tools-shell` | tools | tools |
| `@botanical/tools-web` | tools | tools |
| `@botanical/agent-runtime` | none | none |
| `@botanical/providers` | none | none |
| `@botanical/mcp` | none | none |
| `@botanical/tools` | none | none |
| `@botanical/db` | none | none |
| `@botanical/core` | none | none |
| `@botanical/e2e` | none | none |

`packages/server/src/db/postgres.ts` also dynamic-imports `@botanical/db`. `packages/server/src/tools/catalog.ts` dynamic-imports `@botanical/tools-shell`, `@botanical/tools-web`, and `@botanical/mcp` looking for `createToolContributor` (mcp does not export that factory; a failed or missing export is skipped).

Only `packages/providers` implements vendor HTTP and CLI adapters. The runtime and tool packages do not.

## Request flow

1. Browser loads the Next app in `packages/web`. `packages/web/src/proxy.ts` calls `GET /api/auth/me` and redirects anonymous users to `/login`.
2. Browser calls same-origin `/api/*`. `packages/web/next.config.ts` rewrites that prefix to `BOTANICAL_API_URL` (default `http://127.0.0.1:8787`). The browser client is `packages/web/src/lib/api.ts` (`BotanicalClient` from `packages/core/src/client.ts`).
3. `packages/server/src/serve.ts` loads config, opens the store, connects MCP, builds the tool registry, and serves `createApp` (`packages/server/src/app.ts`) on Bun.
4. `POST /api/chats/:id/messages` in `packages/server/src/routes/messages.ts` runs a turn through `packages/server/src/runtime/turn.ts` into `runAgentTurn` (`packages/agent-runtime/src/loop.ts`).
5. The loop asks `packages/providers` for a stream (`packages/server/src/runtime/profiles.ts`), dispatches tools (`packages/agent-runtime/src/tools.ts`, registry from `packages/server/src/tools/catalog.ts`), and reads or writes the store (`packages/server/src/db/store.ts` → memory, or `packages/db` when `DATABASE_URL` is set).
6. SSE replies are encoded in `packages/server/src/streaming.ts`. There is no WebSocket upgrade handler.

## Where config is read

Full name lists are on each package page. Summary of readers:

| What | Where |
|------|--------|
| API listen, auth, profiles, STT, body limit, A2A autorun | `packages/server/src/config.ts` (called from `packages/server/src/serve.ts`) |
| Profile JSON and compat base URL | `packages/providers/src/catalog.ts` |
| Provider API keys | `packages/providers/src/env.ts` |
| Coding CLIs | `packages/providers/src/cli/install.ts`, `packages/providers/src/cli/availability.ts` |
| MCP file or inline JSON | `packages/mcp/src/config.ts` |
| Workspace root for files and shell | `packages/server/src/runtime/workspace.ts`, `packages/tools/src/workspace.ts` |
| Web search and fetch limits | `packages/tools-web/src/web/config.ts` |
| Shell jail limits | `packages/tools-shell/src/shell/options.ts` |
| Postgres URL | `packages/db/src/client.ts`, `packages/db/src/cli.ts` |
| Web → API origin | `packages/web/next.config.ts`, `packages/web/src/proxy.ts`, `packages/web/src/lib/server-api.ts` |
| Compose passcode alias (`BOTANICAL_PASSCODE` → `BOTANICAL_PASSWORD`) | `deploy/scripts/server-entrypoint.sh` |
| Alternate bootstrap server (not the main API) | `deploy/server/src/config.ts` |
| Annotated template | `.env.example` |

`BOTANICAL_SESSION_SECRET` is not read by `packages/server`. The bootstrap in `deploy/server/src/config.ts` does read it.

## Commands

From the repo root, after `bun install` (Bun is the package manager and the API runtime; `package.json` pins the version):

| Script | What it runs |
|--------|----------------|
| `bun run dev` | `packages/server` watch (`bun --watch src/serve.ts`) and `packages/web` (`next dev --port 3101`) |
| `bun run dev:server` / `bun run dev:web` | One of those |
| `bun run typecheck` | `typecheck` in every workspace that defines it |
| `bun run test` | `test` in every workspace that defines it, including `packages/e2e` (that script probes a live web origin) |
| `bun run build` | `build` where defined (`packages/web`, `packages/tools-shell`) |
| `bun run db:migrate` | `packages/db` `migrate` → `packages/db/src/cli.ts` (needs `DATABASE_URL`) |
| `bun run e2e` | `scripts/e2e/run.mjs` against `BASE_URL` (default `http://localhost:3000`) |
| `bun run e2e:self-test` | Same runner with `--self-test` (local fixture, no compose stack) |
| `bun run check:index` | `scripts/check-index.ts` |

CI typecheck and unit-test loops are in `.github/workflows/ci.yml`. They skip `packages/e2e`. Per-package test commands are on each page below.

Do not start compose or run e2e against a live stack unless that was explicitly requested.
