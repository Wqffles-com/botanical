# Server

[Index](README.md)

HTTP API: account auth, agents, chats, streaming turns, agent-to-agent mail, routines, listeners, notifications, memory, roles, MCP listing, CLI install/login, dictation, GitHub connection.

- Package: `@botanical/server`
- Library entry: `packages/server/src/index.ts` (`package.json` `exports`)
- Process entry: `packages/server/src/serve.ts` (`bun src/serve.ts`, script `start` / `dev`)
- App wiring: `packages/server/src/app.ts` (`createApp`)

## Directories

| Path | Purpose |
|------|---------|
| `packages/server/src/router.ts` | Method + path table, auth wrapper, global `OPTIONS` |
| `packages/server/src/routes` | One `register*` function per area |
| `packages/server/src/http.ts` | JSON helpers, body limit, CORS finish |
| `packages/server/src/config.ts` | `loadConfig` |
| `packages/server/src/auth` | Session cookie, login rate limit. Actor scope is `packages/db/src/actor.ts` |
| `packages/server/src/provider-keys.ts` | Resolves a provider key from the user, then the global row |
| `packages/server/src/db/memory-accounts.ts` | In-memory accounts, secrets, and settings |
| `packages/server/src/push` | Web Push: `service.ts` keeps per-user device subscriptions and event toggles in `prefs` (`push.subscriptions`, `push.events`), generates the VAPID key pair on first use (public key in `push.vapid_public`, private key in the secret `push-vapid-private`), and `withPush` wraps the store so every `notifications.create` also pushes to the owner's devices (dead endpoints are dropped). Kinds default on; `BOTANICAL_VAPID_SUBJECT` overrides the VAPID contact |
| `packages/server/src/db` | In-memory store and Postgres adapter. Routines, listeners, and notifications: `packages/server/src/db/always-on.ts` |
| `packages/server/src/runtime` | Turn runner, profile resolver, workspace path, store adapter. Background turns: `packages/server/src/runtime/jobs.ts`, `packages/server/src/runtime/turns.ts`. Async chat queue, background turns, and events: `packages/server/src/runtime/chat-queue.ts`. An agent's own chat: `packages/server/src/runtime/agent-chat.ts`. Group chat responders: `packages/server/src/runtime/group.ts` |
| `packages/server/src/routines` | Cron check (`cron.ts`) and in-process scheduler (`scheduler.ts`) |
| `packages/server/src/listeners` | Webhook signature, body cap, and prompt framing. `packages/server/src/listeners/kinds.ts` maps a listener `kind` (`webhook`, `github`) to its verify, accept, and prompt functions |
| `packages/server/src/github` | GitHub connection (`packages/server/src/github/connection.ts`), REST client (`packages/server/src/github/api.ts`), GitHub tools (`packages/server/src/github/tools.ts`), git tools (`packages/server/src/github/git.ts`), and GitHub webhook deliveries (`packages/server/src/github/webhook.ts`) |
| `packages/server/src/streaming.ts` | SSE encode and heartbeat |
| `packages/server/src/tools` | Builtin contributors (files, shell, web, memory, agent admin, `notify_user` in `packages/server/src/tools/notify.ts`, MCP). Git and GitHub tools live in `packages/server/src/github` |
| `packages/server/src/a2a` | Agent-message bus service and `send_agent_message`. Chat `@mentions` in `packages/server/src/a2a/mentions.ts` |
| `packages/server/src/mcp-host.ts` | Boot MCP and snapshot for `GET /api/mcp/servers` |
| `packages/server/src/cli-mcp.ts` | Per-run MCP endpoint for CLI profiles, bound to the turn's user |
| `packages/server/src/cli-install` | Install and device-login for coding CLIs. Lists every CLI; installing one no profile uses stores its preset profiles (`presetCliProfiles` in `packages/server/src/config.ts`). Logins land in a per-user CLI home; `userCliAvailability` checks that home, then the shared one |
| `packages/server/src/speech` | Speech-to-text provider calls |
| `packages/server/src/provider-host.ts` | Holds the provider registry on the config object |
| `packages/server/test` | `bun test` files |

