# Botanical

**Non-vendor-locked Grok Bot** — an open-source AI agent you can **self-host**, or use as a **SaaS** subscription on our hosted servers. Same codebase, two deployment modes: one server, a web client, any OpenAI-compatible brain. Not local-first.

Botanical is Charlie’s greenfield project for an assistant with a swappable brain: swap models and providers without rewriting workflows, connectors, or memory. First-class adapters for **GPT (OpenAI)**, **Claude (Anthropic)**, **Grok (xAI)**, **DeepSeek**, and **OpenRouter**, plus anything that speaks the OpenAI Chat Completions (and optionally Responses) API shape. Run the server yourself, or use the same server on our hosted deployment.

> Status: **greenfield**. Product decisions locked 2026-09-23. Deployment mode (`self-host` / `saas`) is in `@botanical/core`; billing is not built.  
> License: [MIT](./LICENSE)

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
| [docs/TESTING.md](./docs/TESTING.md) | v0 smoke / e2e harness (health, auth, agent, chat) |

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
