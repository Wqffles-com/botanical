import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { users } from './users.ts';

/**
 * Operator memories. `scope = agent` is private to `agent_id`.
 * `scope = shared` is visible to every agent; `agent_id` is the author when an agent wrote it.
 */
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('memories_user_scope_idx').on(t.userId, t.scope, t.updatedAt),
    index('memories_agent_id_idx').on(t.agentId),
    check('memories_scope_check', sql`${t.scope} in ('shared', 'agent')`),
    check(
      'memories_agent_scope',
      sql`(${t.scope} = 'shared') or (${t.scope} = 'agent' and ${t.agentId} is not null)`,
    ),
    check('memories_content_not_blank', sql`char_length(btrim(${t.content})) > 0`),
  ],
);
