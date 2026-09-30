# Backend: CLI profiles, memory, agents, and roles

This page is the API reference for four server features: CLI model profiles, memories, agents that create agents, and roles. The reasoning behind them is in [DECISIONS.md](./DECISIONS.md). Running the CLIs in Docker is covered in [DEPLOY.md](./DEPLOY.md).

## Overview

1. **CLI profiles** (`kind: "cli"`) for Grok Build, Claude Code, and Codex. The server spawns the binary without a shell in the agent's workspace, passes the conversation as one prompt by file or stdin, and streams text back as the usual `text-delta` SSE events. Each turn exposes Botanical's tools and the operator's MCP tools to the CLI through a per-run MCP endpoint. Unavailable profiles stay on the profile list. A chat turn on one returns `422 profile_unavailable`.
2. **Memories** in Postgres (and the in-memory store) with `shared` and `agent` scope, a REST API, four built-in tools, and a `## Memories` section injected at turn start.
3. **`agent_create` / `agent_list`.** Creation uses the same validation as `POST /api/agents` and stores `createdByAgentId`. The caller cannot grant tools or roles beyond its own ceiling.
4. **Roles.** Three seeded builtin roles, CRUD, and enforcement at tool dispatch. Agents with no roles keep allowlist-only behavior.

## API examples

There is still no default profile (`defaultProfileId` is always `null`).

### Profiles

`GET /api/profiles`

```json
{
  "profiles": [
    {
      "id": "mock",
      "name": "Mock",
      "provider": "mock",
      "model": "echo",
      "description": "In-process echo. No API key.",
      "kind": "api",
      "available": true
    },
    {
      "id": "grok-build",
      "name": "Grok Build",
      "provider": "cli",
      "model": "grok",
      "description": "Grok Build headless. Botanical tools and your MCP servers are exposed on a per-run loopback MCP server named botanical.",
      "kind": "cli",
      "cli": "grok",
      "available": false,
      "unavailableReason": "grok is not on PATH"
    }
  ],
  "defaultProfileId": null
}
```

`model` is the CLI name when the profile does not set `model`. Botanical does not pass `-m` in that case.

A turn on an unavailable CLI profile:

```json
{ "error": { "code": "profile_unavailable", "message": "CLI binary not found at /no/such/grok" } }
```

### Memories

`POST /api/memories`

```json
{ "scope": "agent", "agentId": "11111111-1111-4111-8111-111111111111", "content": "Ferns like shade.", "tags": ["plants"] }
```

```json
{
  "memory": {
    "id": "…",
    "scope": "agent",
    "agentId": "11111111-1111-4111-8111-111111111111",
    "content": "Ferns like shade.",
    "tags": ["plants"],
    "createdAt": "2026-09-27T00:00:00.000Z",
    "updatedAt": "2026-09-27T00:00:00.000Z"
  }
}
```

`GET /api/memories?scope=shared&q=fern&tag=plants&limit=20` returns `{ "memories": [ … ] }`.

`GET /api/memories/:id`, `PATCH /api/memories/:id` with `{ "content", "tags" }`, `DELETE /api/memories/:id`.

The operator API can see every memory. Agent tools cannot see another agent's private rows.

### Roles

`GET /api/roles` includes Coder, Reviewer, and Orchestrator (`builtin: true`).

`POST /api/roles`

```json
{
  "name": "Scribe",
  "description": "Notes only",
  "permissions": { "capabilities": ["memory.read", "memory.write"], "mcp": [{ "server": "notes", "tools": ["search"] }] }
}
```

`PATCH /api/roles/:id` may change `description` and `permissions`. Builtin names cannot change. `DELETE` of a builtin role is `409 builtin_role`. Deleting a role that is still assigned is `409 role_in_use`.

`GET /api/agents/:id/roles` → `{ "roleIds": ["…"], "roles": [ … ] }`

`PUT /api/agents/:id/roles`

```json
{ "roleIds": ["Reviewer", "00000000-0000-4000-8000-0000000000c1"] }
```

Ids or unique names are accepted.

