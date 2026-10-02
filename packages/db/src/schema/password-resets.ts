import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * Single-use password reset link an admin generated for a user. `token_hash` is the SHA-256 of the
 * link token. The raw token is never stored.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_resets_token_hash_uidx').on(t.tokenHash),
    index('password_resets_user_id_idx').on(t.userId),
    check('password_resets_token_hash_not_blank', sql`char_length(${t.tokenHash}) > 0`),
    check('password_resets_expiry_after_create', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
