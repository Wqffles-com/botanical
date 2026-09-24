# Botanical MVP integration status

Lead: m14 on `feat/v0-mvp`. Updated: 2026-09-24 10:12 UTC.

Base commit: `54655b4` (same tree as `feat/v0-integrate`). Integration branch is checked out in the lead worktree.

## Merged PRs

None yet.

## Open PRs into `feat/v0-mvp`

None. Swarm agents started about 10:01 UTC. No `feat/mvp-*` branches are on origin yet.

Expected branches, in merge order:

1. `feat/mvp-server-runtime`, `feat/mvp-agent-identity-api`, `feat/mvp-postgres`, `feat/mvp-next-foundation`
2. `feat/mvp-providers`, `feat/mvp-tools`, `feat/mvp-mcp`, `feat/mvp-a2a`
3. `feat/mvp-agent-identity-ui`, `feat/mvp-chat-ui`, `feat/mvp-pages-ui`
4. `feat/mvp-devops`, `feat/mvp-e2e`

## What works on the base slice

- Bun monorepo: server (passcode auth, in-memory store, mock chat turn), Vite web client, provider adapters, file/shell/web tools, MCP client, agent runtime with an A2A bus, Drizzle schema.
- Compose project `botanical` is healthy and must stay up: web `8080`, server `8787`, postgres `5432`.

## What is missing for the MVP

- `packages/web` is still Vite. Next.js + shadcn is not in the tree.
- Agents have a name but no icon or color on the shared contract.
- The HTTP server does not run the agent-runtime tool loop. `packages/agent-server` is still separate.
- `DATABASE_URL` is intentionally empty in Compose. Postgres is not the live store.
- Providers, built-in tools, MCP, and A2A are not connected to the HTTP API.
- No `packages/e2e`. The `botanical-mvp` stack (web `3000`, server `8788`, postgres `5433`) is not running.

## Typecheck baseline

`bun run typecheck` on `1175f78` is red before any MVP pull request. Passing packages: `@botanical/db`, `@botanical/mcp`, `@botanical/providers`, `@botanical/tools`, `@botanical/web-design`. Failing packages are config gaps, not new MVP regressions:

- `@botanical/core` — `src/deployment/*` imports `.ts` paths and Node globals, but `tsconfig.json` sets `"types": []` and does not allow `.ts` import extensions.
- `@botanical/agent-runtime` and `@botanical/agent-server` — `tsconfig` lib is ES2022 only, so `AbortSignal`, `crypto`, timers, and `bun:test` are missing.
- `@botanical/server` — `ReadableStream` from `stream/web` vs `node:stream/web` when it typechecks the provider package.
- `@botanical/tools-web` — `RequestInit.cache` is not in the ES2022 lib.
- `@botanical/tools-shell` — `ChildProcess.once` is missing without Node types.

These get fixed as the owning packages land, or as glue after the merge if a package stays red.

## Next

Poll for `feat/mvp-*` pull requests, merge in the order above, and get typecheck and tests green on the integrated tree. Bring the MVP stack up only after the server, persistence, and web pieces have landed. `packages/web` is being replaced locally on `feat/mvp-next-foundation` and has not been pushed.
