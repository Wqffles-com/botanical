import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { modelProfiles } from './model-profiles.ts';
import { users } from './users.ts';

/**
 * One owning agent per chat. `agent_id` is immutable (see sql/guards.sql).
 * `profile_id` is required: chats cannot be created without an explicit profile pick.
 */
export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => modelProfiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chats_user_created_idx').on(t.userId, t.createdAt),
    index('chats_agent_id_idx').on(t.agentId),
    index('chats_profile_id_idx').on(t.profileId),
  ],
);
