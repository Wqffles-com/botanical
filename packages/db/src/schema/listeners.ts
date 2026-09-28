import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { chats } from './chats.ts';
import { users } from './users.ts';

/**
 * Inbound event triggers. `kind` is text so a later migration can add typed
 * handlers (for example forge issue events) without an enum change.
 * `secret` is the raw HMAC/bearer secret. It is stored retrievable because
 * signature checks need the original value. Anyone who can read the database
 * can read listener secrets.
 */
export const listeners = pgTable(
  'listeners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Owner. NOT NULL, same as agents and chats. v0 fills the single operator. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    profileId: text('profile_id').notNull(),
    promptTemplate: text('prompt_template').notNull().default(''),
    secret: text('secret').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('listeners_user_created_idx').on(t.userId, t.createdAt),
    index('listeners_agent_id_idx').on(t.agentId),
    check('listeners_name_not_blank', sql`char_length(btrim(${t.name})) between 1 and 120`),
    check('listeners_kind_not_blank', sql`char_length(btrim(${t.kind})) between 1 and 40`),
    check('listeners_profile_id_shape', sql`${t.profileId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check('listeners_secret_not_blank', sql`char_length(${t.secret}) >= 32`),
  ],
);

/** One HTTP delivery to a listener. The full body is not stored, only a short preview. */
export const listenerDeliveries = pgTable(
  'listener_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listenerId: uuid('listener_id')
      .notNull()
      .references(() => listeners.id, { onDelete: 'cascade' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull(),
    httpStatus: integer('http_status').notNull(),
    error: text('error'),
    payloadBytes: integer('payload_bytes').notNull(),
    payloadPreview: text('payload_preview').notNull().default(''),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    /** Process executing the accepted delivery. Null until the turn starts. */
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  },
  (t) => [
    index('listener_deliveries_listener_received_idx').on(t.listenerId, t.receivedAt),
    index('listener_deliveries_open_lease_idx')
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'accepted'`),
    check(
      'listener_deliveries_status_check',
      sql`${t.status} in ('accepted', 'rejected', 'succeeded', 'failed')`,
    ),
    check('listener_deliveries_payload_bytes_nonneg', sql`${t.payloadBytes} >= 0`),
  ],
);
