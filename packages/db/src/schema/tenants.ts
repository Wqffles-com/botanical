import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Placeholder for hosted multi-tenant grouping. Self-host leaves `users.tenant_id` null.
 * v0 does not require a tenant row and does not bill from this table.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('tenants_name_not_blank', sql`char_length(btrim(${t.name})) > 0`)],
);
