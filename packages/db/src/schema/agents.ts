import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { AgentToolBinding } from '../types.ts';
import { agentColorEnum } from './enums.ts';
import { users } from './users.ts';

/**
 * Unlimited user-defined agents.
 * `prompt` is the system prompt; `description` is the list blurb.
 * `title` is a short role label. `icon` is a Lucide component name (default Bot).
 * `shape` is the avatar silhouette (default squircle). `picture` is an optional data-URL image.
 * `color` is the picker swatch (default green).
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
    /** Short role label shown under the name. Empty when unset. */
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    prompt: text('prompt').notNull().default(''),
    tools: jsonb('tools')
      .$type<AgentToolBinding[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Lucide icon name shown in the picker and chat. */
    icon: text('icon').notNull().default('Bot'),
    /** Avatar silhouette. One of circle, squircle, square, hexagon, diamond, shield. */
    shape: text('shape').notNull().default('squircle'),
    /** PNG, JPEG, or WebP data URL. Null shows the shape and icon. */
    picture: text('picture'),
    color: agentColorEnum('color').notNull().default('green'),
    /** Public profile id. A suggestion only; chats still require an explicit pick. */
    defaultProfileId: text('default_profile_id'),
    /** Set when another agent created this row. Null for operator-created agents. */
    createdByAgentId: uuid('created_by_agent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_user_id_idx').on(t.userId),
    check('agents_name_not_blank', sql`char_length(btrim(${t.name})) > 0`),
    check('agents_name_length', sql`char_length(btrim(${t.name})) between 1 and 40`),
    check('agents_icon_lucide_name', sql`${t.icon} ~ '^[A-Z][A-Za-z0-9]{0,63}$'`),
    check('agents_title_length', sql`char_length(${t.title}) <= 60`),
    check(
      'agents_shape_known',
      sql`${t.shape} in ('circle', 'squircle', 'square', 'hexagon', 'diamond', 'shield')`,
    ),
    check(
      'agents_picture_data_url',
      sql`${t.picture} is null or (
        char_length(${t.picture}) between 1 and 200000
        and ${t.picture} ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
      )`,
    ),
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
