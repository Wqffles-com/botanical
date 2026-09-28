# Web

[Index](README.md)

Next.js App Router client. Monochrome shadcn UI from [`@botanical/ui`](ui.md): primitives are imported as `@botanical/ui/components/<name>`, and `packages/web/src/app/globals.css` imports Tailwind, then `@botanical/ui/styles.css`, then app-only rules (chat stream dots). `packages/web/components.json` points the shadcn CLI's `ui` and `utils` aliases at the package.

- Package: `@botanical/web`
- App entry: `packages/web/src/app`
- Config: `packages/web/next.config.ts`
- Dev server: script `dev` is `next dev --port 3101` (compose and the release zip serve the production build on port 3000)
- API client: `packages/web/src/lib/api.ts` (`BotanicalClient` from `@botanical/core`, base URL empty so `/api` stays same-origin)

`packages/web/next.config.ts` rewrites `/api/:path*` to `BOTANICAL_API_URL` (default `http://127.0.0.1:8787`) and disables response compression so SSE is not buffered.

## Routes

There is no `middleware.ts`. `packages/web/src/proxy.ts` is the auth gate: public path `/login`; everything else needs `GET /api/auth/me`. `/login` signs up or signs in with email and password (`packages/web/src/app/login/page.tsx`).

| URL | File |
|-----|------|
| `/` | `packages/web/src/app/(app)/page.tsx` (redirects to the first agent or `/agents/new`) |
| `/login` | `packages/web/src/app/login/page.tsx` |
| `/agents` | `packages/web/src/app/(app)/agents/page.tsx` |
| `/agents/new` | `packages/web/src/app/(app)/agents/new/page.tsx` |
| `/agents/[id]` | `packages/web/src/app/(app)/agents/[id]/page.tsx` |
| `/chats/new` | `packages/web/src/app/(app)/chats/new/page.tsx` |
| `/chats/[id]` | `packages/web/src/app/(app)/chats/[id]/page.tsx` |
| `/inbox` | `packages/web/src/app/(app)/inbox/page.tsx` |
| `/routines` | `packages/web/src/app/(app)/routines/page.tsx` |
| `/listeners` | `packages/web/src/app/(app)/listeners/page.tsx` |
| `/settings` | `packages/web/src/app/(app)/settings/page.tsx` |

Layouts: `packages/web/src/app/layout.tsx` (root, fonts, `Providers`) and `packages/web/src/app/(app)/layout.tsx` (`AppShell`).

## UI map

