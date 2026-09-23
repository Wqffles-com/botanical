import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { AgentToolBinding } from '../types.ts';
import { users } from './users.ts';

/** Unlimited user-defined agents. `prompt` is the system prompt; `description` is the list blurb. */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    prompt: text('prompt').notNull().default(''),
    tools: jsonb('tools')
      .$type<AgentToolBinding[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_user_id_idx').on(t.userId),
    check('agents_name_not_blank', sql`char_length(btrim(${t.name})) > 0`),
    check('agents_tools_is_array', sql`jsonb_typeof(${t.tools}) = 'array'`),
  ],
);
