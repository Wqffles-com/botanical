# @botanical/web

Vite + React client for Botanical v0 chat.

The screen flow:

1. **Passcode** unlocks the server (`POST /auth/login`). A bearer token is stored in `localStorage` under `botanical.session.v1` and sent as `Authorization`. Cookie sessions work too (`credentials: "include"`). Reload calls `GET /auth/me` and restores the shell. Logout clears the saved token.
2. **New chat** asks for exactly one agent (radio) and one model profile. The profile control starts empty — Botanical does not pre-select a model. Start stays disabled until both are chosen.
3. **Thread** streams `POST /chats/:id/messages`. The composer stays shut until that chat has an explicit profile. The agent is fixed for the life of the chat.

The HTTP contract lives in [`packages/core`](../core/README.md). This package only renders it.

## Run

```bash
cd packages/core && bun install
cd ../web && bun install
bun run dev
```

The dev server listens on `http://127.0.0.1:5173` and proxies `/api/*` to `BOTANICAL_SERVER_URL` (default `http://127.0.0.1:8787`). Paths stay under `/api`, matching the v0 server. Set `VITE_API_BASE` to an absolute origin to skip the proxy (`http://127.0.0.1:8787`).

`feat/v0-web-design` owns the Tailwind shell (login, profile gate, agents, chats, settings badge). This package wires the same flows against `@botanical/core` and borrows that branch's dark leaf palette. Prefer its components over `bc-*` styles when the branches merge, and keep `src/state` plus the core client.

```bash
bun run test
bun run typecheck
bun run build
```

## Design system

Layout and color sit in `src/styles/tokens.css` and `src/styles/app.css` under the `bc-*` class names. If `feat/v0-web-design` lands a design system, replace those tokens and keep `src/state` plus `@botanical/core` as the API wiring. Screens match the v0 shell: login, profile picker, agent list/editor, chat list, streaming thread, and a self-host / hosted badge.
