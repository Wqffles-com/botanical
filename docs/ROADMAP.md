# Roadmap

Botanical is in early alpha. This page separates what already ships from what is planned. Nothing under **Planned** exists in the code yet. The order is indicative, not a commitment.

## Shipped

- Passcode login, and one operator per deployment
- Model profiles for OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, and any OpenAI-compatible base URL, with no default model
- Coding-agent CLI profiles (Grok Build, Claude Code, Codex) run headless on the server
- Unlimited custom agents (name, icon, color, prompt, tool allowlist), one agent per chat
- Async agent-to-agent messaging with an inbox. Optional autorun (`BOTANICAL_A2A_AUTORUN=true`) starts a background turn for the recipient.
- Shared and per-agent memory
- Agents that create agents, limited to their own permissions
- Roles and permissions over tools and MCP servers, enforced at dispatch
- Built-in tools: file read/write/list/delete (per-agent directory), shell and code_exec (namespace jail), web search/fetch
- Opt-in MCP servers (stdio / HTTP)
- Postgres persistence with automatic migrations
- Docker Compose deploy, and a prebuilt release zip from CI
- `DEPLOYMENT_MODE` switch (`SELF_HOST` / `SAAS`) on one codebase

## Planned

### Always-on work
- **Routines**: scheduled agent runs (cron-style) that execute on the server while no one is connected.
- **Listeners**: event triggers (webhooks, incoming messages, connector events) that start agent turns.
- Notifications when background work finishes or needs attention.

### Developer mode
- A **per-user "I'm a developer" setting**.
- When it is on: the coding-agent base is unlocked. That means coding CLI profiles (Grok Build, Claude Code, Codex), `shell` / `code_exec`, in-browser terminals into the agent workspace, and similar developer tooling.
- When it is off: a simpler assistant experience focused on chat, agents, memory, web, and connectors, with developer tooling hidden.
- Today there is no such setting. All users see the same UI, and the operator controls tool access through agent allowlists and roles.

### Tool safety
- Approval prompts in the UI for destructive tools (shell, writes).
- A tool-call audit log with secret redaction.

### Hosted mode
- Multi-user and multi-tenant accounts, and per-tenant isolation
- Subscription billing (hooks exist in `@botanical/core` as no-op stubs)

### Other
- Opt-in browser / computer use
- More clients (CLI, mobile) against the same API
- Provider failover and cost caps per profile
