# Botanical — Decision Log

Authoritative product decisions. When these conflict with earlier brainstorm notes, **this file wins**. Later entries in this file refine earlier ones.

**Latest refinement (2026-09-23):** Botanical is **open-source (self-hostable)** and a **hosted SaaS** on the same codebase. See the business model entry at the end of this file.

---

## 2026-09-23 — Charlie interview with Ash (orchestrator)

**Status:** LOCKED for v0 planning.  
**Source:** Charlie × Ash interview (orchestrator session).  
**Effect:** Supersedes conflicting earlier notes that pushed **local-first** and **CLI-as-MVP**. Those ideas remain useful history in [BRAINSTORM.md](./BRAINSTORM.md) where marked superseded; they are not the build plan.

### Locked decisions

1. **Audience** — Charlie as personal power user. Not teams-first or OSS-community-first yet. (Refined the same day: the product is MIT open-source and self-hostable, and also a hosted SaaS. Community growth is still not the v0 wedge.)
2. **Architecture** — **Not** local-first. Botanical **server** — self-hosted by the operator, or hosted by us — with clients connecting from elsewhere. Enables always-on cloud capabilities later.
3. **First client** — **Web** UI talking to that server.
4. **v0 MVP scope** — Streaming **chat + tools + MCP**. Always-on routines / schedulers are **post-v0**.
5. **Hosting** — Vendor undecided. Keep the server **portable / host-agnostic** (no hard lock to one cloud). Deployment **mode** is decided: self-host or our hosted SaaS, same code.
6. **Default model** — **None**. Force an explicit **profile** pick; no silent everyday default.
7. **Auth (web → server)** — **Password / passcode** for v0.
8. **Stack** — **TypeScript**; runtime **Bun or Deno**, chosen at scaffold time. **Resolved:** **Bun**. See [Scaffold: Bun](#2026-09-23--scaffold-bun).
9. **Agents** — **Unlimited** user-defined agents; each customized with **functions (tools) + description/prompt**.
10. **Agent UX** — **One agent per chat** (each thread owned by one chosen agent).
11. **Agent collaboration** — Full **async agent-to-agent messaging** (teammate-style), even with one-agent-per-user-chat.
12. **Built-in tools (v0)** — **Web search/fetch**, **shell/code exec**, **file read/write**. Everything else (e.g. browser / computer use) is **opt-in configurable**, not core.
13. **Model API keys** — **Server-side only** (never supplied from the web client).
14. **Persistence** — **Postgres** for chats, agents, messages, and related state.

### Implications (short)

| Area | Was (early brainstorm) | Now (locked) |
|------|------------------------|--------------|
| Deployment | Local-first CLI on user machine | Server + remote clients; self-host or hosted SaaS (same code) |
| MVP surface | CLI | Web UI |
| Persistence | SQLite / files | Postgres |
| Runtime | Node 20+ lean | **Bun** (picked at scaffold) |
| Keys | BYOK in client/env on machine | Server-held keys only |
| Agents | Implicit single-agent chat | Multi-agent model + A2A messaging |
| Default brain | Auto / preferred profile OK | Explicit profile pick required |

### Explicitly deferred (post-v0)

- Always-on routines / schedulers
- Teams / multi-tenant auth and billing (required later for hosted SaaS; not v0 — see business model entry)
- OSS-community growth as the primary go-to-market (the core **is** MIT and self-hostable; community-building is still not the v0 wedge)
- Browser / computer-use as **core** built-ins (opt-in only)
- Hosting vendor choice

### Related docs

- [VISION.md](./VISION.md) — product vision (aligned)
- [BRAINSTORM.md](./BRAINSTORM.md) — ideas; superseded bits marked
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system sketch (aligned)
- [BUSINESS_MODEL.md](./BUSINESS_MODEL.md) — MIT self-host vs hosted subscription; deployment mode in v0

---

## 2026-09-27 — MVP2 backend: CLI profiles, memory, agent creation, roles

**Status:** LOCKED for this backend slice.  
**Effect:** Adds four server capabilities. Does not change the rule that every chat names a profile and that there is no silent default model.

### 1. CLI profiles (`kind: "cli"`)

A profile may run a subscription coding-agent CLI on the server instead of an HTTP model API. Preset ids are `grok-build` (`grok`), `claude-code` (`claude`), and `codex` (`codex`).

- Configure them in `BOTANICAL_PROFILES` (`kind`, `cli`, optional `label` / `model` / `bin` / `timeoutMs`) or with `BOTANICAL_CLI_PROFILES=grok-build,claude-code,codex`. The shortcut only adds presets that the JSON did not already declare. Explicit JSON wins.
- `model` is passed to the CLI only when the profile sets it (`-m` or `--model`). Omitting it leaves the CLI's own default. That is not a Botanical default model, and CLI profiles are never auto-selected.
- The CLI runs in the agent's folder inside the existing workspace jail. Botanical tools reach it through a per-run MCP server (refined below). Set `botanicalTools: false` on a profile to opt out.
- Grok is invoked with `--prompt-file` (not `-p <prompt>`) plus `--output-format streaming-messages-json --include-partial-messages --always-approve --cwd <dir>` because that format emits incremental text deltas. ACP `streaming-json` lines are still parsed if a binary emits them.
- Claude Code reads the prompt on stdin (`-p` with no prompt argument) and uses `--output-format stream-json --verbose --include-partial-messages --permission-mode bypassPermissions`. Codex uses `codex exec … -` so the prompt is stdin. The extra flags keep the process from blocking on prompts or a git repo check. The workspace jail is the external sandbox.
- `GET /api/profiles` includes every CLI profile with `kind`, `available`, and `unavailableReason` when the binary is missing or login cannot be confirmed. A chat turn on an unavailable CLI profile fails with `profile_unavailable`. It does not crash the process.
- Docker: `docker-compose.cli.yml` is opt-in and does not change `docker compose up`.

### 2. Memory

Memories have scope `shared` or `agent`. Agent scope is private to that agent. Shared rows are visible to every agent; `agentId` records the author when an agent wrote the row. The operator REST API can list every memory. Agent tools (`memory_write`, `memory_search`, `memory_list`, `memory_delete`) and the turn-start prompt only see shared rows plus that agent's own private rows. An agent cannot read or delete another agent's private memory.

At the start of a turn, Botanical appends a `## Memories` section: a few of the newest visible rows plus keyword overlap with the latest user message, capped in size.

### 3. Agents creating agents

`agent_create` persists through the same validation path as `POST /api/agents` and sets `createdByAgentId`. `agent_list` lists id, name, and description. An agent cannot grant tools or roles outside its own ceiling (see the combination rule). `agent_create` requires capability `agent.create` when the caller has roles.

### 4. Roles and the permission combination rule

Roles hold capability strings plus an MCP allow list (`{ server, tools? }`; omitted tools means the whole server; server `"*"` means every server). An agent may have several roles. Effective permissions are the union.

**A tool call is allowed when it matches the agent's allowlist (runtime A2A tools follow `a2aEnabled` instead) and, if the agent has one or more roles, the union of those roles permits the tool's capability.** Agents with **no roles** keep today's allowlist-only behavior, so existing agents are unchanged. `effectivePermissions.unrestricted` is true in that case.

Enforcement happens at tool dispatch, not only when the tool list is built. A denied call returns a tool error to the model, for example `permission denied: agent "Ada" lacks capability "file.write" (roles: Reviewer)`. The turn does not throw. Denied tools are also omitted from the list sent to the model.

Builtin roles, seeded idempotently: **Coder** (no `agent.create`), **Reviewer** (`file.read`, `web`, `memory.read`), **Orchestrator** (every capability and MCP `*`). Builtin roles can have their description and permissions edited. Their names cannot change and they cannot be deleted.

`agent_list` is capability `agent.message` (same gate as sending mail). `file_delete` is `file.write`. There is no separate file-edit tool.

---

## 2026-09-27 — CLI profiles get Botanical tools over a per-run MCP server

**Status:** LOCKED for this slice. Refines the CLI-profile bullets above (prompt argv and "tools are not forwarded").

A CLI turn (`grok-build`, `claude-code`, `codex`) opens `POST /internal/mcp/runs/<runId>` on this server process for the length of the turn. `tools/list` is the same catalog and role filter an API-profile turn would send. `tools/call` goes through `dispatchToolCall` (the agent loop's allowlist and role check, then the same tool source, workspace context, and truncation). A denial is an MCP tool result with `isError: true` and the same text the API turn would persist, not an HTTP error.

- The run is bound to the agent, the chat, and the turn. v0 has one operator and no tenant id, so the principal is `local`.
- Auth is a fresh 32-byte bearer token, compared in constant time. The session cookie is not accepted. Unknown or revoked runs return 404. A live run with a missing or wrong token returns 401. The token is revoked when the turn ends (success, error, cancel, timeout).
- The CLI is a child of the server. The URL defaults to `http://127.0.0.1:<PORT>` and can be set with `BOTANICAL_INTERNAL_URL`. It is not listed on the public API map.
- The prompt is never an argv element. Grok uses `--prompt-file` (0600, temp dir). Claude Code and Codex read stdin (`-p` and `codex exec -`).
- MCP server name is `botanical`, so the CLI shows tools as `mcp__botanical__<tool>`. User MCP tools keep model-facing names such as `mcp__notes__search` inside that server.
- Grok Build 1.0.40 has no `--mcp-config`. The project file `cwd/.grok/config.toml` is written for the run and restored afterwards (`.mcp.json` is not touched). The header is `Bearer ${BOTANICAL_MCP_TOKEN}` (Grok expands `${VAR}` in MCP headers). Claude Code uses `--mcp-config` and `--strict-mcp-config`. Codex uses `-c mcp_servers.botanical.url=…` and `bearer_token_env_var`.
- Calls made through this endpoint are streamed as `tool-call` / `tool-result` and stored as tool messages. The CLI's own native tools are not Botanical tool cards.
- `botanicalTools: false` on a CLI profile skips the endpoint. Presets from `BOTANICAL_CLI_PROFILES` leave it on. CLI profiles are still never the default model.
