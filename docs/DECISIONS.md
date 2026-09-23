# Botanical — Decision Log

Authoritative product decisions. When these conflict with earlier brainstorm notes, **this file wins**. Later entries in this file refine earlier ones.

**Latest refinement (2026-09-23):** Botanical is **open-source (self-hostable)** and a **hosted SaaS** on the same codebase. See the business model entry at the end of this file.

---

## 2026-09-23 — Charlie interview with Ash (orchestrator)

**Status:** LOCKED for v0 planning.  
**Source:** Charlie × Ash interview (orchestrator session).  
**Effect:** Supersedes conflicting earlier notes that pushed **local-first** and **CLI-as-MVP**. Those ideas remain useful history in [BRAINSTORM.md](./BRAINSTORM.md) where marked superseded; they are not the build plan.

### Locked decisions

1. **Audience** — Charlie as personal power user. Not teams-first or OSS-community-first yet. (Refined the same day: the product is MIT open-source and self-hostable, and also a hosted SaaS. Community growth is still not the v0 wedge.)
2. **Architecture** — **Not** local-first. Botanical **server** — self-hosted by the operator, or hosted by us — with clients connecting from elsewhere. Enables always-on cloud capabilities later.
3. **First client** — **Web** UI talking to that server.
4. **v0 MVP scope** — Streaming **chat + tools + MCP**. Always-on routines / schedulers are **post-v0**.
5. **Hosting** — Vendor undecided. Keep the server **portable / host-agnostic** (no hard lock to one cloud). Deployment **mode** is decided: self-host or our hosted SaaS, same code.
6. **Default model** — **None**. Force an explicit **profile** pick; no silent everyday default.
7. **Auth (web → server)** — **Password / passcode** for v0.
8. **Stack** — **TypeScript**; runtime **Bun or Deno**, chosen at scaffold time.
9. **Agents** — **Unlimited** user-defined agents; each customized with **functions (tools) + description/prompt**.
10. **Agent UX** — **One agent per chat** (each thread owned by one chosen agent).
11. **Agent collaboration** — Full **async agent-to-agent messaging** (teammate-style), even with one-agent-per-user-chat.
12. **Built-in tools (v0)** — **Web search/fetch**, **shell/code exec**, **file read/write**. Everything else (e.g. browser / computer use) is **opt-in configurable**, not core.
13. **Model API keys** — **Server-side only** (never supplied from the web client).
14. **Persistence** — **Postgres** for chats, agents, messages, and related state.

### Implications (short)

| Area | Was (early brainstorm) | Now (locked) |
|------|------------------------|--------------|
| Deployment | Local-first CLI on user machine | Server + remote clients; self-host or hosted SaaS (same code) |
| MVP surface | CLI | Web UI |
| Persistence | SQLite / files | Postgres |
| Runtime | Node 20+ lean | Bun **or** Deno (pick at scaffold) |
| Keys | BYOK in client/env on machine | Server-held keys only |
| Agents | Implicit single-agent chat | Multi-agent model + A2A messaging |
| Default brain | Auto / preferred profile OK | Explicit profile pick required |

### Explicitly deferred (post-v0)

- Always-on routines / schedulers
- Teams / multi-tenant auth and billing (required later for hosted SaaS; not v0 — see business model entry)
- OSS-community growth as the primary go-to-market (the core **is** MIT and self-hostable; community-building is still not the v0 wedge)
- Browser / computer-use as **core** built-ins (opt-in only)
- Hosting vendor choice

### Related docs

- [VISION.md](./VISION.md) — product vision (aligned)
- [BRAINSTORM.md](./BRAINSTORM.md) — ideas; superseded bits marked
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system sketch (aligned)

---

## 2026-09-23 — Business model: open-source self-host and hosted SaaS

**Status:** LOCKED.  
**Source:** Product decision recorded 2026-09-23.  
**Effect:** Refines interview decision 1 (audience / OSS posture), decision 2 (where the server runs), decision 5 (hosting), and the deferred lines on multi-tenant productization and OSS-community growth. The **code is open-source and self-hostable now**, and Botanical is **also a SaaS**. v0 audience remains Charlie as a personal power user. Does **not** revive local-first or CLI-as-MVP. Interview decisions 3–4 and 6–14 still stand.

### Locked decision

15. **Business model** — Botanical is **open-source (self-hostable)** and also a **SaaS** (subscription on our hosted servers).

- **Same codebase.** Self-host and hosted are **deployment modes** (config / mode), not separate products or forks.
- Clients still talk to a **server**. Self-host means the operator runs that server. Hosted means we run it. Neither mode is local-first.
- Do **not** hard-code SaaS-only assumptions (our accounts, billing, our domain) into the core. A self-host operator runs the same server without those.
- Do **not** hard-code single-operator assumptions so deeply that hosted multi-tenant auth cannot be added later.

### Implications

| Area | Decision |
|------|----------|
| License | **MIT** stays for the OSS core |
| Deployment | Two modes on one codebase: **self-host** and **hosted** (SaaS) |
| Auth | v0 stays **password / passcode**. **Multi-tenant auth** comes later for hosted SaaS — leave a seam; do not build tenancy in v0 |
| Billing | **Deferred post-v0.** No subscriptions, metering product, or payment integration in v0 |
| Audience | v0 user is still Charlie. Others can self-host under MIT; OSS-community growth is not the v0 goal |
| Hosting vendor | Still **portable / host-agnostic**. “Our servers” is how the SaaS deployment is operated, not a cloud lock inside the core |

### Still deferred (post-v0)

- Billing / subscriptions for the hosted SaaS
- Multi-tenant auth and tenant isolation
- OSS-community growth as the primary go-to-market

### Related docs

- [VISION.md](./VISION.md) — product vision (aligned)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — deployment modes (aligned)
- [README.md](../README.md) — project overview (aligned)
