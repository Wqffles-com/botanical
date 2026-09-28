import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * Web session. `token_hash` is the SHA-256 of the cookie or bearer token.
 * The raw token is never stored.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uidx').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    check('sessions_token_hash_not_blank', sql`char_length(${t.tokenHash}) > 0`),
    check('sessions_expiry_after_create', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
