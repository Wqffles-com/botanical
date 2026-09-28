# Roadmap

Botanical is in early alpha. This page separates what already ships from what is still being built and what is only planned. The order under **Planned** is indicative, not a commitment. Decisions and reasons are in [DECISIONS.md](./DECISIONS.md).

## Shipped

- Always-on server: self-host on a machine you run, or the same code with `DEPLOYMENT_MODE=SAAS`. A laptop run is for development. This is not a personal-PC app.
- Accounts on every instance. Email and password signup. The first account is the admin. Signup can be open, invite-only, or closed. Per-user settings and API keys. Admin global keys and settings are edited in the UI and stored encrypted in the database. `DATABASE_URL` and `BOTANICAL_ENCRYPTION_KEY` bootstrap the process. Other env vars only seed.
- Open source (MIT). Hosted billing is undecided. Nothing charges a customer.
- Monochrome shadcn/ui, with a light/dark toggle.
- Model profiles for OpenAI-compatible APIs (the start script offers DeepSeek first) and for OpenAI, Anthropic, xAI, and OpenRouter. No silent default model.
- Coding-agent CLI profiles (Grok Build, Claude Code, Codex) run headless on the server. Enabled with `BOTANICAL_CLI_PROFILES`. Installed and signed in inside the container from Settings. Each turn exposes Botanical tools through one MCP server named `botanical`.
- Custom agents with name, description, Lucide icon, color, prompt, and tool allowlist. One agent per chat.
- Async agent-to-agent messaging with an inbox. Optional autorun (`BOTANICAL_A2A_AUTORUN=true`) starts a background turn for the recipient.
- Shared and per-agent memory.
- Agents that create agents, limited to their own permissions.
- Roles and permissions over tools and MCP servers, enforced at dispatch.
- Built-in tools: file read/write/list/delete (per-agent directory), shell and code_exec (namespace jail), web search/fetch.
- Opt-in MCP servers (stdio / HTTP).
- Postgres persistence with automatic migrations.
- Docker Compose deploy, one-command `start.sh` / `start.ps1`, and a prebuilt release zip from CI.
- A rough API context trim (`maxContext`, about four characters per token). Proper context-limit handling is still planned.
- Dictation in the composer. Speech becomes editable text before send. Server providers: OpenAI-compatible, OpenRouter, xAI, and Qwen. The browser's speech recognition is used when no server provider is set.
- **Routines**: cron schedules that run an agent on the server. Each run opens a new chat.
- **Listeners**: generic inbound webhooks (`POST /api/hooks/:id`) that start an agent turn. Typed forge listeners are still planned.
- **Notifications** when a background run finishes or fails, plus a `notify_user` tool when an agent needs attention.
- **Async chat**: keep sending while the agent works. Messages queue on the server, a batch gets one reply, and replies arrive whole. Closing the tab does not stop the turn.

## In progress

### Accent color

- Main colors stay monochrome shadcn/ui.
- Settings will let each user pick an accent (blue, red, green, and similar).
- The picker is not in the tree yet. Light/dark already ships.

### Richer bot customization

- Shipped today: name, description, color, Lucide icon.
- Still to build: a title, an avatar shape, and an uploaded picture.

## Planned

### Developer mode
- A **per-user "I'm a developer" setting**.
- When it is on: the coding-agent base is unlocked. That means coding CLI profiles (Grok Build, Claude Code, Codex), `shell` / `code_exec`, in-browser terminals into the agent workspace, and similar developer tooling.
- When it is off: a simpler assistant experience focused on chat, agents, memory, web, and connectors, with developer tooling hidden.
- Today there is no such setting. All users see the same UI, and tool access is the agent's allowlist and roles.

### Start scripts choose coding CLIs
- `start.sh` and `start.ps1` ask which coding CLIs to enable and write `BOTANICAL_CLI_PROFILES`.
- Today they only ask whether to include `docker-compose.cli.yml`. They do not set that variable.

### CLI sessions and API context limits
- Start a coding CLI session when a chat needs it. Shut it down after 15 to 30 minutes idle. Save the session id and resume it on the next turn.
- Today each CLI turn is a new process with a rendered transcript. It does not save or resume a session id.
- API chats need proper context-limit handling. The current trim is a rough character estimate.

### Bot tools match the app
- Bots get tools for anything a person can do in the app: customize bots, create routines and listeners, change settings, and the rest of the product.
- Those tools stay inside the bot's role and allowlist.
- Agents can already create agents inside that ceiling. The other actions are not tools yet.

### Knowledge bases
- One shared knowledge base the user can edit, visible to every bot, plus one knowledge base per bot.
- Same architecture for both: organized Markdown files, edited with a block editor.
- Not in the tree yet.

### Computer use
- A desktop container per session, a web viewer the user can take over, and a computer-use tool gated by role.
- Opt-in. Not a core tool for every agent.

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
- Running the same codebase as a hosted service. The `SAAS` mode flag already switches branding. Accounts are the same as self-host.
- Hosted billing is undecided. Stubs in `@botanical/core` do not charge anyone and are not a billing plan.

### Other
- More clients (CLI, mobile) against the same API
- Provider failover and spending caps per profile
