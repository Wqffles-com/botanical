import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { ContentPart, StoredToolCall } from '../types.ts';
import { chats } from './chats.ts';
import { messageRoleEnum } from './enums.ts';
import { modelProfiles } from './model-profiles.ts';

/** Chat transcript. Order by `seq` (identity). `role = tool` requires `tool_call_id`. */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull().default(''),
    parts: jsonb('parts').$type<ContentPart[] | null>(),
    toolCallId: text('tool_call_id'),
    toolCalls: jsonb('tool_calls').$type<StoredToolCall[] | null>(),
    name: text('name'),
    profileId: uuid('profile_id').references(() => modelProfiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_chat_seq_idx').on(t.chatId, t.seq),
    index('messages_profile_id_idx').on(t.profileId),
    check(
      'messages_tool_role_has_call_id',
      sql`${t.role} <> 'tool' or (${t.toolCallId} is not null and char_length(${t.toolCallId}) > 0)`,
    ),
  ],
);
