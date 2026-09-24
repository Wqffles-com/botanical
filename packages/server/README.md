# @botanical/server

HTTP API for Botanical v0: password or passcode auth, agents, chats, messages, model profiles, tools, MCP, and agent-to-agent mail.

Runtime is **Bun**. `SELF_HOST` and `SAAS` are the same server. The deployment mode is a flag plus branding. It does not change auth, routes, or storage.

## Run

```bash
cd packages/server
cp .env.example .env
# set BOTANICAL_PASSWORD and BOTANICAL_PROFILES
bun install
bun src/serve.ts
```

`bun test` covers the API without Postgres. `bun run typecheck` runs `tsc`.

Docker, from this directory:

```bash
docker build -t botanical-server .
docker run --rm -p 8787:8787 \
  -e BOTANICAL_PASSWORD=change-me \
  -e BOTANICAL_COOKIE_SECURE=false \
  -e BOTANICAL_PROFILES='[{"id":"grok","name":"Grok","provider":"xai","model":"grok-4"}]' \
  botanical-server
```

There is no default model. `BOTANICAL_PROFILES` lists the choices, and every chat names one of them.

An agent's `defaultProfileId` is only a suggestion for the picker. It does not select a profile for a chat.

With no `DATABASE_URL`, the memory store starts with three example agents: Gardener (Sprout, green), Builder (Code, blue), and Scout (Search, amber). Postgres gets the same rows from `packages/db` migrations. `icon` is a Lucide name and defaults to `Bot`. `color` is one of `red`, `orange`, `amber`, `green`, `teal`, `cyan`, `blue`, `violet`, `pink`, `gray`, and defaults to `green`. Responses include both `prompt` / `systemPrompt` and `tools` / `toolIds`.

## Auth

One operator. `POST /api/auth/login` accepts `{ "password": "..." }` or `{ "passcode": "..." }`.

The JSON body returns `token`. The same value is set as an `HttpOnly` cookie, `botanical_session`. Call the API with either:

- `Authorization: Bearer <token>`
- the cookie (`credentials: "include"` from a browser)

Bearer is preferred when both are sent. Logout deletes that session only. A second client stays signed in.

Set `BOTANICAL_PASSWORD_HASH` to an argon2 hash from `Bun.password.hash` on a real deploy. If both the hash and `BOTANICAL_PASSWORD` are set, the hash is what login checks.

Failed logins are limited per client address (20 failures / 15 minutes).

## Routes

Error shape: `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/api/health` | no | `deploymentMode`, `brand`, `persistence` |
| GET | `/` | no | Pointer to health |
| POST | `/api/auth/login` | no | Cookie and bearer token |
| POST | `/api/auth/logout` | session | 204, clears the cookie |
| GET | `/api/auth/me` | yes | Operator, brand, session expiry |
| GET | `/api/agents` | yes | |
| POST | `/api/agents` | yes | `name` (1–40), `prompt` (alias `systemPrompt`), optional `icon` (default `Bot`), `color` (default `green`), `description`, `tools` (alias `toolIds`), `defaultProfileId` |
| GET | `/api/agents/:id` | yes | |
| PATCH | `/api/agents/:id` | yes | |
| DELETE | `/api/agents/:id` | yes | 409 `agent_in_use` when the agent owns chats |
| GET | `/api/chats` | yes | Optional `?agentId=` |
| POST | `/api/chats` | yes | `agentId`, `profileId`, optional `title`. One agent per chat |
| GET | `/api/chats/:id` | yes | |
| DELETE | `/api/chats/:id` | yes | Deletes the chat and its messages |
| GET | `/api/chats/:id/messages` | yes | |
| POST | `/api/chats/:id/messages` | yes | Runs the agent loop for the chat's agent |
| GET | `/api/agent-messages?agentId=` | yes | Inbox for that agent. Optional `status` and `limit` |
| POST | `/api/agent-messages` | yes | `{ fromAgentId, toAgentId, body }` then delivers |
| PATCH | `/api/agent-messages/:id` | yes | `{ status }` — pending, delivered, read, or failed |
| GET | `/api/profiles` | yes | `defaultProfileId` is always `null` |
| GET | `/api/tools` | yes | Built-in and MCP tools, each with `source` |
| GET | `/api/mcp/servers` | yes | Configured MCP servers, tool ids, and connect errors |

`POST /api/chats/:id/messages` body is `{ "content": "...", "profileId"?: "...", "stream"?: boolean }`.

The turn runs through `@botanical/agent-runtime`. The agent's `systemPrompt` is the system message. Only tools on the agent's `toolIds` allowlist are offered. The model and tools alternate until the model stops.

