import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.ts';

/**
 * Account. `password_hash` is an argon2id hash, never a raw password.
 * The first account to set a password is `admin`. A row with a null hash is the
 * unclaimed bootstrap owner that migration and seed attach existing data to.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    email: text('email'),
    passwordHash: text('password_hash'),
    /** `admin` or `member`. */
    role: text('role').notNull().default('member'),
    /** Set when an admin disables the account. Null while it is active. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
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
    check('users_role_check', sql`${t.role} in ('admin', 'member')`),
  ],
);
