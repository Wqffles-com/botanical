# Server

[Index](README.md)

HTTP API: passcode auth, agents, chats, streaming turns, agent-to-agent mail, memory, roles, MCP listing, CLI install/login, dictation.

- Package: `@botanical/server`
- Library entry: `packages/server/src/index.ts` (`package.json` `exports`)
- Process entry: `packages/server/src/serve.ts` (`bun src/serve.ts`, script `start` / `dev`)
- App wiring: `packages/server/src/app.ts` (`createApp`)

## Directories

| Path | Purpose |
|------|---------|
| `packages/server/src/router.ts` | Method + path table, auth wrapper, global `OPTIONS` |
| `packages/server/src/routes` | One `register*` function per area |
| `packages/server/src/http.ts` | JSON helpers, body limit, CORS finish |
| `packages/server/src/config.ts` | `loadConfig` |
| `packages/server/src/auth` | Passcode verify, session cookie, login rate limit |
| `packages/server/src/db` | In-memory store and Postgres adapter |
| `packages/server/src/runtime` | Turn runner, profile resolver, workspace path, store adapter |
| `packages/server/src/streaming.ts` | SSE encode and heartbeat |
| `packages/server/src/tools` | Builtin contributors (files, shell, web, memory, agent admin, MCP) |
| `packages/server/src/a2a` | Agent-message bus service and `send_agent_message` |
| `packages/server/src/mcp-host.ts` | Boot MCP and snapshot for `GET /api/mcp/servers` |
| `packages/server/src/cli-mcp.ts` | Per-run MCP endpoint for CLI profiles |
| `packages/server/src/cli-install` | Install and device-login for coding CLIs |
| `packages/server/src/speech` | Speech-to-text provider calls |
| `packages/server/src/provider-host.ts` | Holds the provider registry on the config object |
| `packages/server/test` | `bun test` files |

## Exports

From `packages/server/src/index.ts`: `createApp`, `loadConfig`, `createStore`, `createMemoryStore`, `createA2AService`, `createSendAgentMessageTool`, `startServerMcp`, `emptyServerMcp`, `createDefaultToolRegistry`, `ConfigError`, `SERVER_VERSION`. Types include `App`, `ServerConfig`, `Store`, `Agent`, `Chat`, `Message`.

## HTTP routes

Registered only through `router.add` in the handler file. `packages/server/src/app.ts` calls each `register*`. `OPTIONS` on any path returns 204 from `packages/server/src/router.ts` (not a registered route). No WebSocket handler.

`POST /api/chats/:id/messages` is SSE when the JSON body has `stream: true`, or when `stream` is omitted and `Accept` contains `text/event-stream` (`packages/server/src/streaming.ts`).

| Method | Path | Handler |
|--------|------|---------|
| GET | `/` | `packages/server/src/routes/health.ts` |
| GET | `/api/health` | `packages/server/src/routes/health.ts` |
| GET | `/health` | `packages/server/src/routes/health.ts` |
| GET | `/ready` | `packages/server/src/routes/health.ts` |
| POST | `/api/auth/login` | `packages/server/src/routes/auth.ts` |
| POST | `/api/auth/logout` | `packages/server/src/routes/auth.ts` |
| GET | `/api/auth/me` | `packages/server/src/routes/auth.ts` |
| GET | `/api/agents` | `packages/server/src/routes/agents.ts` |
| POST | `/api/agents` | `packages/server/src/routes/agents.ts` |
| GET | `/api/agents/:id` | `packages/server/src/routes/agents.ts` |
| PATCH | `/api/agents/:id` | `packages/server/src/routes/agents.ts` |
| DELETE | `/api/agents/:id` | `packages/server/src/routes/agents.ts` |
| GET | `/api/agents/:id/roles` | `packages/server/src/routes/roles.ts` |
| PUT | `/api/agents/:id/roles` | `packages/server/src/routes/roles.ts` |
| GET | `/api/roles` | `packages/server/src/routes/roles.ts` |
| POST | `/api/roles` | `packages/server/src/routes/roles.ts` |
| GET | `/api/roles/:id` | `packages/server/src/routes/roles.ts` |
| PATCH | `/api/roles/:id` | `packages/server/src/routes/roles.ts` |
| DELETE | `/api/roles/:id` | `packages/server/src/routes/roles.ts` |
| GET | `/api/memories` | `packages/server/src/routes/memories.ts` |
| POST | `/api/memories` | `packages/server/src/routes/memories.ts` |
| GET | `/api/memories/:id` | `packages/server/src/routes/memories.ts` |
| PATCH | `/api/memories/:id` | `packages/server/src/routes/memories.ts` |
| DELETE | `/api/memories/:id` | `packages/server/src/routes/memories.ts` |
| GET | `/api/chats` | `packages/server/src/routes/chats.ts` |
| POST | `/api/chats` | `packages/server/src/routes/chats.ts` |
| GET | `/api/chats/:id` | `packages/server/src/routes/chats.ts` |
| PATCH | `/api/chats/:id` | `packages/server/src/routes/chats.ts` |
| DELETE | `/api/chats/:id` | `packages/server/src/routes/chats.ts` |
| GET | `/api/chats/:id/messages` | `packages/server/src/routes/messages.ts` |
| POST | `/api/chats/:id/messages` | `packages/server/src/routes/messages.ts` |
| GET | `/api/agent-messages` | `packages/server/src/routes/agent-messages.ts` |
| POST | `/api/agent-messages` | `packages/server/src/routes/agent-messages.ts` |
| PATCH | `/api/agent-messages/:id` | `packages/server/src/routes/agent-messages.ts` |
| GET | `/api/profiles` | `packages/server/src/routes/profiles.ts` |
| GET | `/api/tools` | `packages/server/src/routes/tools.ts` |
| GET | `/api/mcp/servers` | `packages/server/src/routes/mcp.ts` |
| GET | `/api/capabilities` | `packages/server/src/routes/transcription.ts` |
| POST | `/api/transcriptions` | `packages/server/src/routes/transcription.ts` |
| GET | `/api/cli` | `packages/server/src/routes/cli.ts` |
| POST | `/api/cli/:cli/install` | `packages/server/src/routes/cli.ts` |
| POST | `/api/cli/:cli/login` | `packages/server/src/routes/cli.ts` |
| GET | `/api/cli/:cli/login` | `packages/server/src/routes/cli.ts` |
| POST | `/api/cli/:cli/login/input` | `packages/server/src/routes/cli.ts` |
| DELETE | `/api/cli/:cli/login` | `packages/server/src/routes/cli.ts` |
| POST | `/internal/mcp/runs/:runId` | `packages/server/src/cli-mcp.ts` |
| GET | `/internal/mcp/runs/:runId` | `packages/server/src/cli-mcp.ts` |
| DELETE | `/internal/mcp/runs/:runId` | `packages/server/src/cli-mcp.ts` |

