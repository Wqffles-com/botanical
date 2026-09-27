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
| `mcp.<server>.<tool>` | MCP grant for that server and tool |

A call is allowed when the allowlist matches (or `a2aEnabled` for runtime A2A tools) **and**, when the agent has roles, the role union permits the capability. Dispatch returns `permission denied: agent "Ada" lacks capability "file.write" (roles: Reviewer)` instead of throwing.

Seeded roles:

| Role | Capabilities | MCP |
| --- | --- | --- |
| Coder | file.read, file.write, shell, code_exec, web, memory.read, memory.write, agent.message | none |
| Reviewer | file.read, web, memory.read | none |
| Orchestrator | all of the above plus agent.create | `{ "server": "*" }` |

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
BOTANICAL_GROK_BIN=/opt/grok/grok
BOTANICAL_CLI_HOME=/var/lib/botanical/cli-home
BOTANICAL_CLI_PROFILES=grok-build
docker compose -f docker-compose.yml -f docker-compose.cli.yml up -d
```

Put `auth.json` at `$BOTANICAL_CLI_HOME/.grok/auth.json`. The grok binary on Alpine must be statically linked. The CLI home mount must be writable by the `botanical` user. The default `docker compose up` does not use this file.

## Workspace scoping

Built-in file tools (`file_read`, `file_write`, `file_list`, `file_delete`) and the working directory of `shell` and `code_exec` use `<BOTANICAL_WORKSPACE>/agents/<agentId>` (the server default when the variable is unset). The directory is created when the agent first uses it. `.` and `/` are that directory.

The agent id is the one running the turn. It is copied onto the tool context at dispatch. The model cannot pass a different id or a path that leaves the directory. `..`, an absolute path outside the directory, and a symlink that resolves outside it (including a not-yet-existing write whose nearest existing parent is outside) return a tool error such as `path "../x" is outside this agent's workspace`.

There is no shared file directory. Agents do not see each other's files through these tools. Shared memory rows are unchanged; that scope is for memories, not files.

`shell` and `code_exec` are not an extra filesystem sandbox. Their cwd is the agent directory, and a `cwd` argument must stay there, but a command can still refer to any path the existing jail mounts (for example read-only `/usr`). If the jail cannot start, the tool errors and does not fall back to an unjailed process. CLI profiles use this same agent directory as their cwd.

## Known limitations

- A CLI's own native tools (its shell and file edits) run in the same per-agent directory as Botanical file tools, `/data/agents/<agentId>` or `BOTANICAL_WORKSPACE/agents/<agentId>`, but they do not pass through Botanical's role checks. Roles govern the Botanical tools the CLI calls over MCP.
- A CLI decides for itself which listed tools to call. Grok refuses to call a tool that is not in `tools/list`, so for a role without a capability the tool is simply absent; the dispatch-time denial is the backstop for clients that call unlisted names.
- Two turns running at the same time for the same agent both write `<agent dir>/.grok/config.toml`. Cleanup restores the snapshot each run took, so a stale `botanical` entry (without a token) can be left behind until the next Grok turn in that folder.
- For CLI turns, Botanical tool cards are shown after the assistant text of the turn, because the CLI's text and tool calls arrive as one step.
- `shell` and `code_exec` cwd scoping is not a second filesystem sandbox. Isolation is whatever the existing jail already enforces. A command can still name paths that jail mounts.
- Grok incremental text uses `streaming-messages-json`, not ACP `streaming-json`. Both shapes are parsed.
- Claude and Codex are not installed in the default image. Mount them the same way as grok if you enable those presets.
- Availability results are cached for about 15 seconds.
- Memory retrieval is recent rows plus substring overlap, not embeddings.
- The operator REST API can read every memory. Isolation applies to agent tools and the prompt.
- Builtin role permissions can be edited. A later migration will not overwrite that edit (`ON CONFLICT DO NOTHING`).
- Agents with no roles are not migrated onto a role. That is intentional.
