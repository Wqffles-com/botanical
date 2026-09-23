# Botanical UI

Design notes for `packages/web` (v0 shell). This is the visual source of truth for the web client. Product decisions stay in [DECISIONS.md](./DECISIONS.md).

**Branch:** `feat/v0-web-design`  
**Stack:** Vite · React 19 · TypeScript · Tailwind v4 · React Router  
**API:** placeholders in `packages/web/src/lib/api.ts` — swap bodies, keep shapes.

---

## Intent

A calm, dense-enough **power-user chat** for a personal agent server. Grok-class: dark canvas, streaming thread, composer docked at the bottom, model control always visible. Original: botanical night-greenhouse, not a vendor clone.

Charlie is the v0 audience. The UI should feel like a tool he can live in for hours — not a marketing site and not a toy.

---

## Principles

1. **Quiet chrome, loud content.** Hairline borders, almost no drop shadows. Accent green is a signal, not a theme wash.
2. **Explicit brains.** No silent default model. A session cannot reach chat until a **profile** is picked. The active profile stays in the composer and thread header.
3. **One agent per chat.** New threads start with an agent picker. The owning agent is identity for the thread; profile switches change the model, not the agent.
4. **Density with air.** 14px UI, 14.5px messages, 32px-class rows. Tight lists, generous reading column (`max-width: 760px`).
5. **Server owns secrets.** The client never collects provider API keys. Settings in v0 is a **deployment badge** plus session controls.
6. **Same UI for self-host and SaaS.** Mode is a flag (`self-host` | `saas`). Do not special-case layouts.

---

## Voice

Short, precise, uncheery.

- Login subtitle: “Personal agent server. Any brain.”
- Profile gate: “Required. Botanical never silently picks a model.”
- Empty chat: “Nothing growing yet.”
- Avoid garden puns in body copy. The plant language lives in the mark, color, and empty-state title only.

---

## Color

Dark-first. Green undertone, not neon.

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#090c0a` | App background |
| `shell` | `#0d120f` | Rail + list pane |
| `panel` | `#121915` | Cards, composer, raised surfaces |
| `raised` | `#171f1b` | User bubbles, tool cards |
| `hover` | `#1c2620` | List selection |
| `line` | `#24302a` | Hairlines |
| `line-strong` | `#33443b` | Focused composer edge |
| `ink` | `#e7eee8` | Primary text |
| `mute` | `#8f9c93` | Secondary |
| `faint` | `#667269` | Meta, timestamps |
| `leaf` | `#8fca7a` | Primary action, streaming caret, selected |
| `leaf-ink` | `#10150f` | Text on leaf buttons |
| `seed` | `#d4b07a` | Mid cost, A2A unread, SaaS badge |
| `rose` | `#e08b7a` | Danger, high cost |
| `sky` | `#7eb0c4` | Info / Root agent |
| `lilac` | `#c4a0d4` | Clerk agent |

**Accent discipline:** `leaf` on primary buttons, active nav, selected profile, streaming caret. One accent per view.

---

## Type

| Role | Face | Notes |
|---|---|---|
| Display / wordmark | **Instrument Serif** | Login title, empty states, screen titles |
| UI + messages | **IBM Plex Sans** | 14px UI, 14.5px thread, 13px lists |
| Code, models, ids | **IBM Plex Mono** | Tool args, profile model, settings meta |

Tracking on serif titles is tight. No all-caps except 11px badges.

---

## Layout

```
┌────┬──────────────┬─────────────────────────────┐
│ 56 │ 272          │  flex                       │
│rail│ list pane    │  thread / editor / settings │
│    │ chats/agents │  header 48px                │
│    │              │  reading col 760            │
│    │              │  composer                   │
└────┴──────────────┴─────────────────────────────┘
```

- **Rail:** logo, Chats, Agents, Settings, deployment glyph.
- **List pane:** search + primary action, dense rows, agent avatar.
- **< md:** rail becomes a top bar; list pane is a drawer.
- Settings has no list pane.

---

## Screens

### 1. Login (`/login`)

Centered passcode. Vine watermark + leaf orb. Deployment badge under the form (public meta). Placeholder auth accepts any passcode of 4+ characters.

### 2. Profile gate (`/pick-profile`)

**Blocking.** Cannot be dismissed. Card grid of profiles (name, cost tier, provider, model, tools/vision). Keys `1–9` select, Enter confirms. Stored on the session (`botanical.profileId`). Clearing it from Settings returns here.