Admin user management: `GET /api/admin/users` lists accounts with `lastActiveAt` (the newest session's start) and `disabledAt`. `PATCH /api/admin/users/:id` takes `disabled` and `role`; disabling deletes the user's sessions, and a disabled account cannot log in (`403 account_disabled`) or use an existing token. `DELETE /api/admin/users/:id` removes the account with its agents, chats, messages, routines, listeners, notifications, memories, personal profiles, and secrets (`AccountRepository.deleteUser`). Admins cannot disable or delete themselves, and the last active admin cannot be demoted, disabled, or deleted (`409 last_admin`). An account referenced by the append-only tool log cannot be deleted (`409 user_has_history`); disable it instead.

## Exports

From `packages/server/src/index.ts`: `createApp`, `loadConfig`, `createStore`, `createMemoryStore`, `createA2AService`, `createSendAgentMessageTool`, `startServerMcp`, `emptyServerMcp`, `createDefaultToolRegistry`, `ConfigError`, `SERVER_VERSION`. Types include `App`, `ServerConfig`, `Store`, `Agent`, `Chat`, `Message`.

## HTTP routes

Registered only through `router.add` in the handler file. `packages/server/src/app.ts` calls each `register*`. `OPTIONS` on any path returns 204 from `packages/server/src/router.ts` (not a registered route). No WebSocket handler.

`POST /api/chats/:id/messages` with `async: true` queues the message and returns `202 { queued }` (optional `clientId` becomes the queue id). The turn runs detached from the request in `packages/server/src/runtime/chat-queue.ts`. A message queued during a turn steers it: the queue is the turn's `steering` source, so the agent loop takes the message before the model's next step, and Claude Code reads it on stdin. Messages the turn cannot take (another profile, step cap) are answered by the next turn. `GET /api/chats/:id/events` is an SSE feed of `status` (`running`, `queued`, and `agentId` of the agent answering), whole `message` rows, `message-updated`, `messages-deleted` (`ids`), and `error`. `POST /api/chats/:id/stop` aborts the running queued turn. An `@Name` of another agent in the posted content sends that agent a copy as A2A mail from the chat's agent (`fromChatId` set); the JSON responses list them in `mentions` (`packages/server/src/a2a/mentions.ts`). Agents in the chat get no mail.

`GET /api/messages/search?q=` searches the signed-in user's user and assistant messages (never tool or system rows), newest first. Optional `agentId` (owner or member of the chat), `role` (`user` or `assistant`), `from` / `to` (ISO dates), and `limit` (1 to 50, default 20). Each result is `{ message, agentId, chatTitle, snippet: { text, start, end } }`, where `start`/`end` bound the match in `snippet.text` (`searchSnippet` in `packages/server/src/routes/messages.ts`). Postgres matches full-text (`websearch_to_tsquery`) or by substring; the in-memory store matches by substring (`messages.search` in the store).

One chat per agent: the chat an agent owns with no members is its own chat, and every conversation with it happens there (`packages/server/src/runtime/agent-chat.ts`). `POST /api/chats` without `memberIds` returns that chat (`200`), or creates it on the given profile, titled with the agent's name (`201`); `GET /api/agents/:id/chat` returns `{ chat }`, null before the first conversation. Routine runs and listener deliveries run in the agent's own chat through `runTurn` in `packages/server/src/runtime/chat-queue.ts`, so the events feed shows them live; their user message starts with `[Routine · …]` or `[Webhook · …]`. A2A autorun inbox turns write there too. A chat never switches between an agent's own chat and a group chat: `PATCH` refuses members on the first and an empty list on the second (`400`). Deleting an agent deletes its own chat; group chats still block it. `DELETE /api/chats/:id/messages` clears the chat. `POST /api/chats/:id/compact` (optional `profileId`) summarizes it into one `system` message named `compaction`, which the model reads instead of the older messages (`409 nothing_to_compact` when nothing came after the last one). After each round of replies, `streamChatReplies` compacts on its own once the chat passes 75% of the profile's context and emits a `compacted` event. Clear and compact return `409 chat_busy` while the chat's queue runs.

Group chats: `POST /api/chats` and `PATCH /api/chats/:id` take `memberIds`, the other agents that answer beside the owner, in speaking order (at most 7, not the owner, each one of the user's agents). With members, `POST /api/chats` starts a new group chat every time. `GET /api/chats?agentId=` matches owners and members. A user message is answered by the members it `@mentions`, or by every participant in turn (owner first) when it mentions none; a reply that `@mentions` a participant who has not answered yet hands it the floor next, and each agent answers at most once per message (`respondersFor` and `handoffs` in `packages/server/src/runtime/group.ts`, `streamChatReplies` in `packages/server/src/runtime/turn.ts`). Assistant and tool rows carry `agentId`. An agent's replies are the messages it sent with `send_message` (or its text output when it sent none), and a handoff reads all of them (`turnReplies` in `packages/server/src/runtime/turn.ts`). The blocking JSON form adds `replies` (each agent's last reply); the streaming form sends an `agent` event before each agent's turn and one final `done`. An agent in a group chat, as owner or member, cannot be deleted (`409 agent_in_use`). Without `async`, the route is SSE when the JSON body has `stream: true`, or when `stream` is omitted and `Accept` contains `text/event-stream` (`packages/server/src/streaming.ts`), and blocking JSON otherwise.

| Method | Path | Handler |
|--------|------|---------|
| GET | `/` | `packages/server/src/routes/health.ts` |
| GET | `/api/health` | `packages/server/src/routes/health.ts` |
| GET | `/health` | `packages/server/src/routes/health.ts` |
| GET | `/ready` | `packages/server/src/routes/health.ts` |
| GET | `/api/auth/config` | `packages/server/src/routes/auth.ts` |
| POST | `/api/auth/signup` | `packages/server/src/routes/auth.ts` |
| POST | `/api/auth/login` | `packages/server/src/routes/auth.ts` |
| POST | `/api/auth/logout` | `packages/server/src/routes/auth.ts` |
| GET | `/api/auth/me` | `packages/server/src/routes/auth.ts` |
| POST | `/api/auth/password` | `packages/server/src/routes/auth.ts` |
| POST | `/api/auth/reset` | `packages/server/src/routes/auth.ts` |
| GET | `/api/auth/sessions` | `packages/server/src/routes/auth.ts` |
| DELETE | `/api/auth/sessions` | `packages/server/src/routes/auth.ts` |
| DELETE | `/api/auth/sessions/:id` | `packages/server/src/routes/auth.ts` |
| GET | `/api/agents` | `packages/server/src/routes/agents.ts` |
| POST | `/api/agents` | `packages/server/src/routes/agents.ts` |
| GET | `/api/agents/:id` | `packages/server/src/routes/agents.ts` |
| PATCH | `/api/agents/:id` | `packages/server/src/routes/agents.ts` |
| DELETE | `/api/agents/:id` | `packages/server/src/routes/agents.ts` |
| GET | `/api/agents/:id/chat` | `packages/server/src/routes/chats.ts` |
| GET | `/api/agents/:id/files` | `packages/server/src/routes/workspace.ts` |
| GET | `/api/agents/:id/files/content` | `packages/server/src/routes/workspace.ts` |
| POST | `/api/agents/:id/uploads` | `packages/server/src/routes/uploads.ts` |
| GET | `/api/agents/:id/uploads/:file` | `packages/server/src/routes/uploads.ts` |
| GET | `/api/agents/:id/roles` | `packages/server/src/routes/roles.ts` |
| PUT | `/api/agents/:id/roles` | `packages/server/src/routes/roles.ts` |
| GET | `/api/roles` | `packages/server/src/routes/roles.ts` |
| POST | `/api/roles` | `packages/server/src/routes/roles.ts` |
| GET | `/api/roles/:id` | `packages/server/src/routes/roles.ts` |
| PATCH | `/api/roles/:id` | `packages/server/src/routes/roles.ts` |
| DELETE | `/api/roles/:id` | `packages/server/src/routes/roles.ts` |
| GET | `/api/memories` | `packages/server/src/routes/memories.ts` |
| POST | `/api/memories` | `packages/server/src/routes/memories.ts` |
| GET | `/api/memories/:id` | `packages/server/src/routes/memories.ts` |
| PATCH | `/api/memories/:id` | `packages/server/src/routes/memories.ts` |
| DELETE | `/api/memories/:id` | `packages/server/src/routes/memories.ts` |
| GET | `/api/chats` | `packages/server/src/routes/chats.ts` |
| POST | `/api/chats` | `packages/server/src/routes/chats.ts` |
| GET | `/api/chats/:id` | `packages/server/src/routes/chats.ts` |
| PATCH | `/api/chats/:id` | `packages/server/src/routes/chats.ts` |
| DELETE | `/api/chats/:id` | `packages/server/src/routes/chats.ts` |
| GET | `/api/messages/search` | `packages/server/src/routes/messages.ts` |
| GET | `/api/chats/:id/messages` | `packages/server/src/routes/messages.ts` |
| POST | `/api/chats/:id/messages` | `packages/server/src/routes/messages.ts` |
| DELETE | `/api/chats/:id/messages` | `packages/server/src/routes/messages.ts` |
| POST | `/api/chats/:id/compact` | `packages/server/src/routes/messages.ts` |
| PATCH | `/api/chats/:id/messages/:messageId` | `packages/server/src/routes/messages.ts` |
| DELETE | `/api/chats/:id/messages/:messageId` | `packages/server/src/routes/messages.ts` |
| GET | `/api/chats/:id/events` | `packages/server/src/routes/messages.ts` |
| POST | `/api/chats/:id/stop` | `packages/server/src/routes/messages.ts` |
| GET | `/api/routines` | `packages/server/src/routes/routines.ts` |
| POST | `/api/routines/preview` | `packages/server/src/routes/routines.ts` |
| POST | `/api/routines` | `packages/server/src/routes/routines.ts` |
| GET | `/api/routines/:id` | `packages/server/src/routes/routines.ts` |
| PATCH | `/api/routines/:id` | `packages/server/src/routes/routines.ts` |
| DELETE | `/api/routines/:id` | `packages/server/src/routes/routines.ts` |
| POST | `/api/routines/:id/pause` | `packages/server/src/routes/routines.ts` |
| POST | `/api/routines/:id/resume` | `packages/server/src/routes/routines.ts` |
| POST | `/api/routines/:id/run` | `packages/server/src/routes/routines.ts` |
| GET | `/api/routines/:id/runs` | `packages/server/src/routes/routines.ts` |
| GET | `/api/listeners` | `packages/server/src/routes/listeners.ts` |
| POST | `/api/listeners` | `packages/server/src/routes/listeners.ts` |
| GET | `/api/listeners/:id` | `packages/server/src/routes/listeners.ts` |
| PATCH | `/api/listeners/:id` | `packages/server/src/routes/listeners.ts` |
| DELETE | `/api/listeners/:id` | `packages/server/src/routes/listeners.ts` |
| POST | `/api/listeners/:id/rotate-secret` | `packages/server/src/routes/listeners.ts` |
| GET | `/api/listeners/:id/deliveries` | `packages/server/src/routes/listeners.ts` |
| POST | `/api/hooks/:listenerId` | `packages/server/src/routes/listeners.ts` |
| POST | `/api/listeners/:id/github-hook` | `packages/server/src/routes/github.ts` |
| GET | `/api/github` | `packages/server/src/routes/github.ts` |
| PUT | `/api/github` | `packages/server/src/routes/github.ts` |
| DELETE | `/api/github` | `packages/server/src/routes/github.ts` |
| GET | `/api/github/repos` | `packages/server/src/routes/github.ts` |
| GET | `/api/notifications` | `packages/server/src/routes/notifications.ts` |
| POST | `/api/notifications/read-all` | `packages/server/src/routes/notifications.ts` |
| POST | `/api/notifications/:id/read` | `packages/server/src/routes/notifications.ts` |
| GET | `/api/push` | `packages/server/src/routes/push.ts` |
| POST | `/api/push/subscribe` | `packages/server/src/routes/push.ts` |
| POST | `/api/push/unsubscribe` | `packages/server/src/routes/push.ts` |
| PATCH | `/api/push/events` | `packages/server/src/routes/push.ts` |
| GET | `/api/admin/settings` | `packages/server/src/routes/account-settings.ts` |
| PATCH | `/api/admin/settings` | `packages/server/src/routes/account-settings.ts` |
| PUT | `/api/admin/secrets/:name` | `packages/server/src/routes/account-settings.ts` |
| DELETE | `/api/admin/secrets/:name` | `packages/server/src/routes/account-settings.ts` |
| GET | `/api/admin/profiles` | `packages/server/src/routes/account-settings.ts` |
| POST | `/api/admin/profiles` | `packages/server/src/routes/account-settings.ts` |
| DELETE | `/api/admin/profiles/:id` | `packages/server/src/routes/account-settings.ts` |
| GET | `/api/admin/users` | `packages/server/src/routes/account-settings.ts` |
| PATCH | `/api/admin/users/:id` | `packages/server/src/routes/account-settings.ts` |
| DELETE | `/api/admin/users/:id` | `packages/server/src/routes/account-settings.ts` |
| POST | `/api/admin/users/:id/reset-link` | `packages/server/src/routes/account-settings.ts` |
| POST | `/api/admin/invites` | `packages/server/src/routes/account-settings.ts` |
| GET | `/api/admin/invites` | `packages/server/src/routes/account-settings.ts` |
| DELETE | `/api/admin/invites/:id` | `packages/server/src/routes/account-settings.ts` |
| PUT | `/api/admin/speech` | `packages/server/src/routes/account-settings.ts` |
| GET | `/api/settings/secrets` | `packages/server/src/routes/account-settings.ts` |
| PUT | `/api/settings/secrets/:name` | `packages/server/src/routes/account-settings.ts` |
| DELETE | `/api/settings/secrets/:name` | `packages/server/src/routes/account-settings.ts` |
| GET | `/api/settings/speech` | `packages/server/src/routes/account-settings.ts` |
| PUT | `/api/settings/speech` | `packages/server/src/routes/account-settings.ts` |
| GET | `/api/settings/always-on` | `packages/server/src/routes/always-on-settings.ts` |
| PATCH | `/api/settings/always-on` | `packages/server/src/routes/always-on-settings.ts` |
| GET | `/api/settings/appearance` | `packages/server/src/routes/appearance.ts` |
| PATCH | `/api/settings/appearance` | `packages/server/src/routes/appearance.ts` |
| GET | `/api/agent-messages` | `packages/server/src/routes/agent-messages.ts` |
| POST | `/api/agent-messages` | `packages/server/src/routes/agent-messages.ts` |
| PATCH | `/api/agent-messages/:id` | `packages/server/src/routes/agent-messages.ts` |
| GET | `/api/profiles` | `packages/server/src/routes/profiles.ts` |
| GET | `/api/tools` | `packages/server/src/routes/tools.ts` |
| GET | `/api/mcp/servers` | `packages/server/src/routes/mcp.ts` |
| GET | `/api/capabilities` | `packages/server/src/routes/transcription.ts` |
| POST | `/api/transcriptions` | `packages/server/src/routes/transcription.ts` |
| GET | `/api/cli` | `packages/server/src/routes/cli.ts` |
| POST | `/api/cli/:cli/install` | `packages/server/src/routes/cli.ts` |
| POST | `/api/cli/:cli/login` | `packages/server/src/routes/cli.ts` |
| GET | `/api/cli/:cli/login` | `packages/server/src/routes/cli.ts` |
| POST | `/api/cli/:cli/login/input` | `packages/server/src/routes/cli.ts` |
| DELETE | `/api/cli/:cli/login` | `packages/server/src/routes/cli.ts` |
| POST | `/internal/mcp/runs/:runId` | `packages/server/src/cli-mcp.ts` |
| GET | `/internal/mcp/runs/:runId` | `packages/server/src/cli-mcp.ts` |
| DELETE | `/internal/mcp/runs/:runId` | `packages/server/src/cli-mcp.ts` |

`GET` and `DELETE` on `/internal/mcp/runs/:runId` are registered and then answered 405 after the run token check. The CLI uses `POST` JSON-RPC (`initialize`, `ping`, `tools/list`, `tools/call`). Session cookies do not authenticate that path.

GitHub (`packages/server/src/routes/github.ts`): each user connects their own account. `PUT /api/github` (`{ token }`) asks GitHub's `GET /user` who the token belongs to, then stores the token as the user secret `github` (encrypted, never returned) and the account as `user_settings` `github.account`; `GET /api/github` returns `{ connected, account, webUrl }`; `DELETE` removes both. The generic `/api/settings/secrets/github` route refuses that name. `GET /api/github/repos?q=` lists the account's repositories. `POST /api/listeners/:id/github-hook` (`{ repo }`) creates the webhook on that repository for a `github` listener, with the listener's URL, secret, and events (`201`), or updates the repository's hook that already has that URL (`200`), so connecting again after changing events or rotating the secret does not add a second hook. A `github` listener (`kind: "github"`, `events` from `GITHUB_LISTENER_EVENTS` in `packages/core/src/github.ts`, default `issues.opened`) accepts only `X-Hub-Signature-256`; a delivery whose `<X-GitHub-Event>.<action>` is not in `events`, a `ping`, or an issue, comment, or pull request body carrying `GITHUB_AGENT_MARKER` is stored as `ignored` and starts no turn (`packages/server/src/github/webhook.ts`). The turn's user message starts with `[GitHub · …]` and holds a short summary (repository, number, title, URL, author, labels, body or comment) inside the untrusted-data frame.

Git and GitHub tools: `packages/server/src/github/git.ts` (`git_clone`, `git_init`, `git_status`, `git_diff`, `git_log`, `git_checkout`, `git_commit`, `git_pull`, `git_push`, capability `git`) and `packages/server/src/github/tools.ts` (`github_repo_list`, `github_issue_list`, `github_issue_read`, `github_issue_create`, `github_issue_update`, `github_issue_comment`, `github_pr_list`, `github_pr_read`, `github_pr_create`, capability `github`). Both act with the token of the user who owns the agent (`currentUserId`). Git runs on the host, outside the shell jail, so each repository's git directory lives at `<user root>/git/<agent>/<name>-<hash>.git`, outside the agent's directory, and is derived from the worktree path, never read from the worktree's `.git` file. Hooks, fsmonitor, external diff, textconv, system and global config are off, only the GitHub host's protocol is allowed, and the token is an `http.<host>/.extraHeader` in the child's environment. `git_push` never forces. Text the GitHub tools write gets `GITHUB_AGENT_MARKER` so a GitHub listener does not wake on it. Tests: `packages/server/test/github.test.ts` (fake GitHub API) and `packages/server/test/git-tools.test.ts` (local bare repository, skipped without `git`).

`GET /api/agents/:id/files?path=` lists one directory of the agent's workspace (`<user root>/agents/<agentId>`, not recursive) and `GET /api/agents/:id/files/content?path=` returns a UTF-8 text file from it. Both run the `file_list` and `file_read` tools with the agent's id, so the path jail and size caps are the agent's own; there is no write route (`packages/server/src/routes/workspace.ts`, tests in `packages/server/test/workspace-files.test.ts`).

Chat attachments: `POST /api/agents/:id/uploads?name=` takes the raw file body (up to `ATTACHMENT_MAX_BYTES` in `packages/core/src/attachments.ts`) and saves it as `uploads/<id>-<name>` in the agent's workspace. Images are always accepted; any other file needs `file_read` in the agent's allowlist (403 otherwise). `GET /api/agents/:id/uploads/:file` serves it back (raster images inline, everything else as a download, type from the extension). The client then sends a message whose text ends with the block `withAttachments` writes (`packages/core/src/attachments.ts`), so there is no message schema change. When the profile has vision, `loadAttachedImages` (`packages/server/src/runtime/attachments.ts`, wired as `loadImages` in `packages/server/src/app.ts`) turns the last few attached images into image parts in the agent loop (`withImages` in `packages/agent-runtime/src/loop.ts`). Attachments live in the chat owner's workspace, so in a group chat only the owner sees images. Tests: `packages/server/test/uploads.test.ts`, `packages/agent-runtime/test/images.test.ts`.

`PATCH /api/chats/:id/messages/:messageId` replaces the text of a user or assistant message. `DELETE` on the same path removes the message and, for an assistant message, the tool results of its calls; `?following=true` also removes every later message (`messagesToDelete` in `packages/server/src/routes/messages.ts`). Both return `409 chat_busy` while the chat's queue is running or has messages waiting. `POST /api/hooks/:listenerId` is outside the session. It checks the listener secret (`packages/server/src/listeners/verify.ts`). `GET` and `PATCH /api/settings/always-on` require an admin session (`packages/server/src/routes/always-on-settings.ts`). `GET` and `PATCH /api/settings/appearance` are per-user (`packages/server/src/routes/appearance.ts`). The accent is `neutral`, `blue`, `red`, `green`, `orange`, or `violet`, stored at `appearance.accent` in `user_settings`. `neutral` is the default and deletes the row. Agent create and update accept `title` (role label), `shape` (avatar silhouette), and `picture` (data URL or null). The scheduler starts from `packages/server/src/serve.ts` unless `createApp({ scheduler: false })`. Each tick reads `always_on.*` from the store (`packages/db/src/always-on-settings.ts`).

## Env vars

`loadConfig` in `packages/server/src/config.ts` reads: `BOTANICAL_GITHUB_API_URL`, `BOTANICAL_GITHUB_URL` (GitHub Enterprise hosts; defaults `https://api.github.com` and `https://github.com`), `BOTANICAL_DEPLOYMENT_MODE`, `BOTANICAL_BRAND_NAME`, `BOTANICAL_ENCRYPTION_KEY`, `DATABASE_URL`, `BOTANICAL_HOST`, `BOTANICAL_PORT`, `PORT`, `BOTANICAL_SESSION_TTL_SECONDS`, `BOTANICAL_COOKIE_SECURE`, `BOTANICAL_CORS_ORIGIN`, `BOTANICAL_TRUST_PROXY`, `BOTANICAL_MAX_BODY_BYTES`, `BOTANICAL_A2A_AUTORUN`, `BOTANICAL_PUBLIC_ORIGIN`, `BOTANICAL_VAPID_SUBJECT` (read in `app.ts`), `BOTANICAL_CLI_PROFILES`, `BOTANICAL_STT_MAX_BYTES`, `BOTANICAL_STT_MAX_SECONDS`, `BOTANICAL_STT_DISABLED`, `BOTANICAL_STT_PROVIDER`, `BOTANICAL_STT_BASE_URL`, `BOTANICAL_STT_MODEL`, `BOTANICAL_STT_API_KEY`, `OPENAI_API_KEY`. STT presets also read `OPENROUTER_API_KEY`, `XAI_API_KEY`, or `DASHSCOPE_API_KEY` by provider name.

Scheduler on/off, tick interval, background concurrency, and webhook body size are not env vars. They are `settings` keys `always_on.scheduler_enabled`, `always_on.scheduler_interval_ms`, `always_on.background_concurrency`, and `always_on.listener_max_bytes` (`packages/db/src/always-on-settings.ts`).

Profile documents are stored in the database. Provider keys are decrypted from `secrets` and passed into `packages/providers` (see [providers](providers.md)). `deploy/scripts/server-entrypoint.sh` warns when `BOTANICAL_ENCRYPTION_KEY` is unset and does not require a passcode.

| File | Also reads |
|------|------------|
| `packages/server/src/serve.ts` | `BOTANICAL_CLI_AUTO_INSTALL` |
| `packages/server/src/runtime/workspace.ts` | `BOTANICAL_WORKSPACE`, `BOTANICAL_WORKSPACE_ROOT` |
| `packages/server/src/cli-mcp.ts` | `BOTANICAL_INTERNAL_URL` |
| `packages/server/src/cli-install/service.ts` | `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` |

## Tests

`packages/server/test`. From that package: `bun test`. From the root, `bun run --cwd packages/server test`.

`packages/server/test/postgres-store.test.ts` and `packages/server/test/routines.postgres.test.ts` skip unless `BOTANICAL_TEST_DATABASE_URL` is set. A throwaway Postgres file is `packages/db/docker-compose.test.yml` (do not start it unless asked). Routine, listener, and cron unit tests are `packages/server/test/routines.test.ts`, `packages/server/test/listeners.test.ts`, and `packages/server/test/cron.test.ts`.

## Where to change X

- **Add an API route.** Add `router.add` in a file under `packages/server/src/routes`, export a `register*` function, and call it from `packages/server/src/app.ts`. Mirror the path on `packages/core/src/paths.ts` and `packages/core/src/client.ts` if the web client should call it.
- **Add a tool visible to the model.** Builtin file/shell/web contributors are registered in `packages/server/src/tools/catalog.ts`. Memory, agent admin, `notify_user`, and `send_agent_message` are registered in `packages/server/src/app.ts`.
- **Change a routine or webhook.** `packages/server/src/routes/routines.ts`, `packages/server/src/routes/listeners.ts`, `packages/server/src/routines`, `packages/server/src/listeners`, and `packages/server/src/runtime/jobs.ts`. The lease is `packages/db/src/run-lease.ts`.
- **Change auth.** `packages/server/src/routes/auth.ts`, `packages/server/src/auth/session.ts`, `packages/server/src/auth/password.ts`.
- **Change streaming.** `packages/server/src/routes/messages.ts` and `packages/server/src/streaming.ts`.
- **Change async chat (queue, batching, steering, events, stop).** `packages/server/src/runtime/chat-queue.ts` and `packages/server/src/routes/messages.ts`. Tests: `packages/server/test/chat-queue.test.ts`.
- **Change one chat per agent (finding or opening an agent's chat, where background turns land).** `packages/server/src/runtime/agent-chat.ts`, `packages/server/src/routes/chats.ts`, `runTurn` in `packages/server/src/runtime/chat-queue.ts`, `packages/server/src/runtime/jobs.ts`, and `runInboxTurn` in `packages/server/src/a2a/service.ts`. Tests: `packages/server/test/agent-chat.test.ts`.
- **Change clear or compact.** `packages/server/src/routes/messages.ts` and `streamChatReplies` in `packages/server/src/runtime/turn.ts`. The summary itself is `packages/agent-runtime/src/compaction.ts`.
- **Change group chats (members, who answers, handoffs).** `packages/server/src/runtime/group.ts`, `streamChatReplies` in `packages/server/src/runtime/turn.ts`, and `packages/server/src/routes/chats.ts`. Tests: `packages/server/test/group-chats.test.ts`.
- **Change the GitHub connection, git or GitHub tools, or GitHub listeners.** `packages/server/src/github`, `packages/server/src/routes/github.ts`, `packages/server/src/listeners/kinds.ts`, and the shared ids in `packages/core/src/github.ts`. Capabilities `git` and `github` map tool names in `packages/agent-runtime/src/permissions.ts`.
- **Add an env var the API reads.** `packages/server/src/config.ts` (or the specific module above), then `.env.example` and this page.
