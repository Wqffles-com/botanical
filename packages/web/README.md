# @botanical/web

Next.js App Router + TypeScript + Tailwind v4 + shadcn/ui client for Botanical.

The shell owns routing, auth, the sidebar, and agent identity primitives. Chat, identity pickers, inbox, and settings tabs are filled in by later packages.

## Run

```bash
cd packages/web
bun run dev
```

Dev server: http://127.0.0.1:3101

`/api/*` is rewritten to `BOTANICAL_API_URL` (default `http://localhost:8787`) so session cookies stay same-origin. Point it at the MVP server with:

```bash
BOTANICAL_API_URL=http://localhost:8788 bun run dev
```

## Routes

| Path | Notes |
|------|--------|
| `/login` | Passcode form (`POST /api/auth/login`) |
| `/` | Redirects to the first agent, or `/agents/new` |
| `/agents`, `/agents/new`, `/agents/[id]` | Agent list / create / detail |
| `/chats/[id]` | Chat shell (composer gated on `profileId`) |
| `/inbox` | A2A inbox shell |
| `/settings` | Profiles / Tools / MCP / Deployment tabs |

Unauthenticated requests (`GET /api/auth/me` → 401) redirect to `/login`.

## Shared UI for other packages

- `src/components/agent-avatar.tsx` — lucide icon in a colored rounded square
- `src/lib/agent-colors.ts` — `AgentColor` palette (`red`…`gray`, default `green`)
- `src/lib/agent-icons.ts` — lucide registry (default `Bot`)
- `src/lib/api.ts` — browser `BotanicalClient` (base URL `""`)
- `src/lib/server-api.ts` — RSC client that forwards cookies

## Scripts

```bash
bun run typecheck
bun test src
bun run build
```
