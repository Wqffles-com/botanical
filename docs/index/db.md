# Database

[Index](README.md)

Postgres schema (Drizzle), migrations, and the store the API uses when `DATABASE_URL` is set. With no URL, `packages/server/src/db/memory.ts` is the store instead.

- Package: `@botanical/db`
- Entries: `packages/db/src/index.ts`, `packages/db/src/schema/index.ts` (`./schema`), `packages/db/src/client.ts` (`./client`)
- Migrate CLI: `packages/db/src/cli.ts` (script `migrate`, root `bun run db:migrate`)

## Tables

Defined with `pgTable` under `packages/db/src/schema`. Re-exported from `packages/db/src/schema/index.ts`.

| SQL table | File |
|-----------|------|
| `tenants` | `packages/db/src/schema/tenants.ts` |
| `users` | `packages/db/src/schema/users.ts` |
| `agents` | `packages/db/src/schema/agents.ts` |
| `chats` | `packages/db/src/schema/chats.ts` |
| `messages` | `packages/db/src/schema/messages.ts` |
| `agent_messages` | `packages/db/src/schema/agent-messages.ts` |
| `model_profiles` | `packages/db/src/schema/model-profiles.ts` |
| `sessions` | `packages/db/src/schema/sessions.ts` |
| `settings` | `packages/db/src/schema/settings.ts` |
| `secret_refs` | `packages/db/src/schema/secret-refs.ts` |
| `usage_events` | `packages/db/src/schema/usage-events.ts` |
| `tool_audit` | `packages/db/src/schema/tool-audit.ts` |
| `memories` | `packages/db/src/schema/memories.ts` |
| `roles` | `packages/db/src/schema/roles.ts` |
| `agent_roles` | `packages/db/src/schema/roles.ts` |

Enums in `packages/db/src/schema/enums.ts`: `message_role`, `a2a_status`, `agent_color`. Relations: `packages/db/src/schema/relations.ts`.

`secret_refs` stores env var names, not secret values. `settings` stores instance metadata. `tenants` is a placeholder; self-host bootstraps one `users` row in `packages/db/src/store.ts` (`ensureOperator`).

## Migrations

| Path | Role |
|------|------|
| `packages/db/migrations/0000_v0.sql` | Initial tables and enums |
| `packages/db/migrations/0001_agent_identity.sql` | Agent icon, color, default profile |
| `packages/db/migrations/0002_mvp_store.sql` | `sessions`, profile `public_id` |
| `packages/db/migrations/0003_mvp2.sql` | `roles`, `agent_roles`, `memories`, agent creator |
| `packages/db/migrations/meta/_journal.json` | Apply order (tags match the SQL filenames) |
| `packages/db/migrations/meta/0000_snapshot.json` | Drizzle snapshot for `0000` |
| `packages/db/migrations/meta/0001_snapshot.json` | Drizzle snapshot for `0001` |
| `packages/db/migrations/README.md` | Why `drizzle-kit migrate` alone is not enough |
| `packages/db/sql/guards.sql` | Triggers and checks Drizzle does not emit |
| `packages/db/sql/bootstrap.sql` | Idempotent settings and secret-ref names |
| `packages/db/sql/seed-agents.sql` | Example agents, once |
| `packages/db/src/migrate.ts` | `migrateDatabase` |
| `packages/db/src/sql.ts` | Runs guards, bootstrap, then seed after Drizzle |
| `packages/db/drizzle.config.ts` | drizzle-kit config (`generate` script) |

Numbering: `NNNN_tag.sql` plus a matching `tag` in `packages/db/migrations/meta/_journal.json`. `migrateDatabase` runs the journal, then the three SQL files above. It does not stop at the Drizzle folder.

Applied by:

- `bun run db:migrate` → `packages/db/src/cli.ts` (requires `DATABASE_URL`)
- `createStore` in `packages/db/src/store.ts` when the API opens Postgres (`packages/server/src/db/store.ts` → `packages/server/src/db/postgres.ts`)
- `deploy/scripts/server-entrypoint.sh`, which runs `bun run db:migrate` before `packages/server/src/serve.ts` when `DATABASE_URL` is set

`packages/db/docker-compose.test.yml` is a throwaway Postgres on host port 5434 for integration tests. Do not start it unless asked.

## Exports

`createDb`, `ensureDatabase`, `pingDb`, `migrateDatabase`, `createStore`, schema tables, `ENV` / `SETTING_KEYS` / `PROVIDER_SECRET_REFS` from `packages/db/src/constants.ts`.

## Env vars

| File | Names |
|------|--------|
| `packages/db/src/client.ts` | `DATABASE_URL` |
| `packages/db/src/cli.ts` | `DATABASE_URL` |
| `packages/db/drizzle.config.ts` | `DATABASE_URL` (falls back to a local URL string for kit) |
| `packages/db/src/constants.ts` | Names stored as data, not read from `process.env` here: `DATABASE_URL`, `DEPLOYMENT_MODE`, `BOTANICAL_DEPLOYMENT_MODE`, `BOTANICAL_PASSWORD`, `BOTANICAL_PASSCODE`, `BOTANICAL_PASSWORD_HASH`, and the five provider key names |
| `packages/db/test/store.integration.test.ts` | `BOTANICAL_TEST_DATABASE_URL` (skips when unset) |

`packages/db/src/deployment-mode.ts` normalizes a mode string; it does not read the environment itself.

## Tests

`packages/db/test`. Script: `bun test`. Schema tests always run. `packages/db/test/store.integration.test.ts` skips without `BOTANICAL_TEST_DATABASE_URL`.

## Where to change X

- **Add a column or table.** Edit the `pgTable` in `packages/db/src/schema`, export it from `packages/db/src/schema/index.ts`, then add a migration: `bun run --cwd packages/db generate` (drizzle-kit) or a hand-written SQL file under `packages/db/migrations` whose name matches a new tag in `packages/db/migrations/meta/_journal.json`. Constraints Drizzle cannot model go in `packages/db/sql/guards.sql`. Update `packages/db/src/store.ts` if the API store should read the table.
- **Add a seed.** `packages/db/sql` and `packages/db/src/sql.ts`. Keep it idempotent.
- **Add an env var.** This package only needs to know if the name is stored in `settings` or `secret_refs` (`packages/db/src/constants.ts` and `packages/db/sql/bootstrap.sql`). Reading the value belongs in the package that uses it.
