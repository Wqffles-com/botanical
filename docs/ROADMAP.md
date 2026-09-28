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
- Dictation in the composer: speech becomes editable text before send, via a Whisper-compatible server endpoint, or the browser's speech recognition when no backend is configured
- **Routines**: cron schedules that run an agent on the server. Each run opens a new chat.
- **Listeners**: generic inbound webhooks (`POST /api/hooks/:id`) that start an agent turn. Typed forge listeners are still planned.
- **Notifications** when a background run finishes or fails, plus a `notify_user` tool when an agent needs attention.

## Planned

### Developer mode
- A **per-user "I'm a developer" setting**.
- When it is on: the coding-agent base is unlocked. That means coding CLI profiles (Grok Build, Claude Code, Codex), `shell` / `code_exec`, in-browser terminals into the agent workspace, and similar developer tooling.
- When it is off: a simpler assistant experience focused on chat, agents, memory, web, and connectors, with developer tooling hidden.
- Today there is no such setting. All users see the same UI, and the operator controls tool access through agent allowlists and roles.

### GitHub and GitLab connections
- **Connections page**: add a GitHub or GitLab (gitlab.com or self-managed) connection with an access token, stored server-side only.
- **Issue triggers**: a per-connection webhook endpoint with secret verification, plus routing rules such as "new issue in repo X goes to agent Y". The agent receives a message with the issue title, body, labels, and link, and a background turn starts automatically. Starts with "issue opened"; comments, pull/merge requests, and CI events can reuse the same mechanism later. Generic webhook listeners already ship; these typed kinds do not.
- **Forge MCP**: the same connection registers the official GitHub or GitLab MCP server with that token, so agents (including coding-agent CLI profiles through Botanical's MCP endpoint) can read and act on issues and pull requests within their role permissions.
- Webhooks require the server to be reachable from GitHub or GitLab; local testing needs a tunnel.

### Voice
- **Voice calls with an agent**: a voice mode for a chat. It transcribes what you say, sends it as a normal message to the chat's agent, and reads the reply aloud with text-to-speech. Because it goes through the normal chat pipeline, it works with any agent and profile (including coding-agent CLIs), keeps tools, memory, and roles, and saves the call as an ordinary chat.
- Later: low-latency realtime voice for providers that support it.

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
