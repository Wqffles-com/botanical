# Roadmap

Botanical is in early alpha. This page separates what already ships from what is still being built and what is only planned. The order under **Planned** is indicative, not a commitment. Decisions and reasons are in [DECISIONS.md](./DECISIONS.md).

## Shipped

- Always-on server: self-host on a machine you run, or the same code with `DEPLOYMENT_MODE=SAAS`. A laptop run is for development. This is not a personal-PC app.
- Accounts on every instance. Email and password signup. The first account is the admin. Signup can be open, invite-only, or closed. Per-user settings and API keys. Admin global keys and settings are edited in the UI and stored encrypted in the database. `DATABASE_URL` and `BOTANICAL_ENCRYPTION_KEY` bootstrap the process. Other env vars only seed.
- Open source (MIT). Hosted billing is undecided. Nothing charges a customer.
- Monochrome shadcn/ui, with a light/dark toggle.
- Model profiles for OpenAI-compatible APIs (the start script offers DeepSeek first) and for OpenAI, Anthropic, xAI, and OpenRouter. No silent default model.
- Coding-agent CLI profiles (Grok Build, Claude Code, Codex) run headless on the server. Enabled with `BOTANICAL_CLI_PROFILES`. Installed and signed in inside the container from Settings. Each turn exposes Botanical tools through one MCP server named `botanical`.
- Custom agents with name, title, description, Lucide icon, color, avatar shape, uploaded picture, prompt, and tool allowlist.
- **Accent color**: each user picks an accent in Settings → General. It only tints the primary color; the rest stays monochrome shadcn/ui.
- **One chat per agent**: each agent has a single chat, opened from the sidebar. Routine runs, webhook deliveries, and agent mail land there too. Long chats stay usable: a context window, automatic and manual compaction into a summary, and a clear action.
- **Group chats**: start a separate chat with several agents. Each answers in turn and reads the others' replies, or only the agents you `@mention` answer. An agent can hand off by mentioning another.
- Async agent-to-agent messaging with an inbox. `@Name` in a chat mails the mentioned agent, with composer autocomplete. Autorun (on by default; `BOTANICAL_A2A_AUTORUN=false` disables it) wakes the recipient with a real agent turn.
- Shared and per-agent memory.
- Agents that create agents, limited to their own permissions.
- Roles and permissions over tools and MCP servers, enforced at dispatch.
- Built-in tools: file read/write/list/delete (per-agent directory), shell and code_exec (namespace jail), web search/fetch.
- Opt-in MCP servers (stdio / HTTP).
- Postgres persistence with automatic migrations.
- Docker Compose deploy, one-command `start.sh` / `start.ps1`, and a prebuilt release zip from CI.
- A rough API context trim (`maxContext`, about four characters per token), plus compaction: a chat that passes 75% of the model's context is summarized, and the model reads the summary instead of older messages.
- Dictation in the composer. Speech becomes editable text before send. Server providers: OpenAI-compatible, OpenRouter, xAI, and Qwen. The browser's speech recognition is used when no server provider is set.
- **Routines**: cron schedules that run an agent on the server. Each run posts into the agent's chat.
- **Listeners**: generic inbound webhooks (`POST /api/hooks/:id`) that start an agent turn. Typed forge listeners are still planned.
- **Notifications** when a background run finishes or fails, plus a `notify_user` tool when an agent needs attention.
- **Message actions**: copy, edit, retry, and delete chat messages. Editing a user message resends it and drops what came after; editing a reply corrects it in place. Deleting can also drop everything after a message. Actions lock while the agent works.
- **Chat side panel**: Files (browse and read the agent's workspace), Memory (global and the agent's own), and Details (message counts, tool calls, tokens, context length, model). Toggle from the chat header.
- **GitHub**: each user connects their GitHub account in Settings. Agents clone repositories into their workspace or put their own files under git, then commit, push, and open issues and pull requests (`git_*` and `github_*` tools, capabilities `git` and `github`). GitHub listeners wake an agent when an issue is opened, a comment is posted, or a pull request is opened, and can add their webhook to a repository.
- **Async chat**: keep sending while the agent works. A message sent mid-turn steers the running turn: the model reads it before its next step (Claude Code reads it on stdin). Replies arrive whole. Closing the tab does not stop the turn.

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
- API chats need exact token counts. The trim and the compaction threshold use a rough character estimate.

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

### GitLab and more forge events
- GitHub ships (see Shipped). GitLab (gitlab.com or self-managed) is still planned: the same per-user token, git host, tools, and listener kind.
- More GitHub events (CI results, reviews) and a Files panel view of an agent's repositories can reuse what ships.
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
