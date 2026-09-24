# @botanical/web

Next.js App Router + shadcn/ui client for Botanical.

Chat UI in this package:

- `/chats/new` — pick exactly one agent and a **required** model profile (no default). Start stays disabled until both are chosen.
- `/chats/[id]` — one agent per thread, SSE streaming via `@botanical/core`, markdown with code blocks, collapsible tool call/result cards, stop button.
- Sidebar — chats grouped by owning agent, with rename and delete.
- Composer — Enter sends, Shift+Enter inserts a newline. Disabled until a profile is picked. `profile_required` is shown as a banner.

`BOTANICAL_API_URL` (default `http://localhost:8787`) is rewritten from `/api/*` so cookies stay same-origin.

```bash
cd packages/web
bun install
bun run dev        # http://127.0.0.1:3104
bun run test
bun run typecheck
```