- `stream: false` returns JSON `{ userMessage, assistantMessage, profileId }`. A tool turn also includes `toolCall` and `toolResult`. A provider failure (for example a missing server API key) is `error: { code, message }` and `assistantMessage` may be null. The user message is still stored.
- `stream: true`, or `Accept: text/event-stream`, returns server-sent events: `message.created`, `text-delta`, `tool-call`, `tool-result`, `error`, `message.completed`, `done`. Payloads use the core stream types (`text-delta`, `tool-call`, `tool-result`, `error`, `done`).
- Omitting `profileId` uses the profile stored on the chat (the one chosen at create, or the last explicit switch).
- Sending a different configured `profileId` switches the chat. Unknown ids return 422. Nothing is chosen for you.
- The `mock` provider calls `file_list` when that id is on the allowlist, then echoes the user text and the tool output. A user message of the form `send_agent_message {"toAgentId":"…","body":"…"}` calls that tool when it is on the allowlist. It does not use the network.

`GET /api/tools` returns `{ tools: [{ id, name, description, parameters, source, serverId? }] }`. `source` is `builtin` or `mcp`. File tools are registered as `builtin.files`. Shell, web, and MCP packages plug in by exporting `createToolContributor` from `@botanical/tools-shell`, `@botanical/tools-web`, and `@botanical/mcp` (see `@botanical/agent-runtime` tool registry v1). The server loads those factories at startup. MCP servers connected from `BOTANICAL_MCP_CONFIG` are also listed, with ids `mcp:<server>:<tool>`.

## Agent-to-agent messages

`POST /api/agent-messages` stores a row and marks it `delivered`. `GET /api/agent-messages?agentId=` lists that agent's inbox, newest first. `PATCH /api/agent-messages/:id` moves status forward (`pending` → `delivered` or `failed`, `delivered` → `read` or `failed`).

Messages live in `store.agentMessages`. With `DATABASE_URL` unset that repository is in memory. When packages/db returns the same methods, those rows persist in Postgres `agent_messages`.

Set `BOTANICAL_A2A_AUTORUN=true` to run one background turn for the recipient in a chat titled `Inbox`. The turn records the mail and an acknowledgement. It does not call tools. The profile is the inbox chat's profile, the agent's `defaultProfileId` when that field exists and is configured, or the profile on the recipient's newest other chat. There is still no silent global default: with no explicit profile the message stays `delivered` and no chat is created.

During a turn the built-in `send_agent_message` tool sends mail when that id is on the agent's allowlist. The sender is the chat's agent.

## MCP

`BOTANICAL_MCP_CONFIG` is a path to a Claude Desktop `mcpServers` JSON file. On boot the server connects each entry (stdio, streamable HTTP, or SSE) and registers the tools that came up. Ids look like `mcp:echo:echo`. One dead server is reported on `GET /api/mcp/servers` and does not drop the others. A missing or invalid file is a `configError` on that route; the API still starts.

See `config/mcp.example.json` for a local echo fixture. `BOTANICAL_MCP_DISABLED=true` connects nothing.

A chat's agent does not change after create. The first message replaces the title `"New chat"` with a short clip of that message.

## Deployment mode

| `BOTANICAL_DEPLOYMENT_MODE` | Default brand |
|-----------------------------|---------------|
| `SELF_HOST` | Botanical |
| `SAAS` | Botanical Cloud |

`BOTANICAL_BRAND_NAME` overrides either default. Health and `GET /api/auth/me` return the mode and brand so a web client can label itself. Product behavior stays the same in both modes. SaaS multi-user accounts are not part of v0.

`BOTANICAL_CORS_ORIGIN` is one browser origin, for example `http://localhost:5173`.

## Persistence

Repositories live in `src/types.ts` (`Store`: agents, chats, messages, sessions, agent messages).

- `DATABASE_URL` unset: in-memory store. Dev and tests. A restart drops data.
- `DATABASE_URL` set: the server loads `packages/db` and calls `createStore({ connectionString })`. The result must be a `Store` with `kind: "postgres"`. If the package is missing, the process exits. It does not fall back to memory.

Session rows store a SHA-256 of the token, not the token itself. Model API keys are not a database column and are not accepted on any route.

## Model profiles

```json
[
  { "id": "grok", "name": "Grok", "provider": "xai", "model": "grok-4" },
  {
    "id": "local",
    "name": "Local",
    "provider": "openai-compat",
    "model": "llama",
    "baseUrl": "http://127.0.0.1:11434/v1"
  }
]
```

Providers: `openai`, `anthropic`, `xai`, `deepseek`, `openrouter`, `openai-compat`, `mock`.

Provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`) stay in the server environment. Profile JSON rejects `apiKey`.

## What's left

- Postgres `createStore` from `packages/db` is wired when `DATABASE_URL` is set. Message rows now carry tool calls; the db store should persist them and `agent_messages`.
- Shell and web packages register when they export `createToolContributor`.
