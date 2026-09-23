# Botanical

**Non-vendor-locked Grok Bot** — a personal AI agent that works with *any* OpenAI-compatible endpoint.

Botanical is Charlie’s greenfield project for an assistant you own: swap models and providers without rewriting your workflows, connectors, or memory. First-class adapters for **GPT (OpenAI)**, **Claude (Anthropic)**, **Grok (xAI)**, **DeepSeek**, and **OpenRouter**, plus anything that speaks the OpenAI Chat Completions (and optionally Responses) API shape.

> Status: **greenfield**. Vision and architecture brainstorm only — no runtime yet.  
> License: [MIT](./LICENSE)

## Why Botanical

Vendor-locked assistants couple your UX, tools, memory, and desktop agent to one company’s model stack. When pricing, rate limits, region availability, or model quality shift, you are stuck. Botanical inverts that:

- **One agent runtime**, many providers
- **Model profiles** instead of hard-coded vendor SDKs in product logic
- **Escape hatch**: point at local, self-hosted, or third-party OpenAI-compatible endpoints
- **Parity goals** with modern agent bots (tools/MCP, routines, computer use) without locking the brain to a single vendor

Separate from AstroLink / Klusvangen — Botanical is its own product line.

## Who it’s for

- Builders who already pay for multiple model APIs and want one agent surface
- Power users who want Claude for some tasks, Grok for others, DeepSeek for cost, OpenRouter for routing — without juggling apps
- Privacy-conscious users who want a path to local / self-hosted endpoints later
- Early contributors who enjoy agent runtimes, MCP, and provider abstraction

## High-level shape

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Clients    │────▶│  Orchestration   │────▶│  Provider adapters  │
│ desktop/web │     │  runtime + tools │     │  OpenAI-compat +    │
│ CLI / API   │     │  MCP / routines  │     │  first-class SDKs   │
└─────────────┘     └──────────────────┘     └─────────────────────┘
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the first-pass sketch.

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
| [docs/VISION.md](./docs/VISION.md) | Product vision in depth |
| [docs/BRAINSTORM.md](./docs/BRAINSTORM.md) | Ideas, UX, MVP, open questions |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Client, runtime, adapters, secrets |

## Suggested MVP (see brainstorm)

Smallest useful product: **CLI + config** that chats against a chosen provider profile, streams tokens, and can call a minimal tool set — with one config file switching between OpenAI / Anthropic / xAI / DeepSeek / OpenRouter / custom base URL.

## Contributing

Not open for external contributions yet beyond discussion via issues. Docs-first bootstrap; code comes next.

## License

[MIT](./LICENSE) — use it, fork it, lock yourself out of vendors on purpose.
