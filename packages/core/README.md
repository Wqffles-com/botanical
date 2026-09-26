# @botanical/core

Shared types and the **v0 web client contract** for the Botanical server.

The web app (`packages/web`) talks only through `BotanicalClient`. Routes below are what that client calls. A server stub can implement them in any order; response envelopes documented here are accepted so snake_case database rows still render.

`CLIENT_CONTRACT_VERSION` is `"1"`.

## Auth

Password / passcode. The client sends JSON:

```json
{ "password": "the-passcode" }
```

`POST /api/auth/login` → `200`

```json
{ "token": "<bearer>", "tokenType": "Bearer", "expiresAt": "2026-10-07T00:00:00.000Z", "operator": { "id": "operator" } }
```

The same token is set as the `HttpOnly` cookie `botanical_session`. Logout must send a JSON body (`{}`); an empty body is rejected.

- When `token` is present, later requests send `Authorization: Bearer <token>` and the browser stores it in `localStorage` (`botanical.session.v1`) until `expiresAt`.
- The client always uses `credentials: "include"`, so the cookie works with or without the bearer token.
- Deployment mode comes from `deploymentMode` on `GET /api/auth/me` or `GET /api/health` (`SELF_HOST` or `SAAS`). `brand.name` is display-only.

`POST /api/auth/logout` → `204`. Clears that session's cookie.

`GET /api/auth/me` → `200` with `operator`, `deploymentMode`, `brand`, and `session`, or `401`.

`GET /api/health` → `200 { "ok": true, "deploymentMode": "SELF_HOST", "brand": { "name": "Botanical" }, "version": "0.1.0" }`. Public.

## Profiles, agents, chats

There is **no default model profile**. `createChat` and `streamMessage` throw `ProfileRequiredError` before fetching when `profileId` is blank. The server should answer `400` if a caller skips that check.

A chat has **one** `agentId` (string, not a list).

| Method | Path | Body / result |
|--------|------|----------------|
| `GET` | `/api/profiles` | `{ profiles, defaultProfileId: null }` |
| `GET` | `/api/agents` | `{ agents }` |
| `POST` | `/api/agents` | `{ name, icon?, color?, description?, prompt, tools?, defaultProfileId? }` — `prompt` is required. `systemPrompt` and `toolIds` are accepted aliases. `icon` defaults to `Bot`, `color` to `green`. |
| `GET` | `/api/agents/:id` | `{ agent }` |
| `PATCH` | `/api/agents/:id` | partial agent |
| `DELETE` | `/api/agents/:id` | `204` |
| `GET` | `/api/chats` | `{ chats }` |
| `POST` | `/api/chats` | `{ agentId, profileId, title? }` → `{ chat }` |
| `PATCH` | `/api/chats/:id` | optional. The v0 server has no such route; `404` / `405` / `501` keeps the profile in memory |
| `GET` | `/api/chats/:id/messages` | `{ messages }` |
| `POST` | `/api/chats/:id/messages` | `{ content, profileId, stream: true }` → SSE, or a JSON turn |

List responses may be a bare array or `{ profiles|agents|chats|messages|items|data: [] }`.

Objects may be bare or wrapped as `{ profile|agent|chat|message|data: {} }`.

The client accepts camelCase and snake_case on **responses** (`profile_id`, `system_prompt`, `tool_ids`, `default_profile_id`, `created_at`). Requests use camelCase.

Agent identity: `name` (1–40 characters), `icon` (Lucide name, default `Bot`), `color` (`red` `orange` `amber` `green` `teal` `cyan` `blue` `violet` `pink` `gray`, default `green`), `description`, `prompt`, `tools` (tool ids), and optional `defaultProfileId`. `defaultProfileId` is only a suggestion. Chats still require an explicit profile. `systemPrompt` is the same string as `prompt`; `toolIds` is the same list as `tools`. Missing or unknown `icon` / `color` on a response normalize to `Bot` / `green`.

### Shapes

```ts
interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  description?: string | null;
}

interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Chat {
  id: string;
  agentId: string;
  profileId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  toolCalls?: { id: string; name: string; arguments: unknown }[];
}
```

## Streaming aliases

Besides the server frames below, the parser accepts NDJSON, a single JSON assistant message, `event: message-start`, `tool-call`, `usage`, `error`, `text.delta`, `finish`, and `data: [DONE]`. `401` / `403` clear the saved session and return the UI to the passcode screen.

## Server stream and base URL

`BotanicalClient` calls the `/api/...` paths above. Set `baseUrl` to an absolute origin when the page is not served from the same host. The web dev server proxies `/api` to `BOTANICAL_SERVER_URL` (default `http://127.0.0.1:8787`) and does not rewrite the prefix.

`GET /api/profiles` returns `{ profiles, defaultProfileId: null }`. The client lists `profiles` and never reads `defaultProfileId`.

`GET /api/health` and `GET /api/auth/me` carry `deploymentMode` (`SELF_HOST` | `SAAS`) and `brand.name`.

`POST /api/chats/:id/messages` with `stream: true` (or `Accept: text/event-stream`) emits:

```
event: message.created
data: {"message":{"id":"u1","role":"user","content":"Hello","chatId":"c1","createdAt":"..."}}

event: text-delta
data: {"text":"Hi"}

event: message.completed
data: {"message":{"id":"a1","role":"assistant","content":"Hi","chatId":"c1","createdAt":"..."}}

event: done
data: {}
```

`stream: false` returns `201 { userMessage, assistantMessage, profileId }`. Errors are `{ "error": { "code": "...", "message": "..." } }`.

There is no `PATCH /api/chats/:id` in the v0 route list. Sending a new `profileId` on the next message is how a chat switches profiles. `updateChat` treats `404`, `405`, and `501` as “keep the explicit profile locally.”