### 3. Chat list + thread (`/chats`, `/chats/:id`)

- List: title, preview, relative time, owning-agent avatar, A2A unread pip.
- **New chat** (`⌘N`): modal, pick exactly one agent.
- Thread header: title + agent. Profile chip (model id) on the right.
- Empty thread: serif agent name, description, current profile.
- User messages: right, raised pill. Assistant: left, avatar + plaintext with fenced code and inline `code`.
- Tool calls: compact cards (`web-search`, `files`, `shell`, `mcp`) with running spinner → result row.
- Streaming: leaf caret on the growing assistant message; Stop replaces Send.
- Composer: profile chip (opens switcher), Enter send, Shift+Enter newline.

### 4. Agents (`/agents`, `/agents/:id`)

List + editor. Fields: name, description, color, system prompt (mono), tool chips (search, fetch, shell, files, MCP). Save / delete. Unlimited agents.

### 5. Settings (`/settings`)

Intentionally thin:

- **Deployment badge** — `Self-host` (house, mute) or `SaaS` (cloud, seed). From `GET` meta. Same codebase; client does not assume SaaS.
- Server name + version (read-only).
- Session: change profile (clears pick → gate), sign out.
- Explicit non-goals: API keys, MCP install, billing.

---

## Components (inventory)

| Path | What |
|---|---|
| `components/ui/Logo.tsx` | Sprout mark + serif wordmark |
| `components/ui/primitives.tsx` | Button, Input, Textarea, Field, Badge, Chip, Kbd, AgentAvatar |
| `components/ui/Modal.tsx` | Dialog + EmptyState |
| `components/layout/AppShell.tsx` | Rail + pane + main |
| `components/layout/WorkspaceLayout.tsx` | Panes, new-chat, inbox, profile switcher, `⌘N` / `⌘,` |
| `components/profiles/ProfilePicker.tsx` | Required-pick cards |
| `components/chat/*` | List, thread, composer, tool cards, inbox, new-chat |
| `components/agents/*` | List + editor |
| `components/settings/DeploymentBadge.tsx` | Self-host / SaaS |

Keep these. The chat-wiring agent should replace `src/lib/api.ts` bodies, not restyle.

---

## Motion

- `fade-up` 280ms on login card and modals.
- Streaming caret: `scaleY` pulse, leaf color.
- Tool cards: spinner while `running`.
- No page-level parallax. No bounce.

---

## Keyboard

| Shortcut | Action |
|---|---|
| `⌘N` / `Ctrl+N` | New chat (agent picker) |
| `⌘,` / `Ctrl+,` | Settings |
| `1–9` then Enter | Profile gate |
| Enter | Send |
| Shift+Enter | Newline |
| Esc | Close modal |

---

## Placeholder API

`src/lib/api.ts` is the client contract. Event union matches `docs/ARCHITECTURE.md`:

```ts
type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: unknown }
  | { type: 'tool-result'; id: string; result: string; status: 'done' | 'error' }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done' }
```

Vite already proxies `/api` → `http://127.0.0.1:3000`.

When the server lands:

1. `login` → `POST /api/auth/login` `{ passcode }` → `{ token }`
2. `getMeta` → `GET /api/meta` `{ mode, version, serverName }`
3. `listProfiles` / agents / chats — REST as the server defines
4. `streamMessage` → SSE or fetch stream of `ChatEvent`
5. Never send provider keys from the browser

Mock data lives in `src/lib/store.ts` (Greenhouse, Root, Forager, Clerk; Fast / Reason / Grok / Router / Local).

---

## A11y (v0 bar)

- `:focus-visible` leaf ring on all controls.
- Icon-only buttons have `aria-label`.
- Dialogs: `role="dialog"`, Esc to close, labeled title.
- Passcode field is a real `<label>`.
- Color is not the only state signal (icons + text on badges).

---

## What not to do in follow-up PRs

- Do not introduce a default profile “for convenience.”
- Do not put API key fields in Settings.
- Do not restyle tokens without updating this doc.
- Do not add a light theme until someone asks — v0 is dark-first.
- Do not merge A2A messages into the user thread; they stay in the teammate inbox.

---

## Run

```bash
cd packages/web
bun install
bun dev          # http://localhost:5173
bun run typecheck
bun run build
```
