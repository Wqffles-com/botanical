import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { ToolAuditStatus } from '../types.ts';
import { agents } from './agents.ts';
import { chats } from './chats.ts';
import { messages } from './messages.ts';
import { users } from './users.ts';

/**
 * Append-only tool log. Args must already be redacted by the caller.
 * Updates and deletes are rejected (sql/guards.sql), so these rows pin referenced chats.
 */
export const toolAudit = pgTable(
  'tool_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'restrict' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'restrict' }),
    toolName: text('tool_name').notNull(),
    argsRedacted: jsonb('args_redacted').$type<Record<string, unknown> | unknown[] | null>(),
    status: text('status').$type<ToolAuditStatus>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tool_audit_chat_created_idx').on(t.chatId, t.createdAt),
    index('tool_audit_agent_id_idx').on(t.agentId),
    index('tool_audit_user_id_idx').on(t.userId),
    check('tool_audit_tool_name_not_blank', sql`char_length(btrim(${t.toolName})) > 0`),
    check(
      'tool_audit_status_known',
      sql`${t.status} in ('ok', 'error', 'denied', 'pending_approval')`,
    ),
  ],
);
