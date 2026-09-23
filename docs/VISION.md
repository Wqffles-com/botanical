# Botanical — Product Vision

## One-liner

Botanical is a personal AI agent runtime you control: same tools, memory, and workflows — any OpenAI-compatible brain (plus first-class Claude / Grok / DeepSeek / OpenRouter adapters).

## The problem

Modern “AI assistants” package three things that should be separable:

1. **The brain** — which model / provider answers
2. **The body** — tools, MCP connectors, browser/desktop computer, routines
3. **The home** — UI, identity, memory, preferences, secrets

When a vendor couples all three, switching models means abandoning habits, connectors, and sometimes data. Users who already use GPT *and* Claude *and* Grok end up with fragmented agents. Teams that need cost control, regional availability, or local inference have no clean escape hatch.

Botanical treats the brain as a **swappable plug**, not the product.

## Product principles

1. **Provider is a config choice, not a rewrite**  
   Changing `provider: anthropic` → `provider: openrouter` (or a custom base URL) must not invalidate tools, skills, or conversation UX.

2. **OpenAI-compatible as the lingua franca**  
   Prefer the OpenAI Chat Completions (and optionally Responses) shapes for widest interoperability. First-class adapters exist where vendors diverge (Anthropic Messages API, tool schemas, streaming quirks).

3. **Agent competence over chat novelty**  
   Streaming chat is table stakes. Differentiating value is tools/MCP, reliable multi-step runs, routines/skills, and (later) a local agent computer for desktop parity with products like Grok Bot.

4. **Own your keys and data paths**  
   BYOK (bring your own keys). Secrets stay local or in user-controlled secret stores. Prefer portable formats for memory and skills so export isn’t an afterthought.

5. **Honest capability surfaces**  
   Not every model supports the same tools, context length, or computer-use features. Botanical exposes **model profiles** with declared capabilities so the runtime can degrade gracefully instead of lying.

6. **Separate from Charlie’s other businesses**  
   Botanical is not AstroLink / Klusvangen. Branding, repos, and roadmaps stay distinct.

## Who wins if Botanical works

- **Power users** get one agent that routes hard reasoning to Claude/GPT, cheap bulk work to DeepSeek, and experimental models via OpenRouter — without three apps.
- **Builders** get a runtime + adapter layer they can embed or extend.
- **Privacy-minded users** get a path: cloud API today → local OpenAI-compatible server tomorrow, same skills and MCP servers.
- **Charlie** gets a product-shaped open project with a clear wedge: *non-vendor-locked Grok Bot*.

## Non-goals (v0–v1)

- Being the best hosted multi-tenant SaaS chat app on day one
- Training or fine-tuning our own frontier models
- Replicating every proprietary Grok/ChatGPT/Claude UI widget before the runtime works
- Bundling AstroLink business logic into this repo

## North-star experience

You open Botanical (CLI first, then desktop/web). You pick or auto-select a **model profile** (“fast-cheap”, “deep-reason”, “grok-fun”, “local-llama”). You talk. The agent uses your MCP connectors and skills. Mid-session you switch profiles because a task needs a different brain — tools and thread context stay. If OpenAI is down or too expensive, OpenRouter or DeepSeek take the same job. Your escape hatch is always: set `baseURL` + `apiKey` and keep going.

## Success metrics (early)

- Time to first successful multi-provider chat from a clean clone
- Number of first-class providers with green smoke tests
- Ability to run the same skill/tool session across ≥2 providers without code changes
- Documented path to a custom OpenAI-compatible endpoint

## Related docs

- [BRAINSTORM.md](./BRAINSTORM.md) — concrete ideas, MVP, open questions
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system sketch
