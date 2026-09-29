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
6. **Passcode auth.** Superseded on 2026-09-28 by accounts. See the multi-user entry below.
7. **Stack.** TypeScript on Bun (Bun was picked over Deno when the repo was scaffolded).
8. **Unlimited custom agents.** Each agent is defined by a prompt/description and a set of tools.
9. **One agent per chat.** Each thread is owned by one agent, which keeps context and permissions unambiguous. Refined on 2026-09-29: a chat can add group members (see Group chats below).
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
- The CLI runs in the agent's folder inside the existing workspace jail. Botanical tools reach it through a per-run MCP server (refined below). Set `botanicalTools: false` on a profile to opt out.
- Grok is invoked with `--prompt-file` (not `-p <prompt>`) plus `--output-format streaming-messages-json --include-partial-messages --always-approve --cwd <dir>` because that format emits incremental text deltas. ACP `streaming-json` lines are still parsed if a binary emits them.
- Grok also gets `--no-wait-for-background` (headless only, not listed by `--help` in 1.0.40/1.0.41). Without it, Grok keeps running after the model's last message while background work is pending (commands still running after about 15s, background subagents, `monitor` watches), up to 600s and forever for a persistent monitor. The chat then showed nothing until Stop (issue #87). With the flag, Grok exits when the turn ends and kills what is still pending.
- Text from separate model steps in one CLI run is joined with a blank line. A step starts at each `message_start` in Grok's and Claude Code's stream.
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
- **Shipped 2026-09-28:** routines and generic webhook listeners. Typed forge listeners stay planned. See the entry below and [ROADMAP.md](./ROADMAP.md).

Consequences: docs and quickstarts lead with deploying to a server. Features should assume a long-running process and must not depend on an open browser tab.

---

## 2026-09-27: First-class developers and non-developers, with a developer mode

**Status:** Accepted as direction. The developer-mode setting is **not implemented yet**.

Botanical serves two audiences as first-class users, in roughly equal measure:

- **Non-developers** get a simpler assistant experience: chat, agents, memory, web tools, and connectors, with no terminal-shaped features in the way.
- **Developers** can declare themselves developers in a per-user setting. That unlocks a **coding-agent base**: coding CLI profiles (Grok Build, Claude Code, Codex), `shell` / `code_exec`, in-browser terminals into the agent workspace, and similar tooling.

Current state: there is no developer setting in the code. Every user sees the same UI. Coding CLI profiles, `shell`, and `code_exec` already exist, and access is controlled by the operator through agent tool allowlists and roles (for example, the built-in **Reviewer** role has no shell access). Terminals do not exist yet.

When the setting is built, it should gate the UI surfaces and default tool sets. It must not replace role enforcement: permissions stay enforced at tool dispatch.

---

## 2026-09-27: CLI profiles get Botanical tools over a per-run MCP server

**Status:** Accepted.
**Effect:** Grok Build, Claude Code, and Codex profiles can call Botanical's tools (memory, agents, files, shell, web) and the operator's MCP tools. The prompt no longer travels on the command line. Before this, CLI profiles got no Botanical tools and received the prompt as an argument.

A CLI turn opens `POST /internal/mcp/runs/<runId>` on the same server process for the length of the turn. It speaks MCP over streamable HTTP (JSON responses). `tools/list` returns the same catalog and role filter an API-profile turn would send. `tools/call` goes through the same dispatch function as the agent loop: allowlist and role check, then the same tool source, per-agent workspace context, limits, and truncation. A denial is an MCP tool result with `isError: true` and the same text an API turn would store. It is not an HTTP error.

