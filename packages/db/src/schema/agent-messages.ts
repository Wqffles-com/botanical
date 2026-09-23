import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { a2aStatusEnum } from './enums.ts';

/**
 * Async agent-to-agent inbox. Does not merge chats.
 * Both endpoints must belong to the same user (sql/guards.sql).
 */
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromAgent: uuid('from_agent')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    toAgent: uuid('to_agent')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    status: a2aStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_messages_inbox_idx').on(t.toAgent, t.status, t.createdAt),
    index('agent_messages_outbox_idx').on(t.fromAgent, t.createdAt),
    check('agent_messages_distinct_ends', sql`${t.fromAgent} <> ${t.toAgent}`),
    check('agent_messages_body_not_blank', sql`char_length(btrim(${t.body})) > 0`),
  ],
);
