# Botanical: product vision

> Design decisions and their rationale are recorded in [DECISIONS.md](./DECISIONS.md). Planned work is in [ROADMAP.md](./ROADMAP.md).

## One-liner

Botanical is an open-source, always-on AI agent platform that runs in the cloud, on a server you control or on the hosted service. It works with any OpenAI-compatible model and has first-class adapters for GPT, Claude, Grok, DeepSeek, and OpenRouter. The web client is the first interface.

## The problem

AI assistants usually bundle three things that should be separate:

1. **The brain**: which model and provider answers
2. **The body**: tools, MCP connectors, code execution, schedules
3. **The home**: UI, identity, memory, preferences, secrets

When one vendor couples all three, switching models means giving up your habits, connectors, and sometimes your data. People who use several models end up with fragmented assistants. People who want cost control, regional availability, or self-hosted inference have no clean way out.

Botanical treats the brain as a **swappable plug**. The agent runtime, tools, memory, and history live on a **server**, so the assistant keeps running when your laptop is closed.

## Product principles

1. **Cloud, always on**
   Botanical runs on a server: a VPS or dedicated host you control, or the hosted service. It is not a desktop app, and it is not meant to run on a personal PC or laptop except during development. Because the server is always up, agents can keep working while you are away. Agent-to-agent messages, routines, and webhook listeners start turns with no browser connected ([ROADMAP.md](./ROADMAP.md)).

2. **Provider is a config choice, not a rewrite**
   Changing a profile from `anthropic` to `openrouter` (or a custom base URL) must not break tools, agents, or the conversation.

3. **OpenAI-compatible as the common language**
   Prefer the OpenAI Chat Completions shape for the widest interoperability. Use first-class adapters where vendors differ (Anthropic Messages API, tool schemas, streaming quirks). Subscription coding-agent CLIs plug in as profiles too.

4. **Agent competence over chat novelty**
   Streaming chat is table stakes. The value is in tools and MCP, reliable multi-step runs, multi-agent collaboration, memory, and background work.

5. **Keys and runtime live on the server**
   Model API keys are server-side only and never come from the browser.

6. **Honest capability surfaces**
   Models differ in tools, context length, and features. Botanical exposes explicit **model profiles**, and **there is no silent default model**: every chat names its profile.

7. **For developers and non-developers alike**
   Roughly half the intended users are developers and half are not. Non-developers should get a simple, capable assistant. Developers should be able to opt into a coding-agent base: coding CLIs, shell and code execution, terminals. The per-user developer setting that separates these experiences is planned (see [ROADMAP.md](./ROADMAP.md)). Today, operators control tool access with agent allowlists and roles.

8. **Open source and hosted, one codebase**
   MIT-licensed. Self-host it, or use the hosted service built from the same code. Deployment mode is configuration, not a fork. See [DEPLOYMENT_MODES.md](./DEPLOYMENT_MODES.md).

## Who benefits

- **People who use several models** get one always-on agent server. They can send hard reasoning to Claude or GPT, bulk work to DeepSeek, and experiments to OpenRouter, without juggling apps.
- **Non-developers** get an assistant with agents, memory, and web tools that doesn't require touching a terminal.
- **Developers** get coding-agent CLIs and sandboxed shell/code execution on a server they control.
- **Self-hosters** get all of it under MIT on any portable host.
- **Hosted users** get the same product without running a server.

## Non-goals (for now)

- Training or fine-tuning models
- Copying every proprietary assistant UI widget before the runtime is solid
- A local-first or desktop-first app. Clients always talk to a server.
- Browser or computer use as a core built-in (opt-in only, if added)

## North-star experience

You open the Botanical web UI against your server or the hosted service and sign in. You pick an agent and an explicit model profile. You talk; the agent streams, uses built-in tools and MCP, remembers what matters, and messages other agents asynchronously. You can switch profiles mid-conversation when a task needs a different brain, and the tools and context stay. When you close the tab, the server keeps going: agents answer each other's messages, run routines, and react to webhooks. If one provider is down or too expensive, another takes the job. You configure a base URL and a server-held key, and you keep going.

## Related docs

- [DECISIONS.md](./DECISIONS.md): design decisions
- [ROADMAP.md](./ROADMAP.md): planned work
- [ARCHITECTURE.md](./ARCHITECTURE.md): system design
