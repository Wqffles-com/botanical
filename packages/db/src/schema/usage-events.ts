import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { chats } from './chats.ts';
import { messages } from './messages.ts';
import { modelProfiles } from './model-profiles.ts';
import { users } from './users.ts';

/** One row per model call. Daily totals are a query, not a second table. */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    profileId: uuid('profile_id').references(() => modelProfiles.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 14, scale: 6 }),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_events_user_created_idx').on(t.userId, t.createdAt),
    index('usage_events_profile_created_idx').on(t.profileId, t.createdAt),
    index('usage_events_chat_id_idx').on(t.chatId),
    check('usage_events_tokens_nonneg', sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0`),
    check(
      'usage_events_provider_model_not_blank',
      sql`char_length(btrim(${t.provider})) > 0 and char_length(btrim(${t.model})) > 0`,
    ),
  ],
);
