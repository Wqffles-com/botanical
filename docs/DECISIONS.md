# Botanical — Decision Log

Authoritative product decisions. When these conflict with earlier brainstorm notes, **this file wins**.

---

## 2026-09-23 — Charlie interview with Ash (orchestrator)

**Status:** LOCKED for v0 planning.  
**Source:** Charlie × Ash interview (orchestrator session).  
**Effect:** Supersedes conflicting earlier notes that pushed **local-first** and **CLI-as-MVP**. Those ideas remain useful history in [BRAINSTORM.md](./BRAINSTORM.md) where marked superseded; they are not the build plan.

### Locked decisions

1. **Audience** — Charlie as personal power user. Not teams-first or OSS-community-first yet.
2. **Architecture** — **Not** local-first. Personal hosted Botanical **server**; clients connect from elsewhere. Enables always-on cloud capabilities later.
3. **First client** — **Web** UI talking to that server.
4. **v0 MVP scope** — Streaming **chat + tools + MCP**. Always-on routines / schedulers are **post-v0**.
5. **Hosting** — Undecided. Keep the server **portable / host-agnostic** (no hard lock to one cloud).
6. **Default model** — **None**. Force an explicit **profile** pick; no silent everyday default.
7. **Auth (web → server)** — **Password / passcode** for v0.
8. **Stack** — **TypeScript**; runtime **Bun or Deno**, chosen at scaffold time. **Resolved:** **Bun**. See [Scaffold: Bun](#2026-09-23--scaffold-bun).
9. **Agents** — **Unlimited** user-defined agents; each customized with **functions (tools) + description/prompt**.
10. **Agent UX** — **One agent per chat** (each thread owned by one chosen agent).
11. **Agent collaboration** — Full **async agent-to-agent messaging** (teammate-style), even with one-agent-per-user-chat.
12. **Built-in tools (v0)** — **Web search/fetch**, **shell/code exec**, **file read/write**. Everything else (e.g. browser / computer use) is **opt-in configurable**, not core.
13. **Model API keys** — **Server-side only** (never supplied from the web client).
14. **Persistence** — **Postgres** for chats, agents, messages, and related state.

### Implications (short)

| Area | Was (early brainstorm) | Now (locked) |
|------|------------------------|--------------|
| Deployment | Local-first CLI on user machine | Personal hosted server + remote clients |
| MVP surface | CLI | Web UI |
| Persistence | SQLite / files | Postgres |
| Runtime | Node 20+ lean | **Bun** (picked at scaffold) |
| Keys | BYOK in client/env on machine | Server-held keys only |
| Agents | Implicit single-agent chat | Multi-agent model + A2A messaging |
| Default brain | Auto / preferred profile OK | Explicit profile pick required |

### Explicitly deferred (post-v0)

- Always-on routines / schedulers
- Teams / multi-tenant productization
- OSS-first community growth as primary goal
- Browser / computer-use as **core** built-ins (opt-in only)
- Hosting vendor choice

### Related docs

- [VISION.md](./VISION.md) — product vision (aligned)
- [BRAINSTORM.md](./BRAINSTORM.md) — ideas; superseded bits marked
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system sketch (aligned)

---

## 2026-09-23 — Open-source self-host and SaaS

**Status:** LOCKED.  
**Source:** Product update 2026-09-23 (shared agent context).

Botanical is **open-source (self-host)** and **SaaS** (paid hosted on our servers). Same codebase. `BOTANICAL_MODE=self-host|saas` selects the mode (default `self-host`). Do not hard-code SaaS-only assumptions. The OSS core stays MIT.

---

## 2026-09-23 — Scaffold: Bun

**Status:** LOCKED for v0.  
**Source:** Foundation scaffold (`feat/v0-scaffold`). Resolves interview decision 8.

### Locked

- **Runtime is Bun.** It installs fast, runs TypeScript directly, and `Bun.serve` is enough for the HTTP server.
- **Workspaces:** Bun workspaces under `packages/*`.
- **Web:** Vite + React + TypeScript, run with Bun. The dev server proxies `/api/*` to the Botanical server.
- **Reference deploy:** root `docker-compose.yml` (Postgres 16 + a server image). The server is portable; Compose is the reference, not a cloud lock-in.
- **Layout** (use these paths; do not add a parallel `apps/` or `packages/adapters` tree):
  - `packages/server` — HTTP API, auth, orchestration, A2A
  - `packages/web` — web client
  - `packages/core` — shared types and agent config schemas
  - `packages/providers` — model provider adapters (the architecture sketch called this `adapters`)
  - `packages/tools` — built-in tools
  - `packages/db` — Postgres schema and migrations
- Shared compiler options live in `tsconfig.base.json`. Root scripts: `dev`, `build`, `typecheck`.

The scaffold compiles and serves `GET /health`. It does not implement chat, tools, MCP, auth, or migrations.
