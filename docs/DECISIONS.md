# Botanical: decision log

This log records the project's design decisions and why they were made. Later entries refine earlier ones. Planned work that is not built yet is tracked in [ROADMAP.md](./ROADMAP.md).

---

## 2026-09-23: Foundational product decisions

**Status:** Accepted.

1. **Server, not local-first.** Botanical is a server that clients connect to. The operator self-hosts it, or it runs as the hosted service. This keeps history, keys, and agents in one place, and makes always-on work possible.
2. **Web first.** The first client is a web UI talking to that server. Other clients (CLI, mobile) can come later against the same API.
3. **Scope of the first release.** Streaming chat, tools, and MCP. Scheduled routines were deferred (see [ROADMAP.md](./ROADMAP.md)).
4. **Portable hosting.** No hard dependency on one cloud vendor. Docker Compose is the reference deploy.
5. **No default model.** Every chat must name an explicit model profile. Nothing is silently auto-selected, so cost and behavior are always a visible choice.
6. **Passcode auth.** A single operator passcode protects the web → server boundary. Multi-user accounts are deferred.
7. **Stack.** TypeScript on Bun (Bun was picked over Deno when the repo was scaffolded).
8. **Unlimited custom agents.** Each agent is defined by a prompt/description and a set of tools.
9. **One agent per chat.** Each thread is owned by one agent, which keeps context and permissions unambiguous.
10. **Async agent-to-agent messaging.** Agents can message each other asynchronously (an inbox model) without merging chats.
11. **Core built-in tools.** Web search/fetch, shell/code execution, and file read/write. Anything heavier (browser or computer use) is opt-in, not core.
12. **Server-side keys only.** Model API keys live in the server environment and are never supplied by or sent to the web client.
13. **Postgres** stores chats, agents, messages, and related state.
14. **Open source and hosted, same code.** The core is MIT-licensed and self-hostable. A hosted service runs the same codebase. `DEPLOYMENT_MODE` (`SELF_HOST` / `SAAS`) is configuration, not a fork, and chat, tools, and MCP behave the same in both modes. See [DEPLOYMENT_MODES.md](./DEPLOYMENT_MODES.md).

### Deferred at the time

- Always-on routines and schedulers
- Multi-tenant accounts and billing for the hosted mode
- Browser / computer use as core built-ins
- Choosing a specific hosting vendor

---

## 2026-09-27: Backend slice 2: CLI profiles, memory, agent creation, roles

**Status:** Accepted.  
**Effect:** Adds four server capabilities. Does not change the rule that every chat names a profile and that there is no silent default model.

### 1. CLI profiles (`kind: "cli"`)

A profile may run a subscription coding-agent CLI on the server instead of an HTTP model API. Preset ids are `grok-build` (`grok`), `claude-code` (`claude`), and `codex` (`codex`).

- Configure them in `BOTANICAL_PROFILES` (`kind`, `cli`, optional `label` / `model` / `bin` / `timeoutMs`) or with `BOTANICAL_CLI_PROFILES=grok-build,claude-code,codex`. The shortcut only adds presets that the JSON did not already declare. Explicit JSON wins.
- `model` is passed to the CLI only when the profile sets it (`-m` or `--model`). Omitting it leaves the CLI's own default. That is not a Botanical default model, and CLI profiles are never auto-selected.
- The CLI runs its own tools. Botanical does not forward its tool list. The working directory is the agent's folder inside the existing workspace jail.
- Grok is invoked as `grok -p <prompt> --output-format streaming-messages-json --include-partial-messages --always-approve --cwd <dir>` because that format emits incremental text deltas. ACP `streaming-json` lines are still parsed if a binary emits them.
- Claude Code uses `claude -p … --output-format stream-json --verbose --include-partial-messages --permission-mode bypassPermissions`. Codex uses `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C <dir>`. The extra flags keep the process from blocking on prompts or a git repo check. The workspace jail is the external sandbox.
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

## 2026-09-27: Per-agent file workspace

**Status:** Accepted.
**Effect:** Built-in file tools and the shell/code_exec working directory are confined to the agent that is running the turn. CLI profiles keep the same directory they already use.

### Scope

The shared workspace root (`BOTANICAL_WORKSPACE`, otherwise the server default) stays the parent directory. Each agent gets `<root>/agents/<agentId>`. The id is sanitized the same way as the CLI cwd helper: characters outside `[A-Za-z0-9_-]` become `_`, and the name is capped at 80 characters. The directory is created on demand.

The agent id comes from the turn at dispatch and is passed on the tool context. Tool arguments cannot select another agent's directory.

For that agent, `.` and `/` are its own directory. `file_read`, `file_write`, `file_list`, and `file_delete` resolve every path inside that directory. A path that leaves it is a tool error, not a crash. That includes `..`, an absolute path outside the directory, and a symlink whose real path is outside it. For a write to a path that does not exist yet, the check uses the nearest existing parent, so a symlink parent that points outside is rejected before the file is created. The error names the path, for example `path "../x" is outside this agent's workspace`.

There is no shared file area. Memory rows still have a `shared` scope; files do not. An agent cannot list, read, or write another agent's directory through these tools.

### Shell and code_exec

`shell` and `code_exec` start in the same agent directory. A `cwd` argument must stay inside it, including through symlinks. `.` and `/` mean that directory.

Shell is not a filesystem sandbox beyond the existing process jail. The jail, when it starts, mounts the agent directory at `/workspace` and also mounts the paths that jail already allows, including a read-only `/usr`. A command can still name those paths. Setting the working directory to the agent folder does not hide them. If the jail cannot start, the tool returns an error and does not run the command on the host.

CLI profiles already use this agent directory as their working directory. That stays the same path.

---

## 2026-09-27: Botanical is a cloud, always-on platform

**Status:** Accepted. This sharpens decision 1 of 2026-09-23.

Botanical is meant to run **always on, on a server the user controls** (their own server or VPS) **or on the hosted service**. It is not designed to run on a personal PC or laptop. Local runs (`bun run dev`, Compose on a workstation) are for development only.

The point is that agents keep working while the user is away:

- **Today:** agent-to-agent messages can start background turns for the recipient (`BOTANICAL_A2A_AUTORUN=true`), and all state lives in Postgres on the server.
- **Planned:** routines (scheduled runs) and listeners (event triggers) that start agent turns with no browser connected. See [ROADMAP.md](./ROADMAP.md).

Consequences: docs and quickstarts lead with deploying to a server. Features should assume a long-running process and must not depend on an open browser tab.

---

## 2026-09-27: First-class developers and non-developers, with a developer mode

**Status:** Accepted as direction. The developer-mode setting is **not implemented yet**.

Botanical serves two audiences as first-class users, in roughly equal measure:

- **Non-developers** get a simpler assistant experience: chat, agents, memory, web tools, and connectors, with no terminal-shaped features in the way.
- **Developers** can declare themselves developers in a per-user setting. That unlocks a **coding-agent base**: coding CLI profiles (Grok Build, Claude Code, Codex), `shell` / `code_exec`, in-browser terminals into the agent workspace, and similar tooling.

Current state: there is no developer setting in the code. Every user sees the same UI. Coding CLI profiles, `shell`, and `code_exec` already exist, and access is controlled by the operator through agent tool allowlists and roles (for example, the built-in **Reviewer** role has no shell access). Terminals do not exist yet.

When the setting is built, it should gate the UI surfaces and default tool sets. It must not replace role enforcement: permissions stay enforced at tool dispatch.