| Path | Purpose |
|------|---------|
| `packages/web/src/components/app-shell.tsx` | Authenticated shell: sidebar, header with breadcrumb and notification bell |
| `packages/web/src/components/app-sidebar.tsx` | Sidebar: new chat, search, workspace nav, agents, recent chats, user menu |
| `packages/web/src/components/app-breadcrumbs.tsx` | Header breadcrumb derived from the route and workspace names |
| `packages/web/src/components/command-menu.tsx` | ⌘K palette: agents, chats, pages, theme |
| `packages/web/src/components/nav-user.tsx` | Sidebar footer account menu: settings, theme (light, dark, system), sign out |
| `packages/web/src/hooks/use-sign-out.ts` | Logout and redirect to `/login` |
| `packages/web/src/components/workspace-provider.tsx` | Agents, chats, profiles in client state |
| `packages/web/src/components/agents` | Agent list and editor (name, title, description, icon, shape, color, picture, default model) |
| `packages/web/src/components/agent-avatar.tsx` | Shape or custom picture for a bot mark |
| `packages/web/src/components/search-input.tsx` | Outline search field shared by the agents list and new-chat agent filter |
| `packages/web/src/lib/accent.ts` | Accent names, swatches, and local cache |
| `packages/web/src/lib/agent-picture.ts` | Browser resize of an uploaded avatar |
| `packages/web/src/components/chat` | Thread, composer, dictation, tool-call cards, new-chat form (pre-selects the agent's default model) |
| `packages/web/src/components/inbox/inbox-view.tsx` | Agent inbox |
| `packages/web/src/components/routines` | Routine list and editor (`packages/web/src/lib/schedule.ts` humanizes cron) |
| `packages/web/src/components/listeners` | Listener list and editor |
| `packages/web/src/components/notifications/notification-bell.tsx` | Unread badge in `packages/web/src/components/app-shell.tsx` |
| `packages/web/src/components/settings/settings-view.tsx` | Settings tabs (a select below `sm`) |
| `packages/web/src/components/settings/admin-panel.tsx` | Admin signup mode, global keys, and invites |
| `packages/web/src/components/settings/background-work-card.tsx` | Always-on scheduler and webhook limits on the general tab |
| `packages/web/src/hooks/use-chat-thread.ts` | Thread loading and stream |
| `packages/web/src/lib/mvp-api.ts` | Profiles, tools, MCP, settings fetches outside `API` |
| `packages/web/src/lib/cli-api.ts` | `/api/cli` install and login |
| `packages/web/src/lib/agent-api.ts` | Agent helpers |
| `packages/web/src/lib/chat-stream.ts` | Browser SSE parse |
| `packages/web/src/lib/server-api.ts` | RSC client (forwards cookies) |

Settings is one page. Tabs in `packages/web/src/components/settings/settings-view.tsx` (`?tab=`): `general` (accent, deployment, background work, provider key flags, tool list, MCP snapshot), `profiles`, `memory`, `roles`, `cli`. The accent picker is `packages/web/src/components/settings/accent-card.tsx`. `packages/web/src/components/accent-provider.tsx` loads `GET /api/settings/appearance` and sets `data-accent` on the document. Tokens live in `packages/ui/src/styles.css`: a non-neutral accent recolors `--primary`, `--ring`, and the active sidebar mark in light and dark. Page, borders, and status colors (`--destructive`, `--success`, `--warning`, `--info`) stay put. The theme defaults to the OS setting (`packages/web/src/components/theme-provider.tsx`). Panels: `packages/web/src/components/settings/profiles-panel.tsx`, `memory-panel.tsx`, `roles-panel.tsx`, `cli-panel.tsx`, `deployment-badge.tsx`, `background-work-card.tsx`. Sidebar links for inbox, routines, and listeners are in `packages/web/src/components/app-sidebar.tsx`. Sign out lives in the sidebar user menu.

## Env vars

| File | Name |
|------|------|
| `packages/web/next.config.ts` | `BOTANICAL_API_URL` (baked into production rewrites) |
| `packages/web/src/proxy.ts` | `BOTANICAL_API_URL` |
| `packages/web/src/lib/server-api.ts` | `BOTANICAL_API_URL` |

The browser bundle does not read provider keys.

## Tests

Colocated `*.test.ts` under `packages/web/src`. Script: `bun test src`. `typecheck` is `tsc --noEmit`. `build` is `next build`. `lint` is `eslint` (CI does not run it).

## Where to change X

- **Add a page.** Add `page.tsx` under `packages/web/src/app`. Authenticated pages go under `packages/web/src/app/(app)`. If it should stay public, add the path to `PUBLIC_PATHS` in `packages/web/src/proxy.ts`.
- **Add a settings tab.** Extend `SettingsTab` in `packages/web/src/components/settings/settings-view.tsx` and add a panel under `packages/web/src/components/settings`.
- **Call a new API.** Prefer `packages/core/src/client.ts`. For routes that client does not wrap, follow `packages/web/src/lib/mvp-api.ts`.
- **Change chat streaming.** `packages/web/src/hooks/use-chat-thread.ts` and `packages/web/src/lib/chat-stream.ts`.
- **Change the shell or theme.** `packages/web/src/components/app-shell.tsx`, `packages/ui/src/styles.css`, `packages/ui/src/components`.
