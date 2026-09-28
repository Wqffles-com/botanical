# Botanical

Botanical is an open-source, self-hostable AI agent platform that runs in the cloud. You deploy it on a server you control (your own VPS or dedicated host), or use the hosted service built from the same code. It is an always-on assistant: the server keeps running when you close the browser, so agents can keep working and messaging each other while you are away.

Botanical is not tied to one model vendor. It talks to any OpenAI-compatible endpoint and has first-class adapters for **GPT (OpenAI)**, **Claude (Anthropic)**, **Grok (xAI)**, **DeepSeek**, and **OpenRouter**. It can also run subscription coding-agent CLIs (**Grok Build**, **Claude Code**, **Codex**) headless on the server as model profiles.

> **Status: early alpha.** The core loop works end to end (passcode login, agents, streaming chat, tools, MCP, agent-to-agent messaging, memory, roles), but APIs, schema, and configuration can still change without notice. Do not rely on it for anything critical yet.
>
> License: [MIT](./LICENSE)

## Features

What ships today:

- **Any model, your keys.** OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, or any OpenAI-compatible base URL (for example a local Ollama). API keys live only in the server environment and are never sent to or accepted from the browser.
- **No silent default model.** Every chat names a model profile explicitly. Profiles are configured on the server (`BOTANICAL_PROFILES`).
- **Coding-agent CLIs as profiles.** Grok Build (`grok`), Claude Code (`claude`), and Codex (`codex`) can run headless on the server, streaming their output into the chat. They use their own tools inside the agent's workspace directory.
- **Unlimited custom agents.** Each agent has a name, icon, color, prompt, and tool allowlist. Each chat belongs to one agent.
- **Async agent-to-agent messaging.** Agents send each other messages that land in the recipient's inbox. With `BOTANICAL_A2A_AUTORUN=true`, a delivered message starts a background turn for the recipient, with no browser needed.
- **Memory.** Shared memories visible to every agent, plus private per-agent memories. Relevant memories are added to the prompt at the start of each turn.
- **Agents that create agents.** `agent_create` and `agent_list` tools, limited so an agent can never grant tools or roles beyond its own.
- **Roles and permissions.** Roles bundle capabilities (file, shell, web, memory, agent admin) and an MCP server/tool allow list. They are enforced when each tool is dispatched. Built-in roles: Coder, Reviewer, Orchestrator.
- **Core tools.** `file_read` / `file_write` / `file_list` / `file_delete` (confined to the agent's own directory), `shell` and `code_exec` (inside a Linux namespace jail), and `web_search` / `web_fetch` (Brave, Tavily, Serper, or SearXNG).
- **Opt-in MCP.** Connect stdio or HTTP MCP servers from a JSON config. The default config has no servers.
- **Web UI.** Next.js App Router + shadcn/ui: agents, chats with streamed replies and tool-call cards, agent inbox, and settings (profiles, tools, MCP, memory, roles, deployment).
- **Dictation.** A microphone button in the composer turns speech into text you can edit before sending. Speech-to-text runs on the server through any Whisper-compatible endpoint (OpenAI, Groq, or a local Whisper). When no speech backend is configured, the browser's built-in speech recognition is used instead. The message is not sent until you press Send.
- **Postgres persistence** with migrations applied automatically on boot.
- **One codebase, two deployment modes.** `SELF_HOST` (default) or `SAAS`, selected by `DEPLOYMENT_MODE`. Chat, tools, and MCP behave the same in both modes.

On the roadmap (**not implemented yet**; see [docs/ROADMAP.md](./docs/ROADMAP.md)):

- **Routines and listeners.** Scheduled jobs and event triggers that start agent turns while you are away.
- **Developer mode.** A per-user setting that unlocks the coding-agent base (coding CLIs, shell/code_exec, terminals). Everyone else gets a simpler assistant experience. Today every user sees the same UI, and the operator controls tools through agent allowlists and roles.
- Multi-tenant accounts and billing for the hosted mode.

## Architecture

```
Browser (web UI) ──passcode──▶ Next.js web ──/api──▶ Bun API server ──▶ model providers
                                                     │  agents · tools · MCP · A2A · memory · roles
                                                     └──▶ Postgres
```

TypeScript throughout, on [Bun](https://bun.sh). A monorepo under `packages/`:

| Package | Role |
|---------|------|
| `server` | HTTP API: auth, agents, chats, streaming turns, A2A, memory, roles |
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

### Option A: Docker Compose on a server (recommended)

Requires Docker with Compose v2.24+.

```sh
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
cp .env.example .env
# Edit .env: set BOTANICAL_PASSCODE, POSTGRES_PASSWORD
# (and the same password inside DATABASE_URL), plus at least one provider key.
docker compose up --build -d
```

This starts Postgres, the API, and the web app. The server applies database migrations before it starts listening. Default host ports:

| Service | Host port |
|---------|-----------|
| Web UI | `3000` (all interfaces; set `WEB_BIND=127.0.0.1` behind a reverse proxy) |
| API | `127.0.0.1:8788` |
| Postgres | `127.0.0.1:5433` |

Open the web UI, sign in with your passcode, create an agent, and pick a model profile for the chat. On a public server, put TLS in front (for example Caddy) and set `BOTANICAL_PUBLIC_ORIGIN=https://…` and `BOTANICAL_COOKIE_SECURE=true`. See [docs/DEPLOY.md](./docs/DEPLOY.md) for TLS, backups, upgrades, MCP, and coding CLIs.

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
cp .env.example .env        # set BOTANICAL_PASSWORD, DATABASE_URL, provider keys
docker compose up -d        # optional: bundled Postgres on 127.0.0.1:5433
./start.sh                  # API on 127.0.0.1:8787, web on :3000
```

See [scripts/release/README.md](./scripts/release/README.md).

### Option C: From source (development)

```sh
bun install
export BOTANICAL_PASSWORD=change-me
# export DATABASE_URL=postgres://…   # unset = in-memory store, data lost on restart
bun run db:migrate                  # when DATABASE_URL is set
bun run dev                         # API on :8787, Next dev server on :3000
```

`bun run typecheck`, `bun run test`, and `bun run build` run across all packages. Testing is covered in [docs/TESTING.md](./docs/TESTING.md).

## Configuration

Everything is configured through environment variables. The full annotated list is in [`.env.example`](./.env.example), and [docs/DEPLOY.md](./docs/DEPLOY.md) has a reference table. The most important keys:

| Variable | Purpose |
|----------|---------|
| `DEPLOYMENT_MODE` | `SELF_HOST` (default) or `SAAS`. The container entrypoint normalizes it into `BOTANICAL_DEPLOYMENT_MODE`, which the API reads. Both modes share the same routes, auth, and storage today; SaaS mode changes branding ("Botanical Cloud"). Accounts and billing are not built. |
| `BOTANICAL_PASSCODE` / `BOTANICAL_PASSWORD` | The single login passcode. `BOTANICAL_PASSWORD_HASH` accepts an argon2 hash from `Bun.password.hash` instead. |
| `BOTANICAL_SESSION_SECRET` | Reserved. The current API does not read it; sessions are random tokens stored as SHA-256 hashes. |
| `DATABASE_URL` | Postgres connection. Unset means an in-memory store (development only). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` | Provider keys. A set key lists that provider's profiles. It never selects a model. |
| `OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY` | Any other OpenAI-compatible endpoint. |
| `BOTANICAL_PROFILES` | JSON array of model profiles that users can pick (see [`profiles.example.json`](./profiles.example.json)). Do not put keys in it. |
| `BOTANICAL_CLI_PROFILES` | Shortcut to add coding-CLI presets: `grok-build,claude-code,codex`. Explicit `BOTANICAL_PROFILES` entries win. With `docker-compose.cli.yml`, the server installs and signs in those CLIs inside the container. |
| `BOTANICAL_MCP_CONFIG` / `BOTANICAL_MCP_SERVERS` | MCP server config file or inline JSON. |
| `BOTANICAL_WORKSPACE` | Root directory for agent files and the shell jail. Each agent gets `<root>/agents/<id>`. |
| `BOTANICAL_A2A_AUTORUN` | `true` lets a delivered agent-to-agent message start a background turn. |
| `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `SEARXNG_URL` | Web search backend (optional). |

Profile example:

```json
[
  { "id": "reason", "name": "Claude Sonnet", "provider": "anthropic", "model": "claude-sonnet-4-5" },
  { "id": "local", "name": "Local", "provider": "openai-compat", "model": "llama3.1", "baseUrl": "http://127.0.0.1:11434/v1" },
  { "id": "claude-code", "kind": "cli", "cli": "claude", "label": "Claude Code" }
]
```

## Security

Botanical gives language models real tools on your server. Please read this before deploying.

- **Run it on a host you trust and control, and don't share that host with anything sensitive.** `shell` and `code_exec` run model-generated commands inside a Linux namespace jail (unprivileged `unshare`, network off by default, read-only `/usr`, scrubbed environment, timeouts, output caps). That boundary is real, but **it is not a hardened sandbox**: no seccomp, no separate uid, no cgroup limits. See [packages/tools-shell/SECURITY.md](./packages/tools-shell/SECURITY.md).
- **Coding-agent CLIs run with their approval prompts disabled** (for example `--dangerously-bypass-approvals-and-sandbox` for Codex and `--permission-mode bypassPermissions` for Claude Code) inside the agent's workspace directory. Only enable them on a server where that is acceptable.
- **MCP servers are code you choose to run.** Only add servers you trust.
- **Auth is a single shared passcode** for one operator. Use a long passcode and serve the UI over HTTPS. Login attempts are rate-limited. Multi-user accounts are not implemented.
- Keep provider keys in the server environment or a secret store. Never commit `.env`.

To report a vulnerability, see [SECURITY.md](./SECURITY.md). Please do not open a public issue.

## Documentation

| Doc | Contents |
|-----|----------|
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
