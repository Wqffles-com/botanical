import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { AgentToolBinding } from '../types.ts';
import { agentColorEnum } from './enums.ts';
import { users } from './users.ts';

/**
 * Unlimited user-defined agents.
 * `prompt` is the system prompt; `description` is the list blurb.
 * `icon` is a Lucide component name (default Bot). `color` is the picker swatch (default green).
 * `defaultProfileId` is a suggestion only — chats still require an explicit profile.
 */
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
    icon: text('icon').notNull().default('Bot'),
    color: agentColorEnum('color').notNull().default('green'),
    defaultProfileId: text('default_profile_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_user_id_idx').on(t.userId),
    check('agents_name_not_blank', sql`char_length(btrim(${t.name})) > 0`),
    check('agents_name_length', sql`char_length(btrim(${t.name})) between 1 and 40`),
    check('agents_icon_lucide_name', sql`${t.icon} ~ '^[A-Z][A-Za-z0-9]{0,63}$'`),
    check(
      'agents_default_profile_id_shape',
      sql`${t.defaultProfileId} is null or (
        char_length(${t.defaultProfileId}) between 1 and 200
        and ${t.defaultProfileId} = btrim(${t.defaultProfileId})
      )`,
    ),
    check('agents_tools_is_array', sql`jsonb_typeof(${t.tools}) = 'array'`),
  ],
);
