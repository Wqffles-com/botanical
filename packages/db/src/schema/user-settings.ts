import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/** Per-user non-secret settings. Global non-secrets stay in `settings`. */
export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    check('user_settings_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_.]*$'`),
  ],
);