### Agent fields

`POST /api/agents` and `PATCH /api/agents/:id` accept optional `roleIds`. Responses add:

```json
{
  "agent": {
    "id": "…",
    "name": "Ada",
    "createdByAgentId": null,
    "roleIds": ["00000000-0000-4000-8000-0000000000c2"],
    "roles": [{ "id": "00000000-0000-4000-8000-0000000000c2", "name": "Reviewer", "builtin": true, "permissions": { "capabilities": ["file.read", "web", "memory.read"], "mcp": [] } }],
    "effectivePermissions": {
      "unrestricted": false,
      "capabilities": ["file.read", "web", "memory.read"],
      "mcp": [],
      "roleNames": ["Reviewer"]
    }
  }
}
```

`unrestricted: true` and empty `capabilities` means the agent has no roles and is still gated only by its tool allowlist.

## Tools and capabilities

| Tool | Capability |
| --- | --- |
| `file_read`, `file_list` | `file.read` |
| `file_write`, `file_delete` | `file.write` |
| `shell` | `shell` |
| `code_exec` | `code_exec` |
| `web_search`, `web_fetch` | `web` |
| `memory_search`, `memory_list` | `memory.read` |
| `memory_write`, `memory_delete` | `memory.write` |
| `agent_create` | `agent.create` |
| `agent_list`, `send_agent_message`, `agent_send`, `agent_inbox` | `agent.message` |
| `notify_user` | `notify` |
| `mcp.<server>.<tool>` | MCP grant for that server and tool |

A call is allowed when the allowlist matches (or `a2aEnabled` for runtime A2A tools) **and**, when the agent has roles, the role union permits the capability. Dispatch returns `permission denied: agent "Ada" lacks capability "file.write" (roles: Reviewer)` instead of throwing.

Seeded roles:

| Role | Capabilities | MCP |
| --- | --- | --- |
| Coder | file.read, file.write, shell, code_exec, web, memory.read, memory.write, agent.message, git, github | none |
| Reviewer | file.read, web, memory.read | none |
| Orchestrator | all of the above plus agent.create and notify | `{ "server": "*" }` |

Fixed ids: Coder `00000000-0000-4000-8000-0000000000c1`, Reviewer `…c2`, Orchestrator `…c3`.

## CLI profiles and Botanical tools

A CLI turn runs the CLI in the agent's workspace directory. For the length of that turn the server also serves an MCP endpoint that only this run can use:

```
POST /internal/mcp/runs/<runId>
Authorization: Bearer <per-run token>
```

- **Transport.** MCP over streamable HTTP with JSON responses. Supported methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- **Tools.** `tools/list` returns exactly what an API-model turn for the same agent would get: the built-in tools on the agent's allowlist (memory, `agent_create` / `agent_list`, files, shell, web), plus the operator's MCP tools, filtered by the agent's roles. MCP tools use their model-facing names such as `mcp__notes__search`. The server is named `botanical`, so a CLI shows `mcp__botanical__memory_write` and so on.
- **Enforcement.** `tools/call` uses the same dispatch function as the agent loop: allowlist, role capability check, then the tool itself with the agent's workspace scoping, limits, and output truncation. A denied call is a normal MCP result with `isError: true` and the same text an API turn gets, for example `permission denied: agent "Ada" lacks capability "memory.write" (roles: Reviewer)`.
- **Identity.** The run is bound to the agent, chat, and turn when it opens. Nothing the CLI sends can change the agent.
- **Auth and lifetime.** A fresh 32-byte random token per run, compared in constant time. Session cookies are not accepted. The token is revoked when the turn ends for any reason (finish, error, cancel, timeout). Afterwards the URL returns `404`. A live run with a missing or wrong token returns `401`.
- **Address.** The CLI is a child process of the server, so the URL defaults to `http://127.0.0.1:<PORT>`. Set `BOTANICAL_INTERNAL_URL` if the server is reachable from its own process some other way.
- **Chat history.** Calls made through the endpoint stream as `tool-call` / `tool-result` events and are stored as tool messages, so they show up as tool cards. The CLI's native tools (its own shell, file edits) are not recorded as Botanical tool calls.
- **Opt out.** `"botanicalTools": false` on a CLI profile in `BOTANICAL_PROFILES` turns the endpoint off for that profile. Presets from `BOTANICAL_CLI_PROFILES` have it on.

