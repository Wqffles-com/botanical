import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { modelProfiles } from './model-profiles.ts';
import { users } from './users.ts';

/**
 * One owning agent per chat. `agent_id` is immutable (see sql/guards.sql).
 * `member_ids` lists the other agents of a group chat, in speaking order. Empty for the agent's own chat:
 * each agent has at most one (`chats_agent_direct_uidx`), and a chat never switches between the two kinds.
 * Members must belong to the chat's user and exclude the owner (sql/guards.sql).
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
    memberIds: uuid('member_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
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
    uniqueIndex('chats_agent_direct_uidx')
      .on(t.agentId)
      .where(sql`cardinality(${t.memberIds}) = 0`),
    index('chats_profile_id_idx').on(t.profileId),
  ],
);
