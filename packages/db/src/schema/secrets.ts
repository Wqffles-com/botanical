import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * Encrypted provider and speech keys.
 * `user_id` null is an admin-global key. A user's row overrides it.
 * `ciphertext` is AES-256-GCM (`v1.` + base64). `last4` is the only hint the UI may show.
 */
export const secrets = pgTable(
  'secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    last4: text('last4').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('secrets_global_name_uidx').on(t.name).where(sql`${t.userId} is null`),
    uniqueIndex('secrets_user_name_uidx').on(t.userId, t.name).where(sql`${t.userId} is not null`),
    check('secrets_name_format', sql`${t.name} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check('secrets_last4_len', sql`char_length(${t.last4}) <= 4`),
    check('secrets_ciphertext_not_blank', sql`char_length(${t.ciphertext}) > 0`),
  ],
);