How each CLI is pointed at the endpoint and given the prompt:

| CLI | Prompt | MCP configuration |
| --- | --- | --- |
| Grok Build (`grok`) | `--prompt-file <temp file>` (mode 0600, deleted after the run) | Grok has no MCP config flag. `[mcp_servers.botanical]` is written to `<agent dir>/.grok/config.toml` for the run and the previous file is restored (or removed) afterwards. `.mcp.json` is never touched. The header is `Authorization = "Bearer ${BOTANICAL_MCP_TOKEN}"`, expanded by Grok from the child environment. The child also gets `GROK_FOLDER_TRUST=0`, because Grok only starts project-scoped MCP servers in trusted folders and agent folders are not in the CLI's trust store. |
| Claude Code (`claude`) | stdin, with `-p` | `--mcp-config <temp file> --strict-mcp-config --allowedTools mcp__botanical__*`. The config file uses `${BOTANICAL_MCP_TOKEN}` in the header and is deleted after the run. |
| Codex (`codex`) | stdin, with `codex exec … -` | `-c mcp_servers.botanical.url=<endpoint>` and `-c mcp_servers.botanical.bearer_token_env_var=BOTANICAL_MCP_TOKEN`. |

The token is only ever in the child's environment, never in argv or in a file. Claude Code and Codex are not in the default image; their flags follow the published CLI references ([Claude Code](https://code.claude.com/docs/en/cli-reference), [Codex](https://developers.openai.com/codex/mcp)).

Chat SSE streams send a `: ping` comment after 5 seconds without an event. Bun closes connections that are idle for 10 seconds, and a CLI is often silent while it looks up or runs tools.

## Enable CLI profiles in Docker

```sh
BOTANICAL_CLI_PROFILES=grok-build
docker compose -f docker-compose.yml -f docker-compose.cli.yml up --build -d
```

The API image installs the Linux build into the `cli_bin` volume (`/opt/botanical-cli`) and keeps config in `cli_home` (`/home/botanical`). Sign in from Settings → Coding CLIs (`GET/POST /api/cli`, behind the passcode session) or with:

```sh
docker compose exec -u botanical server grok login --device-auth
docker compose exec -u botanical server codex login --device-auth
docker compose exec -it -u botanical server claude setup-token
```

The default `docker compose up` does not use this file. Optional version pins: `BOTANICAL_GROK_VERSION`, `BOTANICAL_CLAUDE_VERSION`, `BOTANICAL_CODEX_VERSION`. `BOTANICAL_CLI_AUTO_INSTALL=0` skips install at startup.

### Coding CLI HTTP API

All of these require the passcode session. `:cli` is `grok`, `claude`, or `codex`, and it must be one of the enabled profiles.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/cli` | Enabled CLIs: id, label, cli, status (`not_installed`, `installing`, `installed`, `failed`), version, arch, `loggedIn` (`true`, `false`, or `"unknown"`), lastError |
| POST | `/api/cli/:cli/install` | `{ "update": true }` re-resolves latest. `{}` installs when missing or when a pin does not match |
| POST | `/api/cli/:cli/login` | Starts the CLI's headless login. 409 if one is already running |
| GET | `/api/cli/:cli/login` | verification URL, user code, prompt, state (`idle`, `pending`, `needs_input`, `done`, `failed`, `expired`, `cancelled`) |
| POST | `/api/cli/:cli/login/input` | `{ "input": "..." }` when the CLI is waiting for a pasted code or token |
| DELETE | `/api/cli/:cli/login` | Cancels and kills the child |

Login responses never include credential file contents. Output lines are ANSI-stripped and token-shaped strings are replaced with `[redacted]`.

## Workspace scoping

Built-in file tools (`file_read`, `file_write`, `file_list`, `file_delete`) and the working directory of `shell` and `code_exec` use `<BOTANICAL_WORKSPACE>/agents/<agentId>` (the server default when the variable is unset). The directory is created when the agent first uses it. `.` and `/` are that directory.

The agent id is the one running the turn. It is copied onto the tool context at dispatch. The model cannot pass a different id or a path that leaves the directory. `..`, an absolute path outside the directory, and a symlink that resolves outside it (including a not-yet-existing write whose nearest existing parent is outside) return a tool error such as `path "../x" is outside this agent's workspace`.

