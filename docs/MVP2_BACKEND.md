# MVP2 backend

Implemented on branch `feat/mvp2-backend` (2026-09-27). This slice is server-side: CLI model profiles, memories, agents creating agents, and roles. The web package was touched only so the shared `Agent` type still typechecks.

Decisions live in [DECISIONS.md](./DECISIONS.md). Deployment of the CLIs is in [DEPLOY.md](./DEPLOY.md).

## What was implemented

1. **CLI profiles** (`kind: "cli"`) for Grok Build, Claude Code, and Codex. The server spawns the binary without a shell, renders the conversation as one prompt, and streams text back as the existing `text-delta` SSE events. Unavailable profiles stay on the profile list. A chat turn on one returns `422 profile_unavailable`.
2. **Memories** in Postgres (and the in-memory store) with `shared` and `agent` scope, a REST API, four built-in tools, and a `## Memories` section injected at turn start.
3. **`agent_create` / `agent_list`.** Creation uses the same validation as `POST /api/agents` and stores `createdByAgentId`. The caller cannot grant tools or roles beyond its own ceiling.
4. **Roles.** `roles` and `agent_roles`, three seeded builtin roles, CRUD, and dispatch-time enforcement. Agents with no roles keep allowlist-only behavior.

## Files touched

- `packages/providers/src/cli/` — spawn, JSON parsers, availability, profile config
- `packages/providers/test/cli.test.ts` and `test/fixtures/fake-cli.ts`
- `packages/agent-runtime/src/permissions.ts`, `memories.ts`, `loop.ts`, `prompt.ts`
- `packages/agent-runtime/test/permissions.test.ts`
- `packages/db/migrations/0003_mvp2.sql`, `sql/guards.sql`, schema and `src/mvp2.ts`, `src/store.ts`
- `packages/server/src/db/platform.ts`, `memory.ts`, routes `memories.ts` and `roles.ts`, tools `memory.ts` and `agent-admin.ts`, config, profile resolver, app wiring
- `packages/server/test/mvp2.test.ts`
- `packages/core` types, normalizers, and client methods
- `packages/web/src/lib/chat-stream.test.ts` (new required agent fields)
- `docker-compose.cli.yml`, `.env.example`, `profiles.example.json`
- `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`

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
      "description": "Grok Build headless. The CLI runs its own tools; Botanical tools are not sent.",
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

## Enable CLI profiles in Docker

```sh
BOTANICAL_GROK_BIN=/opt/grok/grok
BOTANICAL_CLI_HOME=/var/lib/botanical/cli-home
BOTANICAL_CLI_PROFILES=grok-build
docker compose -f docker-compose.yml -f docker-compose.cli.yml up -d
```

Put `auth.json` at `$BOTANICAL_CLI_HOME/.grok/auth.json`. The grok binary on Alpine must be statically linked. The CLI home mount must be writable by the `botanical` user. The default `docker compose up` does not use this file.

## Known limitations

- CLI profiles do not receive Botanical tools or MCP. The CLI's own tools run in `/data/agents/<agentId>` (or `BOTANICAL_WORKSPACE/agents/<agentId>`).
- Prompt text is passed as an argv argument (`-p` or the Codex positional). Very large transcripts can hit the OS argument limit.
- Grok incremental text uses `streaming-messages-json`, not ACP `streaming-json`. Both shapes are parsed.
- Claude and Codex are not installed in the default image. Mount them the same way as grok if you enable those presets.
- Availability results are cached for about 15 seconds.
- Memory retrieval is recent rows plus substring overlap, not embeddings.
- The operator REST API can read every memory. Isolation applies to agent tools and the prompt.
- Builtin role permissions can be edited. A later migration will not overwrite that edit (`ON CONFLICT DO NOTHING`).
- Agents with no roles are not migrated onto a role. That is intentional.
