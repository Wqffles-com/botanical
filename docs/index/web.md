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
| `/` | `packages/web/src/app/(app)/page.tsx` (redirects to the first agent's chat or `/agents/new`) |
| `/login` | `packages/web/src/app/login/page.tsx` |
| `/agents` | `packages/web/src/app/(app)/agents/page.tsx` |
| `/agents/new` | `packages/web/src/app/(app)/agents/new/page.tsx` (page fallback for the new-agent dialog) |
| `/agents/[id]` | `packages/web/src/app/(app)/agents/[id]/page.tsx` (agent settings as a page; in the app they open as a dialog, see `app-dialogs.tsx`) |
| `/agents/[id]/chat` | `packages/web/src/app/(app)/agents/[id]/chat/page.tsx` (opens the agent's one chat; creates it on the agent's default profile, or asks for a profile) |
| `/chats/new` | `packages/web/src/app/(app)/chats/new/page.tsx` |
| `/chats/[id]` | `packages/web/src/app/(app)/chats/[id]/page.tsx` |
| `/inbox` | `packages/web/src/app/(app)/inbox/page.tsx` |
| `/routines` | `packages/web/src/app/(app)/routines/page.tsx` |
| `/listeners` | `packages/web/src/app/(app)/listeners/page.tsx` |
| `/settings` | `packages/web/src/app/(app)/settings/page.tsx` (deep-link fallback; in the app, settings open as a dialog) |

Layouts: `packages/web/src/app/layout.tsx` (root, fonts, `Providers`) and `packages/web/src/app/(app)/layout.tsx` (`AppShell`).

## UI map

| Path | Purpose |
|------|---------|
| `packages/web/src/components/app-shell.tsx` | Authenticated shell: sidebar and one borderless header (sidebar toggle, breadcrumb, notification bell). `ShellHeader` lets a page portal a `center` control (it replaces the breadcrumb) and `actions` into that header, so a chat never stacks a second header |
| `packages/web/src/components/app-dialogs.tsx` | `AppDialogsProvider` / `useAppDialogs()`: `openSettings(tab?)` shows settings in a dialog, `openAgent(id \| null)` shows an agent's settings or the new-agent form in a dialog |
| `packages/web/src/components/app-sidebar.tsx` | Sidebar: brand with round search and new-chat buttons, workspace nav, agents (avatar, name, title pill, description, last activity; each opens its chat), group chats (two-mark cluster, member names), and a footer with the account avatar, a Settings pill, and a theme toggle |
| `packages/web/src/components/app-breadcrumbs.tsx` | Header breadcrumb derived from the route and workspace names. Hidden on chats, where the agent pill takes the center |
| `packages/web/src/components/agent-stack.tsx` | Overlapping agent marks for group chats (header pill, empty state) |
| `packages/web/src/components/command-menu.tsx` | ⌘K palette: agents, chats, pages, theme. New agent and Settings open their dialogs |
| `packages/web/src/components/nav-user.tsx` | Round account avatar in the sidebar footer; its menu has settings (dialog), theme (light, dark, system), sign out |
| `packages/web/src/hooks/use-sign-out.ts` | Logout and redirect to `/login` |
| `packages/web/src/components/workspace-provider.tsx` | Agents, chats, profiles in client state |
| `packages/web/src/components/agents` | Agent list (cards open the agent settings dialog) and editor (name, title, description, icon, shape, color, picture, default model). `AgentForm` takes `layout="dialog"` and `onDone` for the dialog |
| `packages/web/src/components/agent-avatar.tsx` | Shape or custom picture for a bot mark |
| `packages/web/src/components/search-input.tsx` | Outline search field shared by the agents list and new-chat agent filter |
| `packages/web/src/lib/accent.ts` | Accent names, swatches, and local cache |
| `packages/web/src/lib/agent-picture.ts` | Browser resize of an uploaded avatar |
| `packages/web/src/components/chat` | Thread, composer (sending stays open while the agent works), dictation, `@` agent mention autocomplete in the composer, new-chat form (pre-selects the agent's default model, optional group members), agent pill in the middle of the shell header with a menu that opens the agent settings dialog (`chat-agent-header.tsx`), group members popover in the chat header (`chat-members-menu.tsx`), message actions (`message-actions.tsx`: copy, edit, retry, delete), agent mail rows (`inbox-message-card.tsx`), right side panel (`chat-side-panel.tsx`: Files, Memory, Details tabs) |
| `packages/web/src/components/inbox/inbox-view.tsx` | Agent inbox |
| `packages/web/src/components/routines` | Routine list and editor (`packages/web/src/lib/schedule.ts` humanizes cron) |
| `packages/web/src/components/listeners` | Listener list and editor |
| `packages/web/src/components/notifications/notification-bell.tsx` | Unread badge in `packages/web/src/components/app-shell.tsx` |
| `packages/web/src/components/settings/settings-view.tsx` | `SettingsPanels` (every section; `layout` `dialog` puts the tabs in a left rail, `page` on top; a select below `sm`) and `SettingsView` (the `/settings` page) |
| `packages/web/src/components/settings/admin-panel.tsx` | Admin signup mode, global keys, models per provider (known models from `GET /api/admin/profiles` `knownModels`, or a custom model id), and invites |
| `packages/web/src/components/settings/background-work-card.tsx` | Always-on scheduler and webhook limits on the general tab |
| `packages/web/src/hooks/use-chat-thread.ts` | Thread loading, queued sends, message edit, resend, retry, and delete, and the chat events feed (reconnects and refetches after a gap) |
| `packages/web/src/lib/chat-queue.ts` | Pending-bubble and message merge rules for the events feed |
| `packages/web/src/lib/chat-groups.ts` | `ownChat`, `agentChatHref` (an agent's one chat, or `/agents/[id]/chat` before it exists), `groupChats`, `agentDefaultProfileId` |
| `packages/web/src/components/chat/chat-actions-menu.tsx` | Chat header menu: compact the conversation, clear the chat |
| `packages/web/src/components/chat/compaction-divider.tsx` | Divider where a chat was compacted, with the summary on click |
| `packages/web/src/lib/chat-details.ts` | Details tab counts (messages, tool calls, tokens, context length) and workspace path helpers |
| `packages/web/src/lib/chat-members.ts` | Group chat helpers: member toggle, member cap, a reply's author |
| `packages/web/src/lib/inbox-message.ts` | Splits an agent-mail transcript row (`renderInbox` in agent-runtime) into sender, time, body, and forwarded mention |
| `packages/web/src/lib/mvp-api.ts` | Profiles, tools, MCP, settings fetches outside `API` |
| `packages/web/src/lib/cli-api.ts` | `/api/cli` install and login |
| `packages/web/src/lib/agent-api.ts` | Agent helpers |
| `packages/web/src/components/chat/profile-select.tsx` | Provider and model picker (composer, new chat, agent default model). The value is still one profile id |
| `packages/web/src/lib/profile-groups.ts` | Groups profiles by provider (API vendor or coding CLI) and labels each profile by its model |
| `packages/web/src/lib/chat-stream.ts` | Pair tool calls with results for the thread, tool result status. `presentThread` shows replies (`replyIds` from core) as messages and folds the rest of an agent's output into activity entries |
| `packages/web/src/components/chat/agent-activity.tsx` | An agent's notes between replies (text output and tool calls), collapsed |
| `packages/web/src/lib/server-api.ts` | RSC client (forwards cookies) |

Settings open as a dialog over the current page (`openSettings` in `packages/web/src/components/app-dialogs.tsx`, from the sidebar footer, the account menu, ⌘K, and in-app links). `/settings` renders the same panels as a page for deep links (`?tab=`). Tabs in `packages/web/src/components/settings/settings-view.tsx`: `general` (accent, deployment, background work, provider key flags, tool list, MCP snapshot), `profiles`, `memory`, `roles`, `cli`. The accent picker is `packages/web/src/components/settings/accent-card.tsx`. `packages/web/src/components/accent-provider.tsx` loads `GET /api/settings/appearance` and sets `data-accent` on the document. Tokens live in `packages/ui/src/styles.css`: a non-neutral accent recolors `--primary`, `--ring`, and the active sidebar mark in light and dark. Page, borders, and status colors (`--destructive`, `--success`, `--warning`, `--info`) stay put. The theme defaults to the OS setting (`packages/web/src/components/theme-provider.tsx`). Panels: `packages/web/src/components/settings/profiles-panel.tsx`, `memory-panel.tsx`, `roles-panel.tsx`, `cli-panel.tsx`, `deployment-badge.tsx`, `background-work-card.tsx`. Sidebar links for inbox, routines, and listeners are in `packages/web/src/components/app-sidebar.tsx`. Sign out lives in the sidebar user menu.

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
- **Add a settings tab.** Extend `SettingsTab` and `SETTINGS_TABS` (label and icon) in `packages/web/src/components/settings/settings-view.tsx` and add a panel under `packages/web/src/components/settings`. It shows in both the dialog and the page.
- **Open settings or an agent's settings from a new place.** Call `openSettings(tab)` or `openAgent(id)` from `useAppDialogs()` (`packages/web/src/components/app-dialogs.tsx`) instead of linking to `/settings` or `/agents/[id]`.
- **Put a control in the page header.** Render `ShellHeader` from `packages/web/src/components/app-shell.tsx` with `center` or `actions`.
- **Call a new API.** Prefer `packages/core/src/client.ts`. For routes that client does not wrap, follow `packages/web/src/lib/mvp-api.ts`.
- **Change chat sending or live updates.** `packages/web/src/hooks/use-chat-thread.ts` and `packages/web/src/lib/chat-queue.ts`.
- **Change how an agent's chat opens.** `packages/web/src/app/(app)/agents/[id]/chat/page.tsx`, `packages/web/src/lib/chat-groups.ts`, and the agent links in `packages/web/src/components/app-sidebar.tsx` and `packages/web/src/components/command-menu.tsx`. The new-chat form opens an agent's chat when no members are picked.
- **Change clear or compact in the UI.** `packages/web/src/components/chat/chat-actions-menu.tsx`, `packages/web/src/components/chat/compaction-divider.tsx`, and `clear` / `compact` in `packages/web/src/hooks/use-chat-thread.ts`.
- **Change group chats.** Members on the new-chat form (`packages/web/src/components/chat/new-chat-form.tsx`) and in the header (`packages/web/src/components/chat/chat-members-menu.tsx`), per-reply authors in `packages/web/src/components/chat/chat-thread.tsx`, and `setMembers` / `workingAgentId` in `packages/web/src/hooks/use-chat-thread.ts`.
- **Change how agent mail shows in a chat.** `packages/web/src/lib/inbox-message.ts` parses the row `renderInbox` (`packages/agent-runtime/src/inbox.ts`) writes; `packages/web/src/components/chat/inbox-message-card.tsx` renders it. Keep the two formats in step.
- **Change the provider and model picker.** Grouping and labels in `packages/web/src/lib/profile-groups.ts`, fields in `packages/web/src/components/chat/profile-select.tsx`. `GET /api/profiles` marks a CLI profile with no pinned model `defaultModel: true` (`packages/server/src/routes/profiles.ts`).
- **Change the chat side panel.** `packages/web/src/components/chat/chat-side-panel.tsx` (tabs), `packages/web/src/lib/chat-details.ts` (Details numbers), and `packages/web/src/app/(app)/chats/[id]/page.tsx` (header toggle; an inline column from `md` up, a sheet below; closed until opened, then remembered in `localStorage` `botanical.chatPanel`). Files read `GET /api/agents/:id/files`; Memory lists shared memories and the selected agent's own. In a group chat a select picks the agent.
- **Change message actions.** `packages/web/src/components/chat/message-actions.tsx`, the inline editor in `packages/web/src/components/chat/message-bubble.tsx`, and the handlers in `packages/web/src/hooks/use-chat-thread.ts`.
- **Change the shell or theme.** `packages/web/src/components/app-shell.tsx`, `packages/ui/src/styles.css`, `packages/ui/src/components`.
