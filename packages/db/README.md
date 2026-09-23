# `@botanical/db`

Postgres schema and Drizzle migrations for Botanical v0. Runtime is **Bun**. Persistence is **Postgres 15+**.

The package is the source of truth for chats, agents, messages, agent-to-agent mail, model profiles, and secret **metadata**. It does not talk to model vendors.

## Layout

```
packages/db/
  src/schema/     Drizzle tables
  src/client.ts   createDb(DATABASE_URL)
  src/migrate.ts  programmatic migrate
  src/cli.ts      `bun run migrate`
  migrations/     generated SQL (drizzle-kit)
  sql/guards.sql  triggers drizzle does not model
  sql/bootstrap.sql
```

Apply schema with the package script. `drizzle-kit migrate` alone skips guards and seeds.

```sh
cd packages/db
bun install
export DATABASE_URL=postgres://botanical:botanical@127.0.0.1:5432/botanical
bun run migrate
```

## Tables

| Table | Purpose |
| --- | --- |
| `users` | Operator (self-host) or account (SaaS later). Optional `tenant_id`. |
| `tenants` | Placeholder grouping for hosted mode. Unused when `tenant_id` is null. |
| `agents` | `name`, `description`, `prompt`, `tools` jsonb. |
| `model_profiles` | `name`, `provider`, `model`, `config` jsonb. No default-profile flag. |
| `chats` | `agent_id` (immutable), required `profile_id`, `title`. |
| `messages` | `role`, `content`, optional tool fields. Order by `seq`. |
| `agent_messages` | A2A inbox: `from_agent`, `to_agent`, `body`, `status`. |
| `settings` | Instance config. Auth rows store **env var names**. |
| `secret_refs` | Provider key **names** (`OPENAI_API_KEY`, …). No value column. |
| `usage_events` | Tokens, estimated cost, latency per model call. |
| `tool_audit` | Append-only redacted tool log. |

### One agent per chat

`chats.agent_id` is `NOT NULL`. A trigger rejects updates that change it. The chat, its agent, and its model profile must belong to the same `users` row.

Profile **can** change during a chat (`chats.profile_id` and `messages.profile_id`). That is an explicit pick, not a silent default. The schema has no `is_default` column.

### Agent-to-agent

`agent_messages.status` is `pending`, `delivered`, `read`, or `failed`. Sender and recipient must be different agents of the same user. Delivery is the server's job (poll or worker). This table does not merge chats.

Message order inside a chat is `messages.seq` (identity), not wall-clock timestamps.

### Tool audit

Inserts only. `UPDATE` and `DELETE` raise `tool_audit is append-only`. Because of that, a chat or agent referenced by an audit row cannot be deleted until retention policy is designed. Callers must redact secrets before writing `args_redacted`.

Daily usage rollup:

```sql
select profile_id,
       date_trunc('day', created_at) as day,
       sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens,
       sum(estimated_cost_usd) as estimated_cost_usd,
       count(*) as requests
from usage_events
group by 1, 2;
```

## Secrets stay in the environment

| Env var | Role |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `DEPLOYMENT_MODE` | `self_host` or `saas` (`SELF_HOST` / `SAAS` accepted). Alias: `BOTANICAL_DEPLOYMENT_MODE` |
| `BOTANICAL_PASSWORD` | Self-host passcode. Alias: `BOTANICAL_PASSCODE` |
| `BOTANICAL_PASSWORD_HASH` | Optional precomputed hash instead of the raw passcode |
| `OPENAI_API_KEY` | Provider key |
| `ANTHROPIC_API_KEY` | Provider key |
| `XAI_API_KEY` | Provider key |
| `DEEPSEEK_API_KEY` | Provider key |
| `OPENROUTER_API_KEY` | Provider key |

`bun run migrate` seeds `settings` and `secret_refs` with those **names**. `ON CONFLICT DO NOTHING` keeps operator edits. A trigger rejects `deployment.mode` values other than `self_host` and `saas`, and rejects auth settings that are not env-var names.

`model_profiles.config` may contain `apiKeyEnv` (a name). It may not contain `apiKey`, `api_key`, `secret`, `token`, or `password`.

`users.password_hash` is optional and is a hash for later hosted accounts. Self-host login checks the passcode env var. Do not write `BOTANICAL_PASSWORD` into the database.

Missing `DEPLOYMENT_MODE` resolves to `self_host` (`resolveDeploymentMode`). It never defaults to SaaS. There is still no default **model**.

## Self-host and SaaS

Same schema. `settings.deployment.mode` records the mode. Self-host leaves `users.tenant_id` null and does not need a `tenants` row. SaaS may set `tenant_id` later. v0 has no billing tables.

Suggested self-host bootstrap (server, once, when `users` is empty):

```ts
await db.insert(users).values({ displayName: 'Owner' }).returning();
```

Then create model profiles and agents for that user before opening a chat.

## Use from other packages

Bun workspace name: `@botanical/db`. Source exports point at TypeScript.

```ts
import {
  createDb,
  migrateDatabase,
  agents,
  chats,
  messages,
  agentMessages,
  modelProfiles,
  users,
  settings,
  secretRefs,
  ENV,
  PASSCODE_ENV_VARS,
  resolveDeploymentMode,
} from '@botanical/db';

const { db, close } = createDb(process.env.DATABASE_URL);
await migrateDatabase(process.env.DATABASE_URL!);
```

Inbox query for the A2A worker:

```ts
import { and, eq } from 'drizzle-orm';
import { agentMessages } from '@botanical/db';

await db
  .select()
  .from(agentMessages)
  .where(and(eq(agentMessages.toAgent, agentId), eq(agentMessages.status, 'pending')));
```

## Changing the schema

1. Edit `src/schema`.
2. `bun run generate`.
3. If a new table has `updated_at` and should stamp it automatically, add its name to the allow-list in `sql/guards.sql`.
4. `bun test` and `bun run typecheck`.

Tests apply migrations on embedded Postgres (PGlite). They do not need a local server.
