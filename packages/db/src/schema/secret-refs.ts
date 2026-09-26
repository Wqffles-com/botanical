import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Pointers at server env vars for model provider keys.
 * There is intentionally no value / secret / api_key column.
 */
export const secretRefs = pgTable(
  'secret_refs',
  {
    logicalName: text('logical_name').primaryKey(),
    envVar: text('env_var').notNull(),
    provider: text('provider'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('secret_refs_logical_name_format', sql`${t.logicalName} ~ '^[a-z][a-z0-9_]*$'`),
    check('secret_refs_env_var_name', sql`${t.envVar} ~ '^[A-Z][A-Z0-9_]*$'`),
  ],
);
