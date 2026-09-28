import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.ts';
import { chats } from './chats.ts';
import { users } from './users.ts';

/**
 * Scheduled agent runs. `profile_id` is the public profile id from server config
 * (the same id chats store after resolving `model_profiles.public_id`).
 * Each run opens a new chat so the transcript stays bounded to that slot.
 */
export const routines = pgTable(
  'routines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Owner. NOT NULL, same as agents and chats. v0 fills the single operator.
     * Per-user enforcement lands with accounts; the column is already here.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull(),
    profileId: text('profile_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('routines_user_created_idx').on(t.userId, t.createdAt),
    index('routines_agent_id_idx').on(t.agentId),
    index('routines_due_idx').on(t.enabled, t.nextRunAt),
    check('routines_name_not_blank', sql`char_length(btrim(${t.name})) between 1 and 120`),
    check('routines_prompt_not_blank', sql`char_length(btrim(${t.prompt})) > 0`),
    check('routines_cron_not_blank', sql`char_length(btrim(${t.cron})) between 1 and 80`),
    check('routines_timezone_not_blank', sql`char_length(btrim(${t.timezone})) between 1 and 120`),
    check('routines_profile_id_shape', sql`${t.profileId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
  ],
);

/**
 * One execution of a routine. Schedule triggers are unique per slot so two
 * server processes cannot fire the same `scheduled_for` twice.
 */
export const routineRuns = pgTable(
  'routine_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routineId: uuid('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(),
    error: text('error'),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    /** Process that is executing this run. Null until that process starts the turn. */
    leaseOwner: text('lease_owner'),
    /** Other processes may reap the run once this instant has passed. */
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('routine_runs_routine_created_idx').on(t.routineId, t.createdAt),
    index('routine_runs_open_lease_idx')
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    uniqueIndex('routine_runs_schedule_slot_uidx')
      .on(t.routineId, t.scheduledFor)
      .where(sql`${t.trigger} = 'schedule'`),
    check('routine_runs_trigger_check', sql`${t.trigger} in ('schedule', 'manual')`),
    check(
      'routine_runs_status_check',
      sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'skipped')`,
    ),
  ],
);
