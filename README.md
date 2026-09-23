# Botanical

**Non-vendor-locked Grok Bot** — an open-source AI agent you can **self-host**, or use as a **SaaS** subscription on our hosted servers. Same codebase, two deployment modes: one server, a web client, any OpenAI-compatible brain. Not local-first.

Botanical is Charlie’s greenfield project for an assistant with a swappable brain: swap models and providers without rewriting workflows, connectors, or memory. First-class adapters for **GPT (OpenAI)**, **Claude (Anthropic)**, **Grok (xAI)**, **DeepSeek**, and **OpenRouter**, plus anything that speaks the OpenAI Chat Completions (and optionally Responses) API shape. Run the server yourself, or use the same server on our hosted deployment.

> Status: **v0 integrate**. Runtime is **[Bun](https://bun.sh)**. Self-host and hosted SaaS are deployment modes of the same server.  
> License: [MIT](./LICENSE) for the OSS core

## Quickstart (self-host)

Requirements: Bun 1.2+ (this repo pins the package manager to Bun 1.4.2) and Docker, for Postgres and the server image.

```bash
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
cp .env.example .env
bun install
docker compose up -d postgres
bun run dev
```

- API health: [http://localhost:8787/health](http://localhost:8787/health)
- Web: [http://localhost:5173](http://localhost:5173) — **Check server health** calls `/api/health`, which Vite proxies to the server

`bun run dev` does not need Postgres. The server stub does not open a database connection yet. `DATABASE_URL` in `.env.example` matches the Compose defaults (`botanical` / `botanical` on `localhost:5432`). Change those before any shared deploy.

Postgres and the server image together:

```bash
docker compose up --build
```

The Compose server listens on port 8787 and still only serves `GET /health`. Run the web dev server on the host when you want the UI.

| Script | What it does |
|--------|----------------|
| `bun run dev` | Server (watch) and Vite together |
| `bun run build` | Build every workspace package |
| `bun run typecheck` | `tsc --noEmit` in every package |

### Layout

| Path | Role |
|------|------|
| `packages/server` | Bun HTTP API stub (`GET /health`) |
| `packages/web` | Vite + React + TypeScript client stub |
| `packages/core` | Shared types (`HealthResponse`, deployment mode) |
| `packages/providers` | Model provider adapters (ids only) |
| `packages/tools` | Built-in tool names |
| `packages/db` | Postgres migrations placeholder |
| `docker-compose.yml` | Postgres 16 + server image |
| `tsconfig.base.json` | Shared TypeScript config |

Deployment mode is `BOTANICAL_MODE=self-host` (default) or `saas`. One codebase; nothing here assumes SaaS-only hosting. Model API keys stay in server env (`PROVIDER_*_API_KEY`). See [docs/DECISIONS.md](./docs/DECISIONS.md).

## Why Botanical

Vendor-locked assistants couple your UX, tools, memory, and desktop agent to one company’s model stack. When pricing, rate limits, region availability, or model quality shift, you are stuck. Botanical inverts that:

- **One agent runtime**, many providers
- **Model profiles** instead of hard-coded vendor SDKs in product logic
- **Escape hatch**: point the server at local, self-hosted, or third-party OpenAI-compatible endpoints
- **Parity goals** with modern agent bots (tools/MCP, multi-agent, later routines) without locking the brain to a single vendor

Separate from AstroLink / Klusvangen — Botanical is its own product line.

## Who it’s for (v0)

- **Charlie as personal power user** — community growth is not the v0 wedge
- The product is **MIT open-source** and **self-hostable**, and also a **hosted SaaS** (subscription on our servers; billing is post-v0)
- Power users who want Claude for some tasks, Grok for others, DeepSeek for cost, OpenRouter for routing — without juggling apps
- Operators who want a **server** they run themselves, or our hosted deployment, plus a web UI — not a local-first app and not a vendor-locked model cloud

## High-level shape

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Web client │────▶│  Botanical       │────▶│  Provider adapters  │
│  (first)    │     │  server          │     │  OpenAI-compat +    │
│  + later    │     │  agents · tools  │     │  first-class SDKs   │
│  clients    │     │  MCP · Postgres  │     │                     │
└─────────────┘     └──────────────────┘     └─────────────────────┘
        self-host or hosted SaaS — same server, deployment mode only
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the sketch. Locked product choices live in [docs/DECISIONS.md](./docs/DECISIONS.md).

## Provider support (target)

| Provider    | Mode                         | Notes                                      |
|-------------|------------------------------|--------------------------------------------|
| OpenAI      | Native + OpenAI-compatible   | GPT family; Responses API when useful      |
| Anthropic   | First-class adapter          | Claude; map tools/messages carefully       |
| xAI         | First-class / OpenAI-compat  | Grok                                       |
| DeepSeek    | OpenAI-compatible            | Cost / reasoning profiles                  |
| OpenRouter  | OpenAI-compatible gateway    | Broad model catalog + fallback routing     |
| Custom      | OpenAI-compatible base URL   | Local, proxy, or self-hosted               |

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/DECISIONS.md](./docs/DECISIONS.md) | **Authoritative** locked product decisions |
| [docs/VISION.md](./docs/VISION.md) | Product vision in depth |
| [docs/BRAINSTORM.md](./docs/BRAINSTORM.md) | Ideas, UX, milestones (superseded bits marked) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Server, web client, adapters, Postgres |

## v0 MVP (locked)

**Self-host or hosted SaaS** — the same Botanical **server** + **web UI** (a deployment mode, not a second product). Not a local-first app.

- Streaming **chat + tools + MCP**
- **Unlimited** user-defined agents (tools + description/prompt); **one agent per chat**; async **agent-to-agent** messaging
- Built-ins: **web search/fetch**, **shell/code exec**, **file read/write** (browser/computer use opt-in, not core)
- **Postgres** persistence; model API keys **server-side only**; web auth via **password / passcode**
- **No default model** — explicit profile pick; server **portable / host-agnostic**
- Stack: **TypeScript** on **Bun** (chosen at scaffold; see [docs/DECISIONS.md](./docs/DECISIONS.md))
- **MIT** for the OSS core. **Billing** and **multi-tenant auth** for the hosted SaaS are **post-v0**

Routines / always-on schedulers are **post-v0**. Details: [docs/DECISIONS.md](./docs/DECISIONS.md).

## Contributing

MIT-licensed OSS core. An external contribution process is not the v0 focus. Do not commit secrets.

## License

[MIT](./LICENSE) for the OSS core — self-host it, or use the same code as the hosted SaaS. Subscription billing is post-v0.
