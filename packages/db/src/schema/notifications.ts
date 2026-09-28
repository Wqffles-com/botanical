import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { chats } from './chats.ts';
import { listenerDeliveries } from './listeners.ts';
import { routineRuns } from './routines.ts';
import { users } from './users.ts';

/**
 * Operator-facing notices for background work and `notify_user`.
 * Optional links are cleared when the target row goes away.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Owner. NOT NULL, same as agents and chats. v0 fills the single operator. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    routineRunId: uuid('routine_run_id').references(() => routineRuns.id, { onDelete: 'set null' }),
    listenerDeliveryId: uuid('listener_delivery_id').references(() => listenerDeliveries.id, {
      onDelete: 'set null',
    }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx').on(t.userId, t.createdAt).where(sql`${t.readAt} is null`),
    check(
      'notifications_kind_check',
      sql`${t.kind} in ('run_succeeded', 'run_failed', 'attention')`,
    ),
    check('notifications_title_not_blank', sql`char_length(btrim(${t.title})) between 1 and 200`),
  ],
);