There is no shared file directory. Agents do not see each other's files through these tools. Shared memory rows are unchanged; that scope is for memories, not files.

`shell` and `code_exec` are not an extra filesystem sandbox. Their cwd is the agent directory, and a `cwd` argument must stay there, but a command can still refer to any path the existing jail mounts (for example read-only `/usr`). If the jail cannot start, the tool errors and does not fall back to an unjailed process. CLI profiles use this same agent directory as their cwd.

## Always-on API

Passcode session, same as the other operator routes, except `POST /api/hooks/:listenerId`. That path is public and checks the listener secret. There is still no default profile: create requires `profileId`.

`routines`, `listeners`, and `notifications` store a required `user_id`. v0 fills the single operator (a notification follows the owning agent's user). List and get already filter by that user. `routine_runs` and `listener_deliveries` inherit ownership through the parent. When accounts land, the same columns are enforced per user. They are operator-owned now, not a later migration.

### Routines

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/routines?agentId=` | Each item includes `lastRun` |
| POST | `/api/routines/preview` | `{ cron, timezone }` → `{ valid, error?, next }` (five ISO times) |
| POST | `/api/routines` | `{ agentId, name, prompt, cron, timezone, profileId, enabled? }` |
| GET | `/api/routines/:id` | |
| PATCH | `/api/routines/:id` | Profile, cron, timezone, prompt, name, enabled |
| DELETE | `/api/routines/:id` | |
| POST | `/api/routines/:id/pause` | |
| POST | `/api/routines/:id/resume` | Next run jumps to the next future slot |
| POST | `/api/routines/:id/run` | Manual trigger. Works while paused. Returns the run |
| GET | `/api/routines/:id/runs?limit=&offset=` | Newest first |

Cron is five fields. Anything faster than once a minute is rejected. Timezone is an IANA name.

A schedule run inserts `routine_runs` with `trigger: "schedule"` and posts into the agent's chat (one chat per agent). Status moves `queued` → `running` → `succeeded` or `failed`. `error` is set on failure. `chatId` links the transcript.

### Listeners

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/listeners?agentId=` | No `secret`. Includes `url` |
| POST | `/api/listeners` | Returns `listener`, `secret`, and `url` once |
| GET | `/api/listeners/:id` | No `secret` |
| PATCH | `/api/listeners/:id` | Name, profile, template, enabled |
| DELETE | `/api/listeners/:id` | |
| POST | `/api/listeners/:id/rotate-secret` | Returns the new `secret` and `url` once |
| GET | `/api/listeners/:id/deliveries?limit=&offset=` | Newest first |
| POST | `/api/hooks/:listenerId` | **No passcode.** 202 `{ deliveryId }` |

Verification is `X-Botanical-Signature: sha256=<hex>` or `X-Hub-Signature-256` with the same HMAC-SHA256 of the raw body, or `Authorization: Bearer <secret>`, or `X-Botanical-Token`. Unknown listener and bad signature are both 401 with the same body. Disabled, after a valid secret, is 403. A body over `always_on.listener_max_bytes` (default 65536) is 413. Rejected attempts are stored when the listener exists.

`kind` is `webhook`. The prompt template may use `{{payload}}`, `{{listener}}`, and `{{received_at}}`. `{{payload}}` is wrapped in `<untrusted_webhook_payload>` under a fixed preamble. Empty template uses that default.

### Notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/notifications?limit=&offset=` | Unread first, then newest. Includes `unreadCount` |
| POST | `/api/notifications/:id/read` | |
| POST | `/api/notifications/read-all` | `{ updated }` |

Kinds include `run_succeeded`, `run_failed`, and `attention` (`notify_user`). `notify_user` is a built-in with capability `notify`. It follows the allowlist, and role checks when the agent has roles. Orchestrator includes `notify`. Coder and Reviewer do not, until an operator adds it.

### Instance settings

Instance-admin. Passcode-gated today. When accounts land, restrict these routes to admins. They are not per-user settings. Values live in the `settings` table. Absent keys use the defaults. Numbers outside the range are clamped. A wrong type is 400. A saved value applies without a restart, within about a minute. The scheduler interval applies on the next tick.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/settings/always-on` | `{ settings }` |
| PATCH | `/api/settings/always-on` | Partial `{ schedulerEnabled?, schedulerIntervalMs?, backgroundConcurrency?, listenerMaxBytes? }` |

| Key | Default | Range |
| --- | --- | --- |
| `always_on.scheduler_enabled` | `true` | boolean |
| `always_on.scheduler_interval_ms` | `15000` | 1000–3600000 |
| `always_on.background_concurrency` | `2` | 1–32 |
| `always_on.listener_max_bytes` | `65536` | 1–5000000 |

`createApp({ scheduler: false })` keeps the process from starting the interval. That is an app option, not an environment variable.

### Background turns

Routine runs, webhook deliveries, and interactive chat messages share one turn function: agent prompt, memories, allowlist, role enforcement, MCP, and CLI profiles with the per-run Botanical MCP endpoint. Messages are stored as a normal chat. A2A autorun still uses its tool-less inbox turn and writes a notification when that turn finishes or fails.

## Known limitations

- A CLI child does not receive Botanical's passcode, session secret, `DATABASE_URL`, Postgres password, `BOTANICAL_MCP_SERVERS`, or provider keys that CLI does not use for its own auth. Grok may see `XAI_API_KEY`, Claude `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`, Codex `OPENAI_API_KEY` and `CODEX_API_KEY`. Empty values are omitted, so a blank key from Compose does not override a device login. The per-run MCP token is still added to that child's environment. `PATH`, `HOME`, `TMPDIR`, `LANG`, proxy variables, and `USE_BUILTIN_RIPGREP` are kept.
- A CLI's own native tools (its shell and file edits) run in the same per-agent directory as Botanical file tools, `/data/agents/<agentId>` or `BOTANICAL_WORKSPACE/agents/<agentId>`, but they do not pass through Botanical's role checks. Roles govern the Botanical tools the CLI calls over MCP.
- A CLI decides for itself which listed tools to call. Grok refuses to call a tool that is not in `tools/list`, so for a role without a capability the tool is simply absent; the dispatch-time denial is the backstop for clients that call unlisted names.
- Two turns running at the same time for the same agent both write `<agent dir>/.grok/config.toml`. Cleanup restores the snapshot each run took, so a stale `botanical` entry (without a token) can be left behind until the next Grok turn in that folder.
- For CLI turns, Botanical tool cards are shown after the assistant text of the turn, because the CLI's text and tool calls arrive as one step.
- `shell` and `code_exec` cwd scoping is not a second filesystem sandbox. Isolation is whatever the existing jail already enforces. A command can still name paths that jail mounts.
- Grok incremental text uses `streaming-messages-json`, not ACP `streaming-json`. Both shapes are parsed.
- Claude and Codex are not in the default `docker compose up` image. `docker-compose.cli.yml` installs the Linux builds into a volume. Claude's headless login is `claude setup-token` (paste the token; the CLI does not save it). Grok and Codex use device-code login and do not need a terminal.
- Availability results are cached for about 15 seconds. Install and login clear that cache.
- Memory retrieval is recent rows plus substring overlap, not embeddings.
- The operator REST API can read every memory. Isolation applies to agent tools and the prompt.
- Builtin role permissions can be edited. A later migration will not overwrite that edit (`ON CONFLICT DO NOTHING`).
- Agents with no roles are not migrated onto a role. That is intentional.
