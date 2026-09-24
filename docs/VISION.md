# Botanical — Product Vision

> **Decisions:** Locked choices from 2026-09-23 live in [DECISIONS.md](./DECISIONS.md) and supersede conflicting earlier brainstorm (local-first / CLI-first MVP). Business model: **open-source self-host** and **hosted SaaS**, same codebase.

## One-liner

Botanical is an open-source AI agent **server** you can **self-host** or use as a **hosted SaaS**: same tools, agents, memory, and workflows — any OpenAI-compatible brain (plus first-class Claude / Grok / DeepSeek / OpenRouter adapters) — with a **web client** as the first surface. Not local-first.

## The problem

Modern “AI assistants” package three things that should be separable:

1. **The brain** — which model / provider answers
2. **The body** — tools, MCP connectors, browser/desktop computer, routines
3. **The home** — UI, identity, memory, preferences, secrets

When a vendor couples all three, switching models means abandoning habits, connectors, and sometimes data. Users who already use GPT *and* Claude *and* Grok end up with fragmented agents. People who want cost control, regional availability, or self-hosted inference have no clean escape hatch.

Botanical treats the brain as a **swappable plug**, not the product — and runs the agent on a **server** you can self-host or use as our hosted SaaS, so clients can connect from anywhere and always-on capabilities can land later.

## Product principles

1. **Provider is a config choice, not a rewrite**  
   Changing `provider: anthropic` → `provider: openrouter` (or a custom base URL) must not invalidate tools, agents, or conversation UX.

2. **OpenAI-compatible as the lingua franca**  
   Prefer the OpenAI Chat Completions (and optionally Responses) shapes for widest interoperability. First-class adapters exist where vendors diverge (Anthropic Messages API, tool schemas, streaming quirks).

3. **Agent competence over chat novelty**  
   Streaming chat is table stakes. Differentiating value is tools/MCP, reliable multi-step runs, multi-agent collaboration, and (later) routines — not another pretty chat skin.

4. **Keys and runtime live on the server**  
   Model API keys are **server-side only** (not from the web client). In self-host mode the operator owns the host; in hosted SaaS mode we run that same server. The web UI authenticates with a password / passcode in v0.

5. **Honest capability surfaces**  
   Not every model supports the same tools, context length, or computer-use features. Botanical exposes **model profiles** with declared capabilities so the runtime can degrade gracefully instead of lying. **No silent default model** — the user must pick a profile explicitly.

6. **Separate from Charlie’s other businesses**  
   Botanical is not AstroLink / Klusvangen. Branding, repos, and roadmaps stay distinct.

7. **Open-source self-host and hosted SaaS**  
   Same codebase, two deployment modes: the operator runs the server, or we host it as a subscription. **MIT** stays on the OSS core. v0 audience is still Charlie as personal power user; community growth is not the wedge. **Multi-tenant auth** and **billing** are post-v0. Not local-first — clients always talk to a server.

## Who wins if Botanical works

- **Charlie (and similar power users)** get one agent server that routes hard reasoning to Claude/GPT, cheap bulk work to DeepSeek, and experimental models via OpenRouter — without three apps.
- **Self-hosters** get that server under MIT and can run it on any portable host.
- **Hosted subscribers** get the same product on our servers (subscription billing is post-v0).
- **Future always-on use** is unblocked by server-side architecture (routines/schedulers post-v0).
- **Charlie** gets a product-shaped project with a clear wedge: *non-vendor-locked Grok Bot*, open-source and offered as SaaS.

## Non-goals (v0)

- Multi-tenant auth, billing, or a subscription checkout in v0 (hosted SaaS is a deployment mode; those pieces are post-v0)
- Training or fine-tuning frontier models
- Replicating every proprietary Grok/ChatGPT/Claude UI widget before the runtime works
- Bundling AstroLink business logic into this repo
- Local-first / CLI-as-MVP as the primary plan (superseded 2026-09-23)
- Always-on routines / schedulers in v0 (explicitly deferred)
- Shipping browser / computer use as **core** built-ins (opt-in configurable only)

## North-star experience

You open the Botanical **web UI** against a server you self-host, or against our hosted SaaS. You authenticate (password / passcode in v0). You pick an **agent** and an explicit **model profile** (“fast-cheap”, “deep-reason”, “grok-fun”, …) — nothing auto-picks a silent default. You talk; the agent streams, uses built-in tools and MCP, and can message other agents asynchronously. Mid-session you can switch profiles because a task needs a different brain — tools and thread context stay. If OpenAI is down or too expensive, OpenRouter or DeepSeek take the same job. Your escape hatch is always: configure `baseURL` + server-held `apiKey` and keep going.

## Success metrics (early)

- Time to first successful multi-provider streaming chat via web → personal server
- Number of first-class providers with green smoke tests
- Ability to run the same agent/tool session across ≥2 providers without code changes
- Documented path to a custom OpenAI-compatible endpoint on a portable host
- Multi-agent: create agents, one-agent-per-chat UX, async A2A message delivery

## Related docs

- [DECISIONS.md](./DECISIONS.md) — authoritative locked decisions
- [BRAINSTORM.md](./BRAINSTORM.md) — concrete ideas; superseded bits marked
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system sketch
