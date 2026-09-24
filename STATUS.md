# Botanical MVP integration status

Lead: m14 on `feat/v0-mvp`. Updated: 2026-09-24 (server-runtime merge).

## Merged PRs

- #17 agent icon, color, and example identities (`4bbbb62`). Gardener / Builder / Scout are seeded in the memory store. Postgres migration `0001_agent_identity` adds icon, color, and `default_profile_id`.
- #19 MCP servers connect on API boot (`31493f8`). `GET /api/mcp/servers` and `BOTANICAL_MCP_CONFIG` are wired. `packages/server` depends on `@botanical/mcp`.
- #18 agent-to-agent messaging (`bc56908`). Inbox routes, `send_agent_message`, and `BOTANICAL_A2A_AUTORUN` sit on the same app as identity and MCP. The memory store implements `agentMessages`. Postgres still attaches that in-memory inbox until #21 lands.
- #20 agent runtime and tool registry. `packages/agent-server` is removed. Chat turns run through `@botanical/agent-runtime`. `GET /api/tools` lists the registry. MCP still connects on boot and those tools are copied into the registry. `send_agent_message` is a built-in, offered when the agent's allowlist includes it. The mock profile calls it when the user text is `send_agent_message {…}`.
- #21 Postgres HTTP store. `DATABASE_URL` migrates on boot and uses `packages/db` `createStore`. Migration `0001_agent_identity` stays. `0002_mvp_store` adds sessions and `model_profiles.public_id`. Live Postgres integration tests are skipped unless `BOTANICAL_TEST_DATABASE_URL` is set.
- #22 Next.js App Router + shadcn replaces the Vite client in `packages/web`.
- #29 Agent identity UI: picker, icon and color form, avatars in the sidebar and chat.
- #28 Login, settings, and A2A inbox pages.
- #27 Chat UI is integrated without a branch merge: required profile, SSE streaming, markdown, and tool-call cards. Agent icon, color, and name stay on the header and messages. `PATCH /api/chats/:id` sets title and profile. Web + server tests 88 pass, 1 postgres boot skipped.

`bun test` for `@botanical/core`, `@botanical/server`, and `@botanical/db` after the Postgres merge: 99 pass, 2 skipped, 0 fail. `@botanical/server` typecheck is green.

## Open PRs into `feat/v0-mvp`

- #23 Real model providers (`feat/mvp-providers`).
- #24 Built-in file, shell, web, and agent-message tools (`feat/mvp-tools`).
- #25 MVP Compose stack (`feat/mvp-devops`).
- #26 Playwright e2e (`feat/mvp-e2e`).


Merge order from here: providers, tools, devops, e2e.

## What works

- Passcode auth. With `DATABASE_URL` unset the store is in memory. With it set, the server migrates and uses Postgres.

- Agents have name, Lucide icon, and color. Three example agents are seeded.
- Chat turns go through the agent runtime. The mock profile calls `file_list` when it is allowlisted and can call `send_agent_message` the same way. A missing provider key returns `missing_api_key` and still stores the user message.
- A2A inbox API. Autorun is off unless `BOTANICAL_A2A_AUTORUN=true`.
- MCP config loads on boot. `GET /api/mcp/servers` reports status. Connected tools are also on `GET /api/tools`.
- Compose project `botanical` is still healthy on web `8080`, server `8787`, postgres `5432`. It has not been restarted.

## What is missing for the MVP

- Identity picker, login, settings, A2A inbox, and chat streaming (profile required, tool cards) are in the Next app.
- Shell and web tool packages are dependencies. They register only when they export `createToolContributor` (#24).
- No `packages/e2e` on this branch yet. The `botanical-mvp` stack (web `3000`, server `8788`, postgres `5433`) is not running.

## Typecheck baseline

`@botanical/server` typecheck passes. These packages were already red before the MVP pull requests (config gaps, not this merge):

- `@botanical/core` — `src/deployment/*` imports `.ts` paths and Node globals, but `tsconfig.json` sets `"types": []` and does not allow `.ts` import extensions.
- `@botanical/agent-runtime` — `tsconfig` lib is ES2022 only, so `AbortSignal`, `crypto`, timers, and `bun:test` are missing. `packages/agent-server` is gone.
- `@botanical/tools-web` — `RequestInit.cache` is not in the ES2022 lib.
- `@botanical/tools-shell` — `ChildProcess.once` is missing without Node types.

## Next

Merge providers, tools, devops, and e2e. Then bring up botanical-mvp and open the PR into main.

## Merged since the runtime note

- #22 Next.js App Router + shadcn replaces the Vite `packages/web`. `bun test` in `@botanical/web` is 4 pass. `tsc --noEmit` passes. The old Vite `model.test.ts` was removed with the Vite client.
