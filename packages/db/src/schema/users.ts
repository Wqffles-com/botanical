import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.ts';

/**
 * Identity row. Self-host v0 bootstraps one owner and authenticates with the passcode env var.
 * `password_hash` is for hosted accounts later. It is a hash, never a raw passcode.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    email: text('email'),
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('users_tenant_id_idx').on(t.tenantId),
    uniqueIndex('users_email_lower_uidx')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    check('users_display_name_not_blank', sql`char_length(btrim(${t.displayName})) > 0`),
    check(
      'users_email_shape',
      sql`${t.email} is null or ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$'`,
    ),
  ],
);
