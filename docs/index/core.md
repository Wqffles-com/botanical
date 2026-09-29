# Core

[Index](README.md)

Shared API types, response normalizers, and the HTTP client the web app uses. No UI and no database driver.

- Package: `@botanical/core`
- Entry: `packages/core/src/index.ts`
- Extra entry: `packages/core/src/deployment/index.ts` (`./deployment`)

## Files

| Path | Purpose |
|------|---------|
| `packages/core/src/client.ts` | `BotanicalClient` |
| `packages/core/src/mentions.ts` | `findMentions`, `mentionedAgents`, `activeMentionQuery` (chat `@Name` parsing, shared by server and composer) |
| `packages/core/src/paths.ts` | `API` path builders |
| `packages/core/src/types.ts` | Wire types (`Agent`, `Chat`, `Health`, `RoleRecord`, …) |
| `packages/core/src/normalize.ts` | Server JSON → those types |
| `packages/core/src/always.ts` | Normalizers for routines, listeners, notifications, and always-on settings |
| `packages/core/src/sse.ts` | `readChatStream`, `parseSseFrame`, `readSseMessages` (named frames for the chat events feed) |
| `packages/core/src/errors.ts` | `BotanicalApiError`, `requireProfileId` |
| `packages/core/src/agents.ts` | Color, icon, shape, and picture checks, `EXAMPLE_AGENTS` |
| `packages/core/src/appearance.ts` | Accent names and `appearance.accent` |
| `packages/core/src/deployment` | Mode, passcode, and billing hook types (not wired as the live API auth) |
| `packages/core/src/client.test.ts` | Client tests, colocated |
| `packages/core/src/server-contract.test.ts` | Health and me shape |
| `packages/core/src/a2a-client.test.ts` | Agent-message client |
| `packages/core/src/gates.test.ts` | Profile and agent id gates |
| `packages/core/src/sse.test.ts` | SSE parser |

The browser singleton is `packages/web/src/lib/api.ts`. Server components use `packages/web/src/lib/server-api.ts`.

## Exports

`BotanicalClient`, `API`, `readChatStream`, `readSseMessages`, `normalizeAgent`, `normalizeChat`, `normalizeMessage`, `normalizeMemory`, `normalizeRoleRecord`, `EXAMPLE_AGENTS`, `CLIENT_CONTRACT_VERSION`. Deployment entry: `loadDeploymentConfig`, `readDeploymentMode`, `verifySingleTenantPasscode`, `createBillingHooks`.

`API` in `packages/core/src/paths.ts` covers health, auth, profiles, tools, agents, roles, memories, chats, messages, agent-messages, routines, listeners, notifications, `/api/settings/always-on`, and `/api/settings/appearance`. `BotanicalClient.getAppearance` and `updateAppearance` read and write the signed-in user's accent. `queueMessage` posts with `async: true`, `chatEvents` reads `GET /api/chats/:id/events` as `ChatEvent`s, `stopChat` calls `POST /api/chats/:id/stop`, and `updateMessage` / `deleteMessage` call `PATCH` / `DELETE /api/chats/:id/messages/:messageId`. `streamMessage` still drives the streaming form. `Chat.memberIds` lists a group chat's other agents; `createChat` and `updateChat` send `memberIds`. `ChatMessage.agentId` is a reply's author, and the `status` chat event carries the `agentId` answering. Agent create and update send `title`, `shape`, and `picture` when those fields are set. It does not list CLI, MCP, capabilities, transcription, or `POST /api/hooks/:listenerId` (the public webhook is not called by `BotanicalClient`). CLI and MCP fetches live in `packages/web/src/lib/mvp-api.ts` and `packages/web/src/lib/cli-api.ts`.

## Env vars

`packages/core/src/deployment/config.ts` reads `BOTANICAL_DEPLOYMENT_MODE`, `BOTANICAL_PASSWORD`, `BOTANICAL_PASSWORD_HASH`, `BOTANICAL_TENANT_ID` when that helper is called. The running API uses `packages/server/src/config.ts` instead. The client takes a `baseUrl` argument and does not read the environment.

## Tests

Colocated under `packages/core/src`. Script: `bun test src`.

## Where to change X

- **Add a client method.** Path in `packages/core/src/paths.ts`, method on `BotanicalClient` in `packages/core/src/client.ts`, normalizer in `packages/core/src/normalize.ts` if the JSON shape needs it, and a test next to `packages/core/src/client.test.ts`.
- **Change a shared wire type.** `packages/core/src/types.ts`, then the web callers under `packages/web/src`.
- **Change SSE parsing.** `packages/core/src/sse.ts`, and `normalizeChatEvent` in `packages/core/src/normalize.ts` for the chat events feed.
