# Botanical

**Non-vendor-locked Grok Bot** — a personal AI agent you host: one server, a web client, any OpenAI-compatible brain.

Botanical is Charlie’s greenfield project for an assistant you own: swap models and providers without rewriting workflows, connectors, or memory. First-class adapters for **GPT (OpenAI)**, **Claude (Anthropic)**, **Grok (xAI)**, **DeepSeek**, and **OpenRouter**, plus anything that speaks the OpenAI Chat Completions (and optionally Responses) API shape.

> Status: **greenfield**. Product decisions locked 2026-09-23. The agent runtime and async agent-to-agent bus live in [`packages/core`](./packages/core/README.md) and [`packages/server`](./packages/server/README.md).  
> License: [MIT](./LICENSE)

## Why Botanical

Vendor-locked assistants couple your UX, tools, memory, and desktop agent to one company’s model stack. When pricing, rate limits, region availability, or model quality shift, you are stuck. Botanical inverts that:

- **One agent runtime**, many providers
- **Model profiles** instead of hard-coded vendor SDKs in product logic
- **Escape hatch**: point the server at local, self-hosted, or third-party OpenAI-compatible endpoints
- **Parity goals** with modern agent bots (tools/MCP, multi-agent, later routines) without locking the brain to a single vendor

Separate from AstroLink / Klusvangen — Botanical is its own product line.

## Who it’s for (v0)

- **Charlie as personal power user** — not teams or OSS-community-first yet
- Power users who want Claude for some tasks, Grok for others, DeepSeek for cost, OpenRouter for routing — without juggling apps
- Anyone who wants a **personal hosted server** with a web UI, not a vendor cloud lock-in

## High-level shape

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Web client │────▶│  Botanical       │────▶│  Provider adapters  │
│  (first)    │     │  server          │     │  OpenAI-compat +    │
│  + later    │     │  agents · tools  │     │  first-class SDKs   │
│  clients    │     │  MCP · Postgres  │     │                     │
└─────────────┘     └──────────────────┘     └─────────────────────┘
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

Personal **hosted Botanical server** + **web UI**:

- Streaming **chat + tools + MCP**
- **Unlimited** user-defined agents (tools + description/prompt); **one agent per chat**; async **agent-to-agent** messaging
- Built-ins: **web search/fetch**, **shell/code exec**, **file read/write** (browser/computer use opt-in, not core)
- **Postgres** persistence; model API keys **server-side only**; web auth via **password / passcode**
- **No default model** — explicit profile pick; server **portable / host-agnostic**
- Stack: **TypeScript** on **Bun or Deno** (chosen at scaffold)

Routines / always-on schedulers are **post-v0**. Details: [docs/DECISIONS.md](./docs/DECISIONS.md).

## Contributing

Not open for external contributions yet beyond discussion via issues. Docs-first bootstrap; code comes next.

## License

[MIT](./LICENSE) — use it, fork it, lock yourself out of vendors on purpose.
