import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/** Single-use signup invite. `token_hash` is the SHA-256 of the link token. The raw token is never stored. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invites_token_hash_uidx').on(t.tokenHash),
    index('invites_created_by_idx').on(t.createdBy),
    check('invites_token_hash_not_blank', sql`char_length(${t.tokenHash}) > 0`),
    check('invites_expiry_after_create', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
