import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { ModelProfileConfig } from '../types.ts';
import { users } from './users.ts';

/**
 * Explicit model pick. There is no default-profile column.
 * `config.apiKeyEnv` names an env var. Raw keys are rejected.
 */
export const modelProfiles = pgTable(
  'model_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /**
     * Id the HTTP API uses (`grok`, `mock`). The uuid primary key stays internal
     * so chats can keep a foreign key.
     */
    publicId: text('public_id')
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    config: jsonb('config')
      .$type<ModelProfileConfig>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('model_profiles_user_name_uidx').on(t.userId, t.name),
    uniqueIndex('model_profiles_user_public_id_uidx').on(t.userId, t.publicId),
    check('model_profiles_public_id_shape', sql`${t.publicId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check(
      'model_profiles_provider_model_not_blank',
      sql`char_length(btrim(${t.provider})) > 0 and char_length(btrim(${t.model})) > 0 and char_length(btrim(${t.name})) > 0`,
    ),
    check('model_profiles_config_is_object', sql`jsonb_typeof(${t.config}) = 'object'`),
    check(
      'model_profiles_config_has_no_raw_key',
      sql`not (
        jsonb_exists(${t.config}, 'apiKey')
        or jsonb_exists(${t.config}, 'api_key')
        or jsonb_exists(${t.config}, 'secret')
        or jsonb_exists(${t.config}, 'token')
        or jsonb_exists(${t.config}, 'password')
      )`,
    ),
  ],
);