`GET` and `DELETE` on `/internal/mcp/runs/:runId` are registered and then answered 405 after the run token check. The CLI uses `POST` JSON-RPC (`initialize`, `ping`, `tools/list`, `tools/call`). Session cookies do not authenticate that path.

## Env vars

`loadConfig` in `packages/server/src/config.ts` reads: `BOTANICAL_DEPLOYMENT_MODE`, `BOTANICAL_BRAND_NAME`, `BOTANICAL_PASSWORD`, `BOTANICAL_PASSWORD_HASH`, `DATABASE_URL`, `BOTANICAL_HOST`, `BOTANICAL_PORT`, `PORT`, `BOTANICAL_SESSION_TTL_SECONDS`, `BOTANICAL_COOKIE_SECURE`, `BOTANICAL_CORS_ORIGIN`, `BOTANICAL_TRUST_PROXY`, `BOTANICAL_MAX_BODY_BYTES`, `BOTANICAL_A2A_AUTORUN`, `BOTANICAL_CLI_PROFILES`, `BOTANICAL_STT_MAX_BYTES`, `BOTANICAL_STT_MAX_SECONDS`, `BOTANICAL_STT_DISABLED`, `BOTANICAL_STT_PROVIDER`, `BOTANICAL_STT_BASE_URL`, `BOTANICAL_STT_MODEL`, `BOTANICAL_STT_API_KEY`, `OPENAI_API_KEY`. STT presets also read `OPENROUTER_API_KEY`, `XAI_API_KEY`, or `DASHSCOPE_API_KEY` by provider name.

Profile documents and provider keys are read via `packages/providers` (see [providers](providers.md)). It does not read `BOTANICAL_PASSCODE`; `deploy/scripts/server-entrypoint.sh` copies that into `BOTANICAL_PASSWORD` before start.

| File | Also reads |
|------|------------|
| `packages/server/src/serve.ts` | `BOTANICAL_CLI_AUTO_INSTALL` |
| `packages/server/src/runtime/workspace.ts` | `BOTANICAL_WORKSPACE`, `BOTANICAL_WORKSPACE_ROOT` |
| `packages/server/src/cli-mcp.ts` | `BOTANICAL_INTERNAL_URL` |
| `packages/server/src/cli-install/service.ts` | `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` |

## Tests

`packages/server/test`. From that package: `bun test`. From the root, `bun run --cwd packages/server test`.

`packages/server/test/postgres-store.test.ts` skips unless `BOTANICAL_TEST_DATABASE_URL` is set. A throwaway Postgres file is `packages/db/docker-compose.test.yml` (do not start it unless asked).

## Where to change X

- **Add an API route.** Add `router.add` in a file under `packages/server/src/routes`, export a `register*` function, and call it from `packages/server/src/app.ts`. Mirror the path on `packages/core/src/paths.ts` and `packages/core/src/client.ts` if the web client should call it.
- **Add a tool visible to the model.** Builtin file/shell/web contributors are registered in `packages/server/src/tools/catalog.ts`. Memory, agent admin, and `send_agent_message` are registered in `packages/server/src/app.ts`.
- **Change auth.** `packages/server/src/routes/auth.ts`, `packages/server/src/auth/session.ts`, `packages/server/src/auth/password.ts`.
- **Change streaming.** `packages/server/src/routes/messages.ts` and `packages/server/src/streaming.ts`.
- **Add an env var the API reads.** `packages/server/src/config.ts` (or the specific module above), then `.env.example` and this page.
