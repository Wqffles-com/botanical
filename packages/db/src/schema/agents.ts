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
    /** Lucide icon name shown in the picker and chat. */
    icon: text('icon').notNull().default('Bot'),
    color: text('color').notNull().default('green'),
    description: text('description').notNull().default(''),
    prompt: text('prompt').notNull().default(''),
    tools: jsonb('tools')
      .$type<AgentToolBinding[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Public profile id. A suggestion only; chats still require an explicit pick. */
    defaultProfileId: text('default_profile_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_user_id_idx').on(t.userId),
    check('agents_name_not_blank', sql`char_length(btrim(${t.name})) > 0`),
    check('agents_name_length', sql`char_length(btrim(${t.name})) between 1 and 40`),
    check('agents_icon_shape', sql`${t.icon} ~ '^[A-Za-z][A-Za-z0-9]{0,39}$'`),
    check(
      'agents_color_known',
      sql`${t.color} in ('red', 'orange', 'amber', 'green', 'teal', 'cyan', 'blue', 'violet', 'pink', 'gray')`,
    ),
    check(
      'agents_default_profile_id_shape',
      sql`${t.defaultProfileId} is null or ${t.defaultProfileId} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
    check('agents_tools_is_array', sql`jsonb_typeof(${t.tools}) = 'array'`),
  ],
);
