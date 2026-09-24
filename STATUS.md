# Botanical MVP integration status

Lead: m14 on `feat/v0-mvp`. Updated: 2026-09-24 (server-runtime merge).

## Merged PRs

- #17 agent icon, color, and example identities (`4bbbb62`). Gardener / Builder / Scout are seeded in the memory store. Postgres migration `0001_agent_identity` adds icon, color, and `default_profile_id`.
- #19 MCP servers connect on API boot (`31493f8`). `GET /api/mcp/servers` and `BOTANICAL_MCP_CONFIG` are wired. `packages/server` depends on `@botanical/mcp`.
- #18 agent-to-agent messaging (`bc56908`). Inbox routes, `send_agent_message`, and `BOTANICAL_A2A_AUTORUN` sit on the same app as identity and MCP. The memory store implements `agentMessages`. Postgres still attaches that in-memory inbox until #21 lands.
- #20 agent runtime and tool registry. `packages/agent-server` is removed. Chat turns run through `@botanical/agent-runtime`. `GET /api/tools` lists the registry. MCP still connects on boot and those tools are copied into the registry. `send_agent_message` is a built-in, offered when the agent's allowlist includes it. The mock profile calls it when the user text is `send_agent_message {…}`.

`bun test` passed for `@botanical/core`, `@botanical/server`, `@botanical/agent-runtime`, and `@botanical/mcp` after the runtime merge (153 tests). `@botanical/server` typecheck is green after adding the DOM lib so provider streams typecheck with the server.

## Open PRs into `feat/v0-mvp`

- #21 Persist the HTTP store in Postgres (`feat/mvp-postgres`).
- #22 Next.js App Router + shadcn foundation (`feat/mvp-next-foundation`).
- #23 Real model providers (`feat/mvp-providers`).
- #24 Built-in file, shell, web, and agent-message tools (`feat/mvp-tools`).
- #25 MVP Compose stack (`feat/mvp-devops`).
- #26 Playwright e2e (`feat/mvp-e2e`).
- #27 Next.js chat UI (`feat/mvp-chat-ui`).

Still expected, not open yet: `feat/mvp-agent-identity-ui`, `feat/mvp-pages-ui`.

Merge order from here: postgres, next-foundation, providers, tools, then UI (identity, chat, pages), devops, e2e.

## What works

- Passcode auth and the in-memory store.
- Agents have name, Lucide icon, and color. Three example agents are seeded.
- Chat turns go through the agent runtime. The mock profile calls `file_list` when it is allowlisted and can call `send_agent_message` the same way. A missing provider key returns `missing_api_key` and still stores the user message.
- A2A inbox API. Autorun is off unless `BOTANICAL_A2A_AUTORUN=true`.
- MCP config loads on boot. `GET /api/mcp/servers` reports status. Connected tools are also on `GET /api/tools`.
- Compose project `botanical` is still healthy on web `8080`, server `8787`, postgres `5432`. It has not been restarted.

## What is missing for the MVP

- Postgres is not the live store. #21 adds `createStore` and boot migrations. Until then a set `DATABASE_URL` still fails closed or attaches an in-memory inbox.
- `packages/web` is still Vite. Next.js + shadcn is #22, chat UI is #27, identity UI and pages UI are not open yet.
- Shell and web tool packages are dependencies. They register only when they export `createToolContributor` (#24).
- No `packages/e2e` on this branch yet. The `botanical-mvp` stack (web `3000`, server `8788`, postgres `5433`) is not running.

## Typecheck baseline

`@botanical/server` typecheck passes. These packages were already red before the MVP pull requests (config gaps, not this merge):

- `@botanical/core` — `src/deployment/*` imports `.ts` paths and Node globals, but `tsconfig.json` sets `"types": []` and does not allow `.ts` import extensions.
- `@botanical/agent-runtime` — `tsconfig` lib is ES2022 only, so `AbortSignal`, `crypto`, timers, and `bun:test` are missing. `packages/agent-server` is gone.
- `@botanical/tools-web` — `RequestInit.cache` is not in the ES2022 lib.
- `@botanical/tools-shell` — `ChildProcess.once` is missing without Node types.

## Next

Merge #21 (Postgres), then #22 (Next.js foundation). UI, providers, tools, devops, and e2e follow.
