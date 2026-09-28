# Botanical

Always-on agent server: a Bun HTTP API, a web client, and swappable model providers. Postgres is optional. With `DATABASE_URL` unset, the API uses an in-memory store.

## Codebase index

Start at [docs/index/README.md](docs/index/README.md). Product decisions are in [docs/DECISIONS.md](docs/DECISIONS.md). Shipped and planned work is in [docs/ROADMAP.md](docs/ROADMAP.md).

- [docs/index/server.md](docs/index/server.md) — HTTP routes, turns, auth
- [docs/index/agent-runtime.md](docs/index/agent-runtime.md) — agent loop and permissions
- [docs/index/providers.md](docs/index/providers.md) — model and CLI adapters
- [docs/index/tools.md](docs/index/tools.md) — file, shell, and web tools
- [docs/index/mcp.md](docs/index/mcp.md) — MCP client
- [docs/index/db.md](docs/index/db.md) — schema and migrations
- [docs/index/core.md](docs/index/core.md) — shared types and API client
- [docs/index/web.md](docs/index/web.md) — web app routes and settings
- [docs/index/ui.md](docs/index/ui.md) — design tokens and shadcn primitives
- [docs/index/e2e.md](docs/index/e2e.md) — browser tests
- [docs/index/deploy-and-ci.md](docs/index/deploy-and-ci.md) — images, compose, CI

## Conventions

- Bun is the package manager and the API runtime (`package.json`). TypeScript across `packages/`.
- Web UI is monochrome shadcn. Theme tokens and primitives live in `@botanical/ui` (`packages/ui/src/styles.css`, `packages/ui/src/components`); add primitives with the shadcn CLI from `packages/ui` (`packages/ui/components.json`). App screens stay in `packages/web`. Color means something: status uses `StatusBadge` tones and the `--success`/`--warning`/`--info`/`--destructive` tokens, identity uses agent colors, and the user's accent only touches `--primary`. No raw palette classes (`bg-amber-500`) or hex in app code.
- Postgres schema lives in `packages/db`. SQL files under `packages/db/migrations` are ordered by `packages/db/migrations/meta/_journal.json` (`NNNN_tag.sql` matches the journal tag). `migrateDatabase` in `packages/db/src/migrate.ts` applies that journal, then `packages/db/sql/guards.sql`, `packages/db/sql/bootstrap.sql`, and `packages/db/sql/seed-agents.sql`. Root `bun run db:migrate` runs `packages/db/src/cli.ts`. The API also migrates on boot when `DATABASE_URL` is set (`packages/db/src/store.ts`).
- Only `packages/providers` talks to model vendors.

## Commands

- Install: `bun install`
- Dev: `bun run dev` (API `packages/server`, web `packages/web` on port 3101)
- Typecheck: `bun run typecheck`
- Build: `bun run build`
- Migrate: `bun run db:migrate`
- Index: `bun run check:index`

Unit tests: `bun test` inside a package, or the package loop in `.github/workflows/ci.yml` (that loop skips `packages/e2e`). Root `bun run test` also runs the e2e package script, which probes a live web origin.

Do not run e2e against a live stack unless explicitly asked. `bun run e2e:self-test` uses the fixture in `scripts/e2e/run.mjs`.

## Keep the index current (mandatory)

Any change that adds, moves, renames or deletes files, routes, tables, env vars, or packages must update the relevant file in `docs/index/` in the same PR. Run `bun run check:index` before opening a PR. Reviewers should reject PRs that leave the index stale.

## Secrets

Do not commit secrets, `.env` files, or real API keys. Use `.env.example` for placeholders. See `SECURITY.md`.
