# Botanical

Botanical is an open-source, self-hostable AI agent platform that runs in the cloud. You deploy it on a server you control (your own VPS or dedicated host), or use the hosted service built from the same code. It is an always-on assistant: the server keeps running when you close the browser, so agents can keep working and messaging each other while you are away. It is not a personal-PC app. Product decisions are in [docs/DECISIONS.md](./docs/DECISIONS.md). What ships and what is planned is in [docs/ROADMAP.md](./docs/ROADMAP.md).

Botanical is not tied to one model vendor. It talks to any OpenAI-compatible endpoint and has first-class adapters for **GPT (OpenAI)**, **Claude (Anthropic)**, **Grok (xAI)**, **DeepSeek**, and **OpenRouter**. It can also run subscription coding-agent CLIs (**Grok Build**, **Claude Code**, **Codex**) headless on the server as model profiles.

> **Status: early alpha.** The core loop works end to end (accounts, agents, streaming chat, tools, MCP, agent-to-agent messaging, memory, roles), but APIs, schema, and configuration can still change without notice. Do not rely on it for anything critical yet.
>
> License: [MIT](./LICENSE)

## Features

What ships today:

- **Any model, your keys.** OpenAI-compatible providers, with DeepSeek as the first one the start script offers, plus OpenAI, Anthropic, xAI, and OpenRouter. Keys are set in Settings, encrypted in the database, and can be seeded from the environment. The browser never calls a provider itself.
- **No silent default model.** Every chat names a model profile explicitly. Profiles live in the database (admin-global, overridable per user). `BOTANICAL_PROFILES` seeds them once.
- **Coding-agent CLIs as profiles.** Grok Build (`grok`), Claude Code (`claude`), and Codex (`codex`) can run headless on the server, streaming their output into the chat. They use their own tools inside the agent's workspace directory.
- **Unlimited custom agents.** Each agent has a name, description, Lucide icon, color, prompt, and tool allowlist. Each chat belongs to one agent, and other agents can join it as a group chat. A title, avatar shape, and uploaded picture are in progress.
- **Async agent-to-agent messaging.** Agents send each other messages that land in the recipient's inbox. With `BOTANICAL_A2A_AUTORUN=true`, a delivered message starts a background turn for the recipient, with no browser needed.
- **Routines.** Cron schedules run an agent on the server. Each run posts into the agent's chat and records success or failure.
- **Listeners.** A generic webhook starts an agent turn. The payload is passed as untrusted data. Typed issue listeners are still planned.
- **Notifications.** The UI shows a badge when background work finishes or an agent calls `notify_user`.
- **Memory.** Shared memories visible to every agent, plus private per-agent memories. Relevant memories are added to the prompt at the start of each turn.
- **Agents that create agents.** `agent_create` and `agent_list` tools, limited so an agent can never grant tools or roles beyond its own.
- **Roles and permissions.** Roles bundle capabilities (file, shell, web, memory, agent admin, notify) and an MCP server/tool allow list. They are enforced when each tool is dispatched. Built-in roles: Coder, Reviewer, Orchestrator.
- **Core tools.** `file_read` / `file_write` / `file_list` / `file_delete` (confined to the agent's own directory), `shell` and `code_exec` (inside a Linux namespace jail), and `web_search` / `web_fetch` (Brave, Tavily, Serper, or SearXNG).
- **Opt-in MCP.** Connect stdio or HTTP MCP servers from a JSON config. The default config has no servers.
- **Web UI.** Next.js App Router + shadcn/ui: agents, chats with streamed replies and tool-call cards, agent inbox, routines, listeners, notifications, and settings (profiles, tools, MCP, memory, roles, deployment).
- **Dictation.** A microphone button in the composer turns speech into text you can edit before sending. Speech-to-text runs on the server through a selectable provider (OpenAI-compatible, OpenRouter, xAI, or Qwen). When no speech backend is configured, the browser's built-in speech recognition is used instead. The message is not sent until you press Send.
- **Postgres persistence** with migrations applied automatically on boot.
- **One codebase, two deployment modes.** `SELF_HOST` (default) or `SAAS`, selected by `DEPLOYMENT_MODE`. Chat, tools, and MCP behave the same in both modes.

On the roadmap (see [docs/ROADMAP.md](./docs/ROADMAP.md)):

- **In progress.** A user-selectable accent color, and richer bot customization (title, avatar shape, uploaded picture).
- **Developer mode.** A per-user "I'm a developer" setting that unlocks the coding-agent base (coding CLIs, shell/code_exec, terminals). Everyone else gets a simpler assistant experience. Today every user sees the same UI, and tool access is the agent's allowlist and roles.
- **CLI sessions.** Start a coding CLI on demand, stop it after 15 to 30 minutes idle, and save and resume its session id. API chats still need proper context-limit handling.
- **Start scripts** that ask which coding CLIs to enable and write `BOTANICAL_CLI_PROFILES`.
- **Bot tools** for anything a person can do in the app, limited by permissions.
- **Knowledge bases.** One shared base plus one per bot: Markdown files and a block editor.
- **Computer use.** A desktop container per session, a web viewer with take-over, and a role-gated tool.
- **GitHub and GitLab** connections, including issue triggers. Generic webhooks already ship.
- **Approvals** for risky tool calls.
- **Voice calls.** Dictation already ships.
- **Hosted billing** is undecided. Accounts already ship on every instance.

## Architecture

```
Browser (web UI) ──account──▶ Next.js web ──/api──▶ Bun API server ──▶ model providers
                                                     │  agents · tools · MCP · A2A · routines · listeners · memory · roles
                                                     └──▶ Postgres
```

TypeScript throughout, on [Bun](https://bun.sh). A monorepo under `packages/`:

| Package | Role |
|---------|------|
| `server` | HTTP API: auth, agents, chats, streaming turns, A2A, routines, listeners, memory, roles |
| `agent-runtime` | Agent loop, tool dispatch, permission checks |
| `providers` | Streaming adapters (OpenAI-compatible, Anthropic, xAI, DeepSeek, OpenRouter, CLI) |
| `tools`, `tools-shell`, `tools-web` | Built-in file, shell/code_exec, and web tools |
| `mcp` | MCP client |
| `db` | Postgres schema (Drizzle) and migrations |
| `core` | Shared types and the web client for the API |
| `web` | Next.js App Router + shadcn/ui client |
| `e2e` | Playwright suite |

More detail: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quickstart

Botanical is meant to run always-on on a **server or VPS**. Running it on a laptop works for development, but agents stop when the machine sleeps.

### Option A: One-command Docker Compose (recommended)

Requires Docker with Compose v2.24+.

Linux / macOS:

```sh
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
./start.sh
```

Windows (PowerShell 5.1+ or pwsh):

```powershell
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
.\start.ps1
```

If execution policy blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

The launcher copies `.env.example` to `.env` when needed, generates `BOTANICAL_ENCRYPTION_KEY`, `BOTANICAL_SESSION_SECRET`, and `POSTGRES_PASSWORD` (and keeps `DATABASE_URL` in sync), then asks for the web port (default 3000), whether to include coding CLIs via `docker-compose.cli.yml` (default yes), and an optional provider API key (skip and add it later in Settings). Re-running keeps every value already set in `.env`. Non-interactive: `./start.sh --yes` or `.\start.ps1 -Yes`.

This starts Postgres, the API, and the web app. The server applies database migrations before it starts listening. Default host ports:

| Service | Host port |
|---------|-----------|
| Web UI | `3000` (all interfaces; set `WEB_BIND=127.0.0.1` behind a reverse proxy) |
| API | `127.0.0.1:8788` |
| Postgres | `127.0.0.1:5433` |

Open the web UI and create the first account. That account is the admin. Then create an agent and pick a model profile for the chat. On a public server, put TLS in front (for example Caddy) and set `BOTANICAL_PUBLIC_ORIGIN=https://…` and `BOTANICAL_COOKIE_SECURE=true`. See [docs/DEPLOY.md](./docs/DEPLOY.md) for TLS, backups, upgrades, MCP, and coding CLIs.

To use Grok Build, Claude Code, or Codex from Docker Desktop (Windows, macOS, or Linux) without installing the CLI on the host:

```sh
# in .env
BOTANICAL_CLI_PROFILES=grok-build

docker compose -f docker-compose.yml -f docker-compose.cli.yml up --build -d
```

Open http://localhost:3000, sign in, and go to Settings → Coding CLIs. Install the CLI, then log in. The container downloads the Linux build into a volume. Pick the Grok Build profile in a chat. Add `claude-code` or `codex` to `BOTANICAL_CLI_PROFILES` the same way. The default `docker compose up` does not install CLIs.

### Option B: Prebuilt release zip

CI packages a single runnable zip, `botanical-<version>.zip`, with the built API and the standalone web app. It is attached to GitHub Releases for `v*` tags and uploaded as a workflow artifact on every CI run. It needs Bun ≥ 1.2, Node.js ≥ 20, and Postgres 15+ (a small `docker-compose.yml` for Postgres is included).

```sh
unzip botanical-<version>.zip && cd botanical-<version>
cp .env.example .env        # set BOTANICAL_ENCRYPTION_KEY, DATABASE_URL, and optional seed keys
docker compose up -d        # optional: bundled Postgres on 127.0.0.1:5433
./start.sh                  # API on 127.0.0.1:8787, web on :3000
```

See [scripts/release/README.md](./scripts/release/README.md).

### Option C: From source (development)

```sh
bun install
export BOTANICAL_ENCRYPTION_KEY=change-me
# export DATABASE_URL=postgres://…   # unset = in-memory store, data lost on restart
bun run db:migrate                  # when DATABASE_URL is set
bun run dev                         # API on :8787, Next dev server on :3000
```

`bun run typecheck`, `bun run test`, and `bun run build` run across all packages. Testing is covered in [docs/TESTING.md](./docs/TESTING.md).

## Configuration

Bootstrap and optional seeds use environment variables. Accounts, provider keys, profiles, and instance settings are edited in the UI and stored in the database. The annotated env list is in [`.env.example`](./.env.example), and [docs/DEPLOY.md](./docs/DEPLOY.md) has a reference table. The most important keys:

| Variable | Purpose |
|----------|---------|
| `DEPLOYMENT_MODE` | `SELF_HOST` (default) or `SAAS`. The container entrypoint normalizes it into `BOTANICAL_DEPLOYMENT_MODE`, which the API reads. Both modes share the same routes, accounts, and storage. SaaS mode changes branding ("Botanical Cloud"). Hosted billing is undecided. |
| `BOTANICAL_ENCRYPTION_KEY` | Encrypts provider keys at rest. Hex, base64, or any other string (hashed to 32 bytes). |
| `BOTANICAL_SESSION_SECRET` | Reserved. The current API does not read it; sessions are random tokens stored as SHA-256 hashes. |
| `DATABASE_URL` | Postgres connection. Unset means an in-memory store (development only). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` | Optional seed for provider keys. Live keys are set in Settings and stored encrypted. A key never selects a model. |
| `OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY` | Any other OpenAI-compatible endpoint. |
| `BOTANICAL_PROFILES` | JSON array of model profiles that users can pick (see [`profiles.example.json`](./profiles.example.json)). Do not put keys in it. |
| `BOTANICAL_CLI_PROFILES` | Shortcut to add coding-CLI presets: `grok-build,claude-code,codex`. Explicit `BOTANICAL_PROFILES` entries win. With `docker-compose.cli.yml`, the server installs and signs in those CLIs inside the container. |
| `BOTANICAL_MCP_CONFIG` / `BOTANICAL_MCP_SERVERS` | MCP server config file or inline JSON. |
| `BOTANICAL_WORKSPACE` | Root directory for agent files and the shell jail. Each agent gets `<root>/agents/<id>`. |
| `BOTANICAL_A2A_AUTORUN` | `true` lets a delivered agent-to-agent message start a background turn. |
| Always-on tuning | Scheduler on/off, tick interval, background concurrency, and webhook size live in the settings table (`always_on.*`). Edit them from Settings → Background work. They are not environment variables. Defaults: on, 15000 ms, 2 turns, 65536 bytes. |
| `BOTANICAL_PUBLIC_ORIGIN` | Public origin used in webhook URLs. Falls back to the request origin. |
| `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `SEARXNG_URL` | Web search backend (optional). |

Profile example:

```json
[
  { "id": "reason", "name": "Claude Sonnet", "provider": "anthropic", "model": "claude-sonnet-5-5" },
  { "id": "local", "name": "Local", "provider": "openai-compat", "model": "llama3.1", "baseUrl": "http://127.0.0.1:11434/v1" },
  { "id": "claude-code", "kind": "cli", "cli": "claude", "label": "Claude Code" }
]
```

## Security

Botanical gives language models real tools on your server. Please read this before deploying.

- **Run it on a host you trust and control, and don't share that host with anything sensitive.** `shell` and `code_exec` run model-generated commands inside a Linux namespace jail (unprivileged `unshare`, network off by default, read-only `/usr`, scrubbed environment, timeouts, output caps). That boundary is real, but **it is not a hardened sandbox**: no seccomp, no separate uid, no cgroup limits. See [packages/tools-shell/SECURITY.md](./packages/tools-shell/SECURITY.md).
- **Coding-agent CLIs run with their approval prompts disabled** (for example `--dangerously-bypass-approvals-and-sandbox` for Codex and `--permission-mode bypassPermissions` for Claude Code) inside the agent's workspace directory. Only enable them on a server where that is acceptable.
- **MCP servers are code you choose to run.** Only add servers you trust.
- **Accounts.** The first signup is the admin. Signup can be open, invite-only, or closed. Serve the UI over HTTPS. Login attempts are rate-limited. Hosted billing is undecided.
- Provider keys are encrypted in the database. Environment variables only bootstrap the database and the encryption secret, or seed keys. Never commit `.env`.

To report a vulnerability, see [SECURITY.md](./SECURITY.md). Please do not open a public issue.

## Troubleshooting

Windows clones from before the line-ending fix can check shell scripts out as CRLF (`core.autocrlf=true`). `docker compose up --build` then fails in `web.Dockerfile` with `set: line 5: illegal option -`. Re-checkout with LF:

```sh
git config core.autocrlf input
git rm -r --cached -q .
git reset --hard
```

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/index/README.md](./docs/index/README.md) | Codebase index: where files, routes, tables, and env vars live |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | Compose deploy, TLS, backups, MCP, coding CLIs, hosted mode |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | Design decisions and their rationale |
| [docs/VISION.md](./docs/VISION.md) | Product goals and principles |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | What's planned and not built yet |
| [docs/DEPLOYMENT_MODES.md](./docs/DEPLOYMENT_MODES.md) | Self-host vs hosted mode |
| [docs/TESTING.md](./docs/TESTING.md) | Unit, smoke, and browser tests |
| [docs/MVP2_BACKEND.md](./docs/MVP2_BACKEND.md) | CLI profiles, memory, agent creation, roles: API notes |

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first, and follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Because the project is early, please open an issue to discuss larger changes before you write the code.

## License

[MIT](./LICENSE). The same code powers self-hosted installs and the hosted service.
