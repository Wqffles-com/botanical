# Testing Botanical v0

Smoke coverage for the hosted server path: liveness, passcode auth, agent create, and chat create. The default run answers the chat turn with an in-process mock provider, so it needs no model API key and no Postgres.

The harness lives at the repo root (`scripts/smoke/`) so it can run before `packages/server` is merged, and can target Compose or the server package once they exist.

## Quick start

From the repo root:

```bash
node scripts/smoke/run.mjs
```

`bun scripts/smoke/run.mjs` is the same entry. The process boots a mock API on `127.0.0.1` (ephemeral port), runs the scenario, shuts the mock down, and exits `0`.

Contract checks against that mock:

```bash
node --test scripts/smoke/harness.test.mjs
```

The default passcode inside the mock is `botanical-smoke` when `BOTANICAL_PASSCODE` and `BOTANICAL_PASSWORD` are unset. That value is a local fixture. The runner does not print it.

## Against Compose or a server that is already up

Assumes the API is already listening. Health, auth, agent create, and chat create are required. The message step is skipped unless the server was started with `BOTANICAL_MOCK_PROVIDER=1` or you set `BOTANICAL_SMOKE_SEND_MESSAGE=1`.

```bash
export BOTANICAL_BASE_URL=http://127.0.0.1:8787
export BOTANICAL_PASSCODE=your-passcode
node scripts/smoke/run.mjs --assume
```

Port `8787` is the default only when `BOTANICAL_BASE_URL` is unset (`BOTANICAL_PORT` or `PORT` overrides it). Point `BOTANICAL_BASE_URL` at whatever Compose publishes.

To start Compose from the harness (requires `docker-compose.yml` or `compose.yml` at the repo root):

```bash
export BOTANICAL_PASSCODE=your-passcode
node scripts/smoke/run.mjs --boot compose --compose-up
```

`--compose-up` runs `docker compose up -d --wait` and leaves the stack running. `--boot compose` without `--compose-up` only waits for `/health`.

## Against packages/server

When `packages/server` has a `start` or `dev` script, or an entry file under `src/index.ts`, the harness can spawn it:

```bash
export BOTANICAL_PASSCODE=botanical-smoke
# export DATABASE_URL=postgres://...   # when that server build needs Postgres
node scripts/smoke/run.mjs --boot server
```

The child receives:

| Variable | Value |
|----------|--------|
| `PORT`, `BOTANICAL_PORT` | Free localhost port chosen by the harness |
| `HOST`, `BOTANICAL_HOST` | `127.0.0.1` |
| `BOTANICAL_PASSCODE`, `BOTANICAL_PASSWORD` | The passcode from the environment |
| `BOTANICAL_MOCK_PROVIDER` | `1` |
| `DEPLOYMENT_MODE` | `self_host` unless already set to `saas` |

A server entry should bind `PORT` and, when `BOTANICAL_MOCK_PROVIDER=1`, answer chat turns locally instead of calling a model vendor. If `/health` does not return HTTP 200 in time, the harness prints the child log and exits `1`.

## What the scenario hits

| Step | Request | Pass condition |
|------|---------|----------------|
| Health | `GET /health` | HTTP 200, `ok: true` (mock also returns `service: "botanical"` and `mockProvider: true`) |
| Auth | `GET /auth/me` with no session | HTTP 401 or 403 |
| Auth | `POST /auth/login` with a wrong passcode | HTTP 401 or 403, no token |
| Auth | `POST /auth/login` `{ "passcode": "..." }` | HTTP 200 and `token` (a `password` field is accepted if `passcode` is rejected with 400/422) |
| Auth | `GET /auth/me` with `Authorization: Bearer` | HTTP 200, authenticated |
| Profiles | `GET /profiles` | HTTP 200, at least one profile, `defaultProfile` null or absent |
| Agent | `POST /agents` | HTTP 201 (200 accepted against an external server) and an id |
| Chat | `POST /chats` without `profileId` | HTTP 400 or 422, no chat id |
| Chat | `POST /chats` with `agentId` and `profileId` | HTTP 201 (200 accepted externally) and an id bound to that agent |
| Read | `GET /agents`, `GET /agents/:id`, `GET /chats`, `GET /chats/:id` | Created records are returned |
| Message | `POST /chats/:id/messages` `{ "content": "ping" }` | HTTP 200 (201 accepted externally) and assistant text. Strict mock expects `mock: ping`. SSE (`text/event-stream` or `data:` lines) is accepted. |
| Auth | `POST /auth/logout`, then `GET /auth/me` | Session is rejected |