- The run is bound to the agent, the chat, and the turn. The agent id comes from the turn, never from the CLI.
- Auth is a fresh 32-byte random bearer token, compared in constant time. The session cookie is not accepted. Unknown or revoked runs return 404, and a live run with a missing or wrong token returns 401. The token is revoked when the turn ends (success, error, cancel, or timeout).
- The CLI is a child process of the server, so the URL defaults to `http://127.0.0.1:<PORT>`. `BOTANICAL_INTERNAL_URL` overrides it. The route is not part of the public API.
- The MCP server is named `botanical`, so a CLI shows tools as `mcp__botanical__<tool>`. The operator's MCP tools keep their model-facing names (for example `mcp__notes__search`) inside that server.
- The prompt is never an argv element. Grok reads `--prompt-file` (a 0600 temp file, deleted afterwards). Claude Code reads stdin with `-p`. Codex reads stdin with `codex exec … -`.
- Grok Build has no `--mcp-config` flag. Botanical writes `[mcp_servers.botanical]` into `<agent dir>/.grok/config.toml` for the run and restores the previous file (or removes it) afterwards. `.mcp.json` is not touched. The header is `Authorization = "Bearer ${BOTANICAL_MCP_TOKEN}"`; Grok expands the variable, so the token is only in the child's environment. Grok starts project-scoped MCP servers only in a trusted folder, so the child gets `GROK_FOLDER_TRUST=0`. That changes nothing on disk, and the CLI already runs with `--always-approve` in that folder.
- Claude Code gets `--mcp-config <temp file> --strict-mcp-config` and `--allowedTools mcp__botanical__*`. Codex gets `-c mcp_servers.botanical.url=…` and `bearer_token_env_var`. Neither is installed in the default image; these flags follow their published CLI references.
- Calls made through the endpoint stream as `tool-call` / `tool-result` events and are stored as tool messages, so they render as tool cards. The CLI's own native tools are not Botanical tool cards.
- `botanicalTools: false` on a CLI profile skips the endpoint. Presets from `BOTANICAL_CLI_PROFILES` leave it on.
- An agent that can use no tools also gets no endpoint. Its prompt says Botanical tools such as memory and agent messages are not enabled, and asks the CLI to say so rather than look for a workaround. Before this, Grok found an empty `botanical` server and went searching the workspace instead (issue #87).
- Chat SSE streams send a `: ping` comment after 5 seconds without an event. Bun closes idle connections after 10 seconds, and CLI turns are often silent while the CLI looks up or runs tools; without the ping that aborted the turn.

---

## 2026-09-27: Coding CLIs install inside the server container

**Status:** Accepted.
**Effect:** `docker-compose.cli.yml` no longer bind-mounts a host `grok` binary. The API container installs the Linux build of each enabled CLI and stores its config on named volumes, so Docker Desktop on Windows and macOS works without WSL and without a host binary. The default `docker compose up` is unchanged when the override is not used.

### Install

On listen, unless `BOTANICAL_CLI_AUTO_INSTALL=0`, the server installs each CLI named by an enabled profile (`BOTANICAL_CLI_PROFILES` or a `kind: "cli"` profile) in the background. A failed install is recorded on that CLI and does not stop the server or the other CLIs. Settings → Coding CLIs can install or update one CLI. One install per CLI runs at a time; a second call joins the first. Downloads land in a temp directory and move into place with rename.

Versions default to the latest stable at install time. `BOTANICAL_GROK_VERSION`, `BOTANICAL_CLAUDE_VERSION`, and `BOTANICAL_CODEX_VERSION` pin one. An install is skipped when the manifest version is already present, the binary exists, and it matches the pin (or there is no pin and this is not an update). Update re-resolves latest.

| CLI | Source | Check |
| --- | --- | --- |
| Grok Build (`grok`) | Version text at `https://x.ai/cli/stable`. Binary `grok-<version>-linux-<x86_64\|aarch64>` from `https://x.ai/cli`, falling back to `https://storage.googleapis.com/grok-build-public-artifacts/cli`. The `.gz` form is preferred; gzip is inflated in process. There is no published checksum (`.sha256` is not served). | The temp binary must exit 0 from `--version` before it is moved to `/opt/botanical-cli/bin/grok`. |
| Claude Code (`claude`) | npm `@anthropic-ai/claude-code` for the version, then the matching platform package `@anthropic-ai/claude-code-linux-x64`, `-arm64`, `-linux-x64-musl`, or `-linux-arm64-musl`. | `dist.integrity` (sha512 SRI) is checked before extract. musl vs glibc is chosen at runtime (`/etc/alpine-release`, otherwise `ldd`). |
| Codex (`codex`) | npm `@openai/codex`, then the platform version `@openai/codex@<version>-linux-x64` or `-linux-arm64`. The archive's vendor tree holds `x86_64-unknown-linux-musl` or `aarch64-unknown-linux-musl`. | `dist.integrity` is checked before extract. The published Linux binaries are musl builds. |

A manifest under `/opt/botanical-cli/manifests/<cli>.json` records cli, version, arch, libc, source URL, sha512 when one existed, how it was verified, and `installedAt`. `x64` maps to `x86_64` and `arm64` to `aarch64`, which is what Apple Silicon containers report.

The image stays Alpine (the Bun Alpine image). Grok's Linux binary is static. Claude's musl build needs `libgcc`, `libstdc++`, and system `ripgrep` (`USE_BUILTIN_RIPGREP=0`, because the bundled ripgrep is glibc). Codex ships a musl binary. Those packages are added with `apk`. A glibc base is not required.

### Volumes and login

`cli_bin` is mounted at `/opt/botanical-cli` (its `bin` directory is on `PATH`, and availability also looks there). `cli_home` is mounted at `/home/botanical`, which is `HOME` and `BOTANICAL_CLI_HOME`. The entrypoint, as root, creates both directories and gives them to the `botanical` user before dropping privileges. `botanical-cli-cache` is mounted at `/var/cache/botanical-cli` (`BOTANICAL_CLI_CACHE`). It keeps each downloaded binary under its CLI, version, arch and libc, so a new `cli_bin` volume (after `down -v`, or in another Compose project) installs without a download. The volume name is fixed so projects share it. A cached binary still has to pass the version probe, and a failing entry is deleted and downloaded again.

Login runs the CLI in the container with piped stdio and no PTY. Grok: `grok login --device-auth` (alias `--device-code`), which prints a URL and a code and polls. Codex: `codex login --device-auth`, same shape. Claude's supported headless method is `claude setup-token`: it opens a browser flow and prints a long-lived token, and it does not save that token. The settings page shows the URL and code, and a paste box for the Claude token (or a code if the CLI asks). The token is written into the CLI home settings file. It is not returned to the browser. Output lines are ANSI-stripped and token-shaped text is redacted before it is stored for the UI. A login times out after 15 minutes. Cancel kills the child. Only one login per CLI.

Logged-in is a boolean (or `"unknown"` if the check itself fails). Grok: a non-empty `~/.grok/auth.json`, or a non-empty `XAI_API_KEY`. `grok models` exits 0 while unauthenticated, so it is not a login check. Codex: `codex login status` exit 0, or a non-empty `~/.codex/auth.json`. Claude: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, a token in `~/.claude/settings.json`, or a non-empty `~/.claude/.credentials.json`. Otherwise `claude auth status` is authoritative (`loggedIn` in its JSON, or exit code 0 when that field is absent). `~/.claude.json` is created by any run and is not a credential. File contents are not copied into the response. Install and login clear the availability cache so `GET /api/profiles` flips without a restart.

The passcode session is the only operator session. v0 has no separate admin role on that session in self-host or SaaS, so these routes use the same auth gate as the rest of the operator API. SaaS is still one tenant and one passcode.

A Linux bind-mount of a host binary remains a commented example in the override. It is not required.

---

## 2026-09-28: Routines, generic webhooks, and notifications

**Status:** Accepted.
**Effect:** Scheduled runs and inbound webhooks start full agent turns while no browser is connected. Typed forge listeners are not part of this slice.

### New chat per run

Each routine run and each accepted webhook delivery creates a new chat owned by that agent, titled with the routine or listener name and the local time, using the configured profile. The run or delivery row stores the chat id.

A single long-lived chat would mix unrelated slots and grow without a bound. A new chat keeps each run's context to that prompt or payload, and the history link stays obvious. The operator opens that chat to see the same transcript an interactive turn would have written.

### Lease

The scheduler lives in the server process and ticks about every 15 seconds by default. The interval and the on/off switch are instance settings, so a change applies on a later tick without a restart. Claiming is a transaction: lock due routines with `FOR UPDATE SKIP LOCKED`, insert the schedule run, then set `next_run_at` to the next slot strictly after now. The unique index on `(routine_id, scheduled_for)` where `trigger = 'schedule'` is the second guard, so two processes cannot record the same slot. Missed time while the process was down becomes one catch-up run; intermediate slots are skipped. Resume after a pause also jumps to the next future slot, so a paused routine does not replay the gap. A process marks a run failed with `interrupted: server stopped` only when its lease has expired, or when a queued run was never picked up and is older than the lease window (about two minutes). The executing process sets `lease_owner` and `lease_expires_at` when it starts the turn and renews the lease about every 30 seconds. A live lease is not reaped by another process. Accepted deliveries follow the same rule. The failure also writes a notification.

### Secret storage

Listener secrets are generated on the server (at least 32 random bytes, url-safe) and stored as the raw value. HMAC-SHA256 needs that value, so the column is not a hash. Anyone who can read the database can verify or forge deliveries for that listener. List and get responses omit the secret. It is returned only from create and from rotate.

### Untrusted payload

`{{payload}}` is replaced with a fixed preamble plus the body inside `<untrusted_webhook_payload>`. The preamble tells the model the block is external data and must not be followed as instructions. A closing tag inside the body is neutralized, and the inserted text is capped. The default template includes the placeholder. JSON bodies are pretty-printed; anything else is passed as text.

### Ownership

`routines`, `listeners`, and `notifications` have a required `user_id` foreign key to `users`, on delete restrict, matching agents and chats. A notification uses the owning agent's user. `routine_runs` and `listener_deliveries` do not store `user_id`; they inherit the parent. Accounts enforce that owner on every route, scheduler tick, and webhook turn.

### Instance settings

Scheduler on/off, tick interval, background-turn cap, and webhook body cap are rows in `settings` (`always_on.scheduler_enabled`, `always_on.scheduler_interval_ms`, `always_on.background_concurrency`, `always_on.listener_max_bytes`), not environment variables. Absent rows use the defaults (on, 15000 ms, 2, 65536). `GET /api/settings/always-on` is available to a signed-in user. `PATCH` is admin-only. They are one value for the deployment, not per user. A short cache lets a saved value apply without a restart. Tests that need the interval to stay stopped pass `createApp({ scheduler: false })`.

---

## 2026-09-28: Every instance is multi-user

**Status:** Accepted. Replaces the single-passcode decision from 2026-09-23.

Self-host and hosted mode use the same accounts. There is no shared passcode.

- Signup and login use an email and a password. Passwords are stored as argon2id hashes. Sessions are random tokens, stored as a SHA-256 hash, and set as an HttpOnly cookie. Bearer tokens still work.
- The first account to set a password is the admin. Existing rows that belonged to the bootstrap owner are claimed by that account.
- The admin chooses signup mode in Settings: open, invite-only, or closed. Invite links are single-use. Before any account exists, signup stays open so the instance can be claimed.
- Agents, chats, messages, memory, routines, listeners, notifications, and workspaces belong to one user. Routes, the scheduler, and webhook turns run as that owner. A user cannot read another user's rows.
- Provider keys and speech settings live in the database. Admin-global values apply to the instance. A user's own value overrides them. The admin can turn off member use of the global keys. Keys are encrypted with AES-256-GCM under `BOTANICAL_ENCRYPTION_KEY` and the UI only shows the last four characters.
- Model profiles follow the same split: admin-global profiles, with a per-user profile of the same id overriding. `BOTANICAL_PROFILES` and provider key env vars seed those rows once, on first boot, when the database is empty.
- Coding CLI logins and agent workspaces use a directory per user.
- `DATABASE_URL` and `BOTANICAL_ENCRYPTION_KEY` are the bootstrap secrets. Other env vars are optional seeds, not the live configuration.
- Hosted billing is undecided. See the entry below. Roles (Coder, Reviewer, Orchestrator) stay shared templates. Builtin role names are not per user.

API chats send the transcript on every turn. Before the provider call, messages are trimmed to the profile's `maxContext` (about four characters per token). The system prompt and the newest turn stay. Older turns are dropped first, and a tool result stays with the assistant message that requested it. That trim is a rough stand-in. Proper context-limit handling is still planned. Coding CLI turns do not resume a vendor session id. Each turn renders the transcript into a new prompt. Saving and resuming CLI session ids is planned; see the entry below.

---

## 2026-09-28: Product decisions for the roadmap

Short entries. Earlier entries still hold unless a status line here changes them. Planned work is tracked in [ROADMAP.md](./ROADMAP.md).

### Positioning and audience

**Decision:** Botanical is an always-on agent platform that runs on a server you operate (self-host) or as a hosted service. It is not a personal-PC app. About half the audience is developers and half is not. A per-user "I'm a developer" setting unlocks coding-agent features, terminals, and similar tools.

**Reason:** Agents have to keep running when the laptop is closed. Non-developers should get a simple assistant. Developers should opt into terminals and coding CLIs without that becoming the default UI.

**Status:** Accepted. Server deploy ships. The developer setting is planned. Today every user sees the same UI. Tool access is the agent's allowlist and roles.

### Open source and hosted billing

**Decision:** The project stays MIT-licensed and self-hostable. A hosted service is planned on the same codebase. How that service bills customers is undecided.

**Reason:** One tree should serve people who run their own server and people who do not. Charging for hosting is a separate choice and is not settled.

**Status:** Accepted. `DEPLOYMENT_MODE` (`SELF_HOST` / `SAAS`) ships and does not change chat, tools, or MCP. Nothing charges a customer. Unused billing stubs in `@botanical/core` are not a billing design.

### Multi-user on every instance

**Decision:** Every instance has accounts. The first signup is the admin. The admin can close signup (or leave it open or invite-only). Each user has their own settings and API keys. Admin global keys and settings are edited in the UI and stored encrypted in the database. Environment variables are only for bootstrap (`DATABASE_URL`, `BOTANICAL_ENCRYPTION_KEY`) and optional seeding.

**Reason:** A shared passcode cannot separate users, and live configuration should not require SSH into the host.

**Status:** Shipped. Detail is in the multi-user entry above.

### Visual style

**Decision:** Main colors stay monochrome shadcn/ui. Each user can pick an accent color (blue, red, green, and similar) in Settings.

**Reason:** The UI should stay quiet, with one color the person chooses.

**Status:** In progress. Monochrome shadcn and a light/dark toggle ship. Settings has no accent picker yet.

### Bot customization

**Decision:** A bot has a name, title, description, color, icon or avatar shape, and an uploaded picture.

**Reason:** People should recognize each bot without reading its prompt.

**Status:** In progress. Name, description, color, and a Lucide icon ship. A separate title, avatar shape, and uploaded picture are not in the schema yet.

### Models and coding CLIs

**Decision:** Models are OpenAI-compatible API providers, with DeepSeek as the first provider the start flow offers, plus subscription coding CLIs (Grok Build, Claude Code, Codex). Those CLIs run headless on the server, are installed and signed in inside the container from the UI, and are enabled with `BOTANICAL_CLI_PROFILES`. All of them share one MCP server named `botanical` for Botanical tools.

**Reason:** API models and subscription CLIs should both be profiles. One MCP server keeps Botanical tools the same no matter which CLI is running.

**Status:** Shipped for API profiles (a generic OpenAI-compatible base URL, plus adapters), container install and login, and the per-turn `botanical` MCP server. The start scripts do not yet choose which CLIs to enable. See below.

### CLI sessions and API context

**Decision:** A coding CLI session starts when a chat needs it, shuts down after 15 to 30 minutes idle, and saves its session id so a later turn can resume. API chats need proper context-limit handling.

**Reason:** A CLI process per idle chat wastes the server. Resuming a session keeps the CLI's own context. An API chat must stay inside the model's context limit.

**Status:** Planned. Each CLI turn currently starts a new process and does not save or resume a session id. API turns are trimmed with the rough `maxContext` estimate before the provider call. That trim is not the final behavior.

### Memory, agents, and permissions

**Decision:** Memory is shared plus per-agent. Agents can create agents. Roles and MCP permissions limit what an agent can do.

**Reason:** Agents need durable notes and a way to delegate, without granting more than they themselves have.

**Status:** Shipped. See the 2026-09-27 entries on memory, `agent_create`, and roles.

### Routines, listeners, notifications, speech

**Decision:** Routines, webhook listeners, and notifications are part of the product. Dictation uses pluggable speech-to-text providers. Voice calls come later.

**Reason:** Background work should run with no browser open. Speech should become text you can edit before send. A live call is a separate feature.

**Status:** Routines, generic webhook listeners, notifications, and dictation are shipped. Speech-to-text providers are OpenAI-compatible, OpenRouter, xAI, and Qwen, with the browser's recognizer when no server provider is set. Voice calls are planned.

### Start scripts

**Decision:** `start.sh` and `start.ps1` ask which coding CLIs to enable and write `BOTANICAL_CLI_PROFILES`.

**Reason:** The first start should record that choice instead of leaving an env line to edit by hand.

**Status:** Planned. The scripts ask only whether to add `docker-compose.cli.yml`. They do not list individual CLIs and they do not set `BOTANICAL_CLI_PROFILES`.

### Bot tools match the app

**Decision:** A bot gets tools for anything a person can do in the app (customize bots, create routines and listeners, change settings), limited by that bot's permissions.

**Reason:** Allowed work should not depend on someone clicking through the UI.

**Status:** Planned. Agents can already create agents inside their permission ceiling. The other app actions are not tools.

### Agent default model

**Decision:** An agent can name a default model profile. Starting a chat with that agent pre-selects it in the new-chat form, and the user can pick another profile for that chat. The server is unchanged: every chat and message still carries an explicit `profileId`.

**Reason:** Picking the same profile for every chat with an agent is busywork ([#58](https://github.com/Wqffles-com/botanical/issues/58)). A pre-selected, visible pick keeps the rule that nothing is silently auto-selected.

**Status:** Shipped. The default is skipped when that profile is no longer listed or is unavailable.

### Knowledge bases

**Decision:** There is one shared knowledge base the user can edit, visible across bots, plus one knowledge base per bot. Both use the same layout: organized Markdown files edited with a block editor.

**Reason:** Reference material should outlive a chat, and the shared base and a bot's base should not be two different systems.

**Status:** Planned. There is no knowledge-base schema or editor in the tree.

### Computer use

**Decision:** Computer use gives a bot a desktop container per session, a web viewer the user can take over, and a computer-use tool gated by role.

**Reason:** Some tasks need a desktop. The user must be able to watch and take control. It stays opt-in, not a tool every agent has.

**Status:** Planned.

### GitHub and GitLab

**Decision:** Users can connect GitHub or GitLab, including issue triggers for listeners.

**Reason:** A new issue should start an agent the way a generic webhook already can, through a real connection.

**Status:** Planned. Generic webhook listeners ship. Typed forge connections do not.

### Tool safety

**Decision:** Risky tool calls require approval.

**Reason:** Shell, writes, and similar tools can change the server. A person should be able to stop a dangerous call.

**Status:** Planned. Roles and allowlists already deny a call at dispatch. The UI has no approval prompt. A `tool_audit` table exists and the API does not write it.

### Engineering rules

**Decision:** Every pull request that changes code updates `docs/index/`. Windows checkouts use LF for the text types named in `.gitattributes`.

**Reason:** The index is how changes find the right files. CRLF checkouts break shell scripts inside image builds.

**Status:** Shipped. `bun run check:index` runs in CI. `.gitattributes` forces LF for shell scripts, Dockerfiles, and the other listed types. `*.ps1` follows Git's autocrlf setting.

---

## 2026-09-28: Async chat messaging

**Status:** Accepted. Shipped in the web client.
**Effect:** A person can keep sending messages while the agent works. Replies arrive whole instead of token by token.

- The web client posts with `async: true`. The server queues the message and answers `202` at once. It does not hold the request open for the turn.
- Turns run on the server, detached from the request, one at a time per chat (the same per-chat lock as every other turn). Closing the tab does not stop the agent.
- Everything queued while a turn runs is answered by the next turn together: the messages are stored as separate user rows and the agent gives one reply for the batch. Superseded for most messages by mid-turn steering (2026-09-29, below).
- Queued messages are written to the transcript only when their turn starts, so a message sent mid-turn never lands between a tool call and its result.
- `GET /api/chats/:id/events` pushes the queue status and each stored message whole. Text deltas are not sent. `POST /api/chats/:id/stop` aborts the running turn; messages queued after it still get their turn.
- The queue lives in the API process, like the per-chat lock. A restart drops messages that were still waiting.
- The streaming (`stream: true`) and blocking JSON forms of `POST /api/chats/:id/messages` stay for other clients.

**Considered:** A visible agent that answers at once and hands the work to a hidden background agent on the same profile. Not built: the chat's own turn already runs in the background on that profile, and a second agent would need a hidden chat, a way to report back, and rules for two agents writing one transcript. It can be layered on later as a delegation tool if replies during long work matter.

---

## 2026-09-29: Steer a running turn

**Status:** Accepted. Shipped for async chat (issue #77).
**Effect:** A message sent while the agent works reaches the model during that turn, so the person can correct or redirect it without stopping it. Before, the message waited in the queue until the turn ended.

- The agent loop takes waiting messages before each model step, after the step's tool results are stored. They go into the transcript as user rows and the model reads them on its next call. This works for every API provider.
- If the model finishes while a message is waiting, the same turn continues and answers it, up to the step cap.
- Claude Code runs with `--input-format stream-json`. Its stdin stays open while it runs, and each new message is written to it as a user message, so Claude Code reads it without a restart. stdin closes when the CLI reports its `result`.
- Codex (`codex exec`) and Grok Build read one prompt and have no live input. For them the message is answered right after the CLI run, in the same turn, with the full transcript.
- Only messages for the turn's profile steer it. A message sent with another profile, or one that arrives after the step cap, waits for the next turn as before.
- Steered messages still go out on `GET /api/chats/:id/events` as `message` events with their `queuedId`, so the web client needs no change.

**Considered:** Aborting the running model call when a message arrives and restarting with the new message. Not built: it throws away work in progress, and for CLIs it would kill the process and its working state.

---

## 2026-09-29: Group chats

**Status:** Accepted. Shipped (issue #91).
**Effect:** Refines "One agent per chat" (2026-09-23, item 9). A chat keeps one owning agent and can add other agents as members, so several agents can work on one thread with the user.

- The owner stays fixed. Members are a list on the chat (`memberIds`, at most 7), in speaking order, and can be changed at any time from the chat header. An agent in a chat, as owner or member, cannot be deleted.
- Each agent answers as itself: its own prompt, tools, roles, memory, and workspace. Every assistant and tool row records the agent that wrote it.
- A user message is answered by the members it `@mentions`. With no mention, every participant answers in turn, owner first, one after another, so each reads the replies before its own.
- An agent's reply that `@mentions` a participant who has not answered this message yet hands it the floor. Each agent answers at most once per user message, so agents cannot loop.
- To an agent, the other agents' replies read as user messages that start with `[Name]`. Their tool calls and results stay out of its context, since they used tools it may not have.
- In a group chat a mention of a member picks who answers and sends no A2A mail. A mention of an agent outside the chat still mails it, as before.
- All agents in a chat use the chat's model profile. Only the first agent's turn can be steered; messages sent later wait for the next round.

**Considered:** Letting every agent reply at once, in parallel. Not built: replies would ignore each other and the transcript order would depend on timing. A model-picked "next speaker" was also left out; mentions keep the choice visible to the user.
