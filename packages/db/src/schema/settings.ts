import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Instance-level settings. Values for auth keys are env var names, not secrets.
 * `deployment.mode` is `self_host` or `saas` (validated in sql/guards.sql).
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('settings_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_.]*$'`)],
);