`BOTANICAL_API_PREFIX` is prepended to every path (`/api` makes the health URL `/api/health`).

External servers may wrap resources as `{ "agent": { "id" } }`, `{ "data": { "id" } }`, or return the resource itself. The in-process mock returns the resource itself on create, and lists as `{ "agents": [...] }` / `{ "chats": [...] }` / `{ "messages": [...] }`.

### Mock shapes

`GET /health`

```json
{
  "ok": true,
  "service": "botanical",
  "version": "v0-smoke",
  "deploymentMode": "self_host",
  "mockProvider": true,
  "defaultProfile": null
}
```

`deploymentMode` is `self_host` or `saas`, from `DEPLOYMENT_MODE`. Any other value is treated as `self_host`.

`POST /auth/login` → `{ "token", "tokenType": "Bearer", "expiresIn" }` and a `botanical_session` cookie.

`GET /profiles` → one profile, `id: "mock"`, `provider: "mock"`, `model: "mock-echo"`, `defaultProfile: null`.

`POST /chats` without a profile:

```json
{ "error": "profile_required", "message": "Choose a model profile. Botanical has no default model." }
```

`POST /chats/:id/messages` stores the user turn and a mock assistant turn. Completion never leaves the process:

```json
{ "userMessage": { "role": "user", "content": "ping" }, "message": { "role": "assistant", "content": "mock: ping", "provider": "mock", "model": "mock-echo" } }
```

## Mocks

- Default boot implements the routes above in memory. It does not open provider sockets and does not need `DATABASE_URL`.
- `--boot server` sets `BOTANICAL_MOCK_PROVIDER=1` so a real server can skip vendor calls.
- `--assume` / `--boot compose` skip the message step when a live provider might be configured. A message response of HTTP 501/503, or a 5xx body that says the provider or API key is missing, is reported as `SKIP` rather than a failure.
- Every chat create sends an explicit `profileId`. The harness does not select a default model.

## Environment

| Variable | Role |
|----------|------|
| `BOTANICAL_PASSCODE` or `BOTANICAL_PASSWORD` | Server passcode. Required for `--assume`, `--boot compose`, and `--boot server`. |
| `BOTANICAL_BASE_URL` | Origin to call in assume/compose mode. |
| `BOTANICAL_PORT` or `PORT` | Used only to build the default assume URL (`http://127.0.0.1:<port>`). |
| `BOTANICAL_API_PREFIX` | Optional path prefix such as `/api`. |
| `BOTANICAL_SMOKE_BOOT` | `mock` (default), `server`, or `compose`. |
| `BOTANICAL_SMOKE_TIMEOUT_MS` | `/health` wait. Default `20000`. |
| `BOTANICAL_MOCK_PROVIDER` | `1` includes the message step against an already-running server. |
| `BOTANICAL_SMOKE_SEND_MESSAGE` | `1` forces the message step against assume/compose. |
| `DEPLOYMENT_MODE` | `self_host` or `saas`. Forwarded to a spawned server and reflected by the mock health payload. |
| `DATABASE_URL` | Not used by the mock. Required only if the real server needs Postgres. |

The runner reads the process environment. It does not load a `.env` file.

## CLI

```text
node scripts/smoke/run.mjs [--boot mock|server|compose] [--assume]
                           [--compose-up] [--timeout <ms>] [--self-test]
```

| Exit | Meaning |
|------|---------|
| 0 | Every required step passed. Provider skips on an external server are allowed. |
| 1 | A required step failed, or the target could not be booted. |

`--self-test` checks the SSE parser and exits.

Once the workspace `package.json` exists, a root script named `smoke` should run `node scripts/smoke/run.mjs`.

## Out of scope for this harness

Web UI flows, tool execution, MCP, agent-to-agent delivery, and billing. Those belong with the packages that implement them. This harness is the API golden path a CI job can run with no secrets:

```bash
node --test scripts/smoke/harness.test.mjs && node scripts/smoke/run.mjs
```
