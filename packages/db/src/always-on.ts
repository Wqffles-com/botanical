import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

import { currentUserId } from './actor.ts';
import type { BotanicalDb } from './client.ts';
import { INTERRUPTED_STOPPED, RUN_LEASE_MS } from './run-lease.ts';
import { agents } from './schema/agents.ts';
import { listenerDeliveries, listeners } from './schema/listeners.ts';
import { notifications } from './schema/notifications.ts';
import { routineRuns, routines } from './schema/routines.ts';

export type RoutineRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type RoutineRunTrigger = 'schedule' | 'manual';
export type ListenerDeliveryStatus = 'accepted' | 'rejected' | 'succeeded' | 'failed';
export type NotificationKind = 'run_succeeded' | 'run_failed' | 'attention';

export interface Routine {
  id: string;
  /** Copied from the owning agent. The single operator in v0. */
  userId: string;
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  profileId: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewRoutine {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  profileId: string;
  enabled: boolean;
  nextRunAt: string;
}

export interface RoutinePatch {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  profileId?: string;
  enabled?: boolean;
  nextRunAt?: string;
  lastRunAt?: string | null;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  trigger: RoutineRunTrigger;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RoutineRunStatus;
  error: string | null;
  chatId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
}

export interface NewRoutineRun {
  routineId: string;
  trigger: RoutineRunTrigger;
  scheduledFor: string;
  status?: RoutineRunStatus;
  chatId?: string | null;
}

export interface RoutineRunPatch {
  status?: RoutineRunStatus;
  error?: string | null;
  chatId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
}

export interface ClaimedRoutine {
  routine: Routine;
  run: RoutineRun;
}

export type NextSlot = (routine: { cron: string; timezone: string }, after: Date) => Date;

export interface Listener {
  id: string;
  userId: string;
  agentId: string;
  name: string;
  kind: string;
  profileId: string;
  promptTemplate: string;
  secret: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewListener {
  agentId: string;
  name: string;
  kind: string;
  profileId: string;
  promptTemplate: string;
  secret: string;
  enabled: boolean;
}

export interface ListenerPatch {
  name?: string;
  profileId?: string;
  promptTemplate?: string;
  enabled?: boolean;
}

export interface ListenerDelivery {
  id: string;
  listenerId: string;
  receivedAt: string;
  status: ListenerDeliveryStatus;
  httpStatus: number;
  error: string | null;
  payloadBytes: number;
  payloadPreview: string;
  chatId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface NewListenerDelivery {
  listenerId: string;
  status: ListenerDeliveryStatus;
  httpStatus: number;
  error?: string | null;
  payloadBytes: number;
  payloadPreview: string;
  chatId?: string | null;
}

export interface ListenerDeliveryPatch {
  status?: ListenerDeliveryStatus;
  error?: string | null;
  chatId?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  agentId: string | null;
  chatId: string | null;
  routineRunId: string | null;
  listenerDeliveryId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  agentId?: string | null;
  chatId?: string | null;
  routineRunId?: string | null;
  listenerDeliveryId?: string | null;
}

const INTERRUPTED = INTERRUPTED_STOPPED;

/**
 * Postgres repositories for routines, listeners, and notifications.
 * `claimDue` locks due rows with FOR UPDATE SKIP LOCKED and inserts the run
 * under the partial unique (routine_id, scheduled_for) for schedule triggers.
 */
export function createAlwaysOn(db: BotanicalDb, legacyUserId: string) {
  function bound(): string {
    return currentUserId() ?? legacyUserId;
  }
  /** Anonymous callers see every owner when `wide` is set. Otherwise the acting user. */
  function matchUser(column: AnyColumn, wide: boolean): SQL | undefined {
    if (wide && currentUserId() === null) return undefined;
    return eq(column, bound());
  }

  async function ownerFor(agentId: string | null | undefined): Promise<string> {
    if (agentId && isUuid(agentId)) {
      const rows = await db
        .select({ userId: agents.userId })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      if (rows[0]) return rows[0].userId;
    }
    return bound();
  }

  async function ownedAgent(agentId: string): Promise<boolean> {
    if (!isUuid(agentId)) return false;
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), matchUser(agents.userId, false)))
      .limit(1);
    return Boolean(rows[0]);
  }

  return {
    routines: {
      async list(query?: { agentId?: string }) {
        if (query?.agentId && !isUuid(query.agentId)) return [];
        const rows = await db
          .select({ routine: routines })
          .from(routines)
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(
            and(
              matchUser(routines.userId, false),
              matchUser(agents.userId, false),
              query?.agentId ? eq(routines.agentId, query.agentId) : undefined,
            ),
          )
          .orderBy(desc(routines.createdAt), desc(routines.id));
        return rows.map((row) => toRoutine(row.routine));
      },
      async get(id: string) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ routine: routines })
          .from(routines)
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(and(eq(routines.id, id), matchUser(routines.userId, true), matchUser(agents.userId, true)))
          .limit(1);
        return rows[0] ? toRoutine(rows[0].routine) : null;
      },
      async create(input: NewRoutine) {
        if (!(await ownedAgent(input.agentId))) throw new Error('agent not found');
        const inserted = await db
          .insert(routines)
          .values({
            userId: bound(),
            agentId: input.agentId,
            name: input.name,
            prompt: input.prompt,
            cron: input.cron,
            timezone: input.timezone,
            profileId: input.profileId,
            enabled: input.enabled,
            nextRunAt: asDate(input.nextRunAt, 'nextRunAt'),
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('routine insert failed');
        return toRoutine(row);
      },
      async update(id: string, patch: RoutinePatch) {
        if (!isUuid(id)) return null;
        const current = await db
          .select({ id: routines.id })
          .from(routines)
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(and(eq(routines.id, id), matchUser(routines.userId, false), matchUser(agents.userId, false)))
          .limit(1);
        if (!current[0]) return null;
        const values: {
          name?: string;
          prompt?: string;
          cron?: string;
          timezone?: string;
          profileId?: string;
          enabled?: boolean;
          nextRunAt?: Date;
          lastRunAt?: Date | null;
          updatedAt: Date;
        } = { updatedAt: new Date() };
        if (patch.name !== undefined) values.name = patch.name;
        if (patch.prompt !== undefined) values.prompt = patch.prompt;
        if (patch.cron !== undefined) values.cron = patch.cron;
        if (patch.timezone !== undefined) values.timezone = patch.timezone;
        if (patch.profileId !== undefined) values.profileId = patch.profileId;
        if (patch.enabled !== undefined) values.enabled = patch.enabled;
        if (patch.nextRunAt !== undefined) values.nextRunAt = asDate(patch.nextRunAt, 'nextRunAt');
        if (patch.lastRunAt !== undefined) {
          values.lastRunAt = patch.lastRunAt === null ? null : asDate(patch.lastRunAt, 'lastRunAt');
        }
        const updated = await db.update(routines).set(values).where(eq(routines.id, id)).returning();
        return updated[0] ? toRoutine(updated[0]) : null;
      },
      async delete(id: string) {
        if (!isUuid(id)) return false;
        const removed = await db
          .delete(routines)
          .where(
            and(
              eq(routines.id, id),
              inArray(
                routines.agentId,
                db.select({ id: agents.id }).from(agents).where(matchUser(agents.userId, false)),
              ),
            ),
          )
          .returning({ id: routines.id });
        return removed.length > 0;
      },
      async claimDue(limit: number, now: Date, nextSlot: NextSlot): Promise<ClaimedRoutine[]> {
        const room = clampLimit(limit, 0);
        if (room === 0) return [];
        const nowIso = now.toISOString();
        return db.transaction(async (tx) => {
          const selected = await tx.execute(sql`
            SELECT r.id, r.user_id, r.agent_id, r.name, r.prompt, r.cron, r.timezone, r.profile_id, r.enabled,
                   r.next_run_at, r.last_run_at, r.created_at, r.updated_at
            FROM routines r
            INNER JOIN agents a ON a.id = r.agent_id
            WHERE r.enabled = true
              AND r.next_run_at <= ${nowIso}::timestamptz
              AND (${currentUserId() === null}::boolean OR (r.user_id = ${bound()}::uuid AND a.user_id = ${bound()}::uuid))
            ORDER BY r.next_run_at
            FOR UPDATE OF r SKIP LOCKED
            LIMIT ${room}
          `);
          const claimed: ClaimedRoutine[] = [];
          for (const raw of asRows(selected)) {
            const routine = routineFromSql(raw);
            let next: Date;
            try {
              next = nextSlot(routine, now);
              if (Number.isNaN(next.getTime())) throw new Error('invalid next slot');
            } catch {
              await tx.execute(sql`
                UPDATE routines SET enabled = false, updated_at = ${nowIso}::timestamptz WHERE id = ${routine.id}::uuid
              `);
              continue;
            }
            const inserted = await tx.execute(sql`
              INSERT INTO routine_runs (routine_id, trigger, scheduled_for, status)
              VALUES (${routine.id}::uuid, 'schedule', ${routine.nextRunAt}::timestamptz, 'queued')
              ON CONFLICT (routine_id, scheduled_for) WHERE trigger = 'schedule' DO NOTHING
              RETURNING id, routine_id, trigger, scheduled_for, started_at, finished_at, status, error, chat_id, lease_owner, lease_expires_at, created_at
            `);
            await tx.execute(sql`
              UPDATE routines
              SET next_run_at = ${next.toISOString()}::timestamptz, updated_at = ${nowIso}::timestamptz
              WHERE id = ${routine.id}::uuid
            `);
            const runRow = asRows(inserted)[0];
            if (!runRow) continue;
            claimed.push({
              routine: { ...routine, nextRunAt: next.toISOString(), updatedAt: now.toISOString() },
              run: runFromSql(runRow),
            });
          }
          return claimed;
        });
      },
    },
    routineRuns: {
      async list(routineId: string, opts?: { limit?: number; offset?: number }) {
        if (!isUuid(routineId)) return [];
        const owned = await db
          .select({ id: routines.id })
          .from(routines)
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(and(eq(routines.id, routineId), matchUser(agents.userId, false)))
          .limit(1);
        if (!owned[0]) return [];
        const { size, skip } = page(opts?.limit, opts?.offset, 20);
        const rows = await db
          .select()
          .from(routineRuns)
          .where(eq(routineRuns.routineId, routineId))
          .orderBy(desc(routineRuns.createdAt), desc(routineRuns.id))
          .limit(size)
          .offset(skip);
        return rows.map(toRun);
      },
      async get(id: string) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ run: routineRuns })
          .from(routineRuns)
          .innerJoin(routines, eq(routineRuns.routineId, routines.id))
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(and(eq(routineRuns.id, id), matchUser(agents.userId, true)))
          .limit(1);
        return rows[0] ? toRun(rows[0].run) : null;
      },
      async create(input: NewRoutineRun) {
        if (!isUuid(input.routineId)) throw new Error('routine not found');
        const owned = await db
          .select({ id: routines.id })
          .from(routines)
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(and(eq(routines.id, input.routineId), matchUser(agents.userId, false)))
          .limit(1);
        if (!owned[0]) throw new Error('routine not found');
        const inserted = await db
          .insert(routineRuns)
          .values({
            routineId: input.routineId,
            trigger: input.trigger,
            scheduledFor: asDate(input.scheduledFor, 'scheduledFor'),
            status: input.status ?? 'queued',
            chatId: input.chatId ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('routine run insert failed');
        return toRun(row);
      },
      async update(id: string, patch: RoutineRunPatch) {
        if (!isUuid(id)) return null;
        const current = await db
          .select({ id: routineRuns.id })
          .from(routineRuns)
          .innerJoin(routines, eq(routineRuns.routineId, routines.id))
          .innerJoin(agents, eq(routines.agentId, agents.id))
          .where(and(eq(routineRuns.id, id), matchUser(agents.userId, false)))
          .limit(1);
        if (!current[0]) return null;
        const values: {
          status?: RoutineRunStatus;
          error?: string | null;
          chatId?: string | null;
          startedAt?: Date | null;
          finishedAt?: Date | null;
          leaseOwner?: string | null;
          leaseExpiresAt?: Date | null;
        } = {};
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.error !== undefined) values.error = patch.error;
        if (patch.chatId !== undefined) values.chatId = patch.chatId;
        if (patch.startedAt !== undefined) {
          values.startedAt = patch.startedAt === null ? null : asDate(patch.startedAt, 'startedAt');
        }
        if (patch.finishedAt !== undefined) {
          values.finishedAt = patch.finishedAt === null ? null : asDate(patch.finishedAt, 'finishedAt');
        }
        if (patch.leaseOwner !== undefined) values.leaseOwner = patch.leaseOwner;
        if (patch.leaseExpiresAt !== undefined) {
          values.leaseExpiresAt = patch.leaseExpiresAt === null ? null : asDate(patch.leaseExpiresAt, 'leaseExpiresAt');
        }
        const updated = await db.update(routineRuns).set(values).where(eq(routineRuns.id, id)).returning();
        return updated[0] ? toRun(updated[0]) : null;
      },
      async latest(routineId: string) {
        const rows = await db
          .select()
          .from(routineRuns)
          .where(eq(routineRuns.routineId, routineId))
          .orderBy(desc(routineRuns.createdAt), desc(routineRuns.id))
          .limit(1);
        return rows[0] ? toRun(rows[0]) : null;
      },
      async claimLease(id: string, owner: string, expiresAt: string) {
        if (!isUuid(id)) return false;
        const nowIso = new Date().toISOString();
        const updated = await db.execute(sql`
          UPDATE routine_runs AS rr
          SET status = 'running',
              started_at = COALESCE(rr.started_at, ${nowIso}::timestamptz),
              lease_owner = ${owner},
              lease_expires_at = ${expiresAt}::timestamptz
          WHERE rr.id = ${id}::uuid
            AND rr.status IN ('queued', 'running')
            AND EXISTS (
              SELECT 1 FROM routines r
              WHERE r.id = rr.routine_id AND (${currentUserId() === null}::boolean OR r.user_id = ${bound()}::uuid)
            )
            AND (
              rr.lease_expires_at IS NULL
              OR rr.lease_expires_at <= ${nowIso}::timestamptz
              OR rr.lease_owner = ${owner}
            )
          RETURNING rr.id
        `);
        return asRows(updated).length > 0;
      },
      async renewLease(id: string, owner: string, expiresAt: string) {
        if (!isUuid(id)) return false;
        const updated = await db
          .update(routineRuns)
          .set({ leaseExpiresAt: asDate(expiresAt, 'leaseExpiresAt') })
          .where(
            and(
              eq(routineRuns.id, id),
              eq(routineRuns.leaseOwner, owner),
              inArray(routineRuns.status, ['queued', 'running']),
            ),
          )
          .returning({ id: routineRuns.id });
        return updated.length > 0;
      },
      async finishOwned(id: string, owner: string, patch: RoutineRunPatch) {
        if (!isUuid(id)) return null;
        const values: {
          status?: RoutineRunStatus;
          error?: string | null;
          chatId?: string | null;
          startedAt?: Date | null;
          finishedAt?: Date | null;
          leaseOwner: null;
          leaseExpiresAt: null;
        } = { leaseOwner: null, leaseExpiresAt: null };
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.error !== undefined) values.error = patch.error;
        if (patch.chatId !== undefined) values.chatId = patch.chatId;
        if (patch.startedAt !== undefined) {
          values.startedAt = patch.startedAt === null ? null : asDate(patch.startedAt, 'startedAt');
        }
        if (patch.finishedAt !== undefined) {
          values.finishedAt = patch.finishedAt === null ? null : asDate(patch.finishedAt, 'finishedAt');
        }
        const updated = await db
          .update(routineRuns)
          .set(values)
          .where(
            and(
              eq(routineRuns.id, id),
              eq(routineRuns.leaseOwner, owner),
              inArray(routineRuns.status, ['queued', 'running']),
            ),
          )
          .returning();
        return updated[0] ? toRun(updated[0]) : null;
      },
      async reapExpired(now: Date) {
        const nowIso = now.toISOString();
        const cutoffIso = new Date(now.getTime() - RUN_LEASE_MS).toISOString();
        return db.transaction(async (tx) => {
          const updated = await tx.execute(sql`
            UPDATE routine_runs AS rr
            SET status = 'failed',
                error = ${INTERRUPTED},
                finished_at = ${nowIso}::timestamptz,
                lease_owner = NULL,
                lease_expires_at = NULL
            FROM routines AS r
            WHERE rr.routine_id = r.id
              AND (${currentUserId() === null}::boolean OR r.user_id = ${bound()}::uuid)
              AND rr.status IN ('queued', 'running')
              AND (
                (rr.lease_expires_at IS NOT NULL AND rr.lease_expires_at <= ${nowIso}::timestamptz)
                OR (rr.lease_expires_at IS NULL AND rr.created_at <= ${cutoffIso}::timestamptz)
              )
            RETURNING rr.id AS id, rr.chat_id AS chat_id, r.name AS name, r.agent_id AS agent_id, r.user_id AS user_id
          `);
          const rows = asRows(updated);
          for (const row of rows) {
            await tx.insert(notifications).values({
              userId: text(row.user_id),
              kind: 'run_failed',
              title: `${text(row.name) || 'Routine'} failed`,
              body: INTERRUPTED,
              agentId: text(row.agent_id) || null,
              chatId: row.chat_id == null ? null : text(row.chat_id),
              routineRunId: text(row.id),
            });
          }
          return rows.length;
        });
      },
    },
    listeners: {
      async list(query?: { agentId?: string }) {
        if (query?.agentId && !isUuid(query.agentId)) return [];
        const rows = await db
          .select({ listener: listeners })
          .from(listeners)
          .innerJoin(agents, eq(listeners.agentId, agents.id))
          .where(
            and(
              matchUser(listeners.userId, false),
              matchUser(agents.userId, false),
              query?.agentId ? eq(listeners.agentId, query.agentId) : undefined,
            ),
          )
          .orderBy(desc(listeners.createdAt), desc(listeners.id));
        return rows.map((row) => toListener(row.listener));
      },
      async get(id: string) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ listener: listeners })
          .from(listeners)
          .innerJoin(agents, eq(listeners.agentId, agents.id))
          .where(and(eq(listeners.id, id), matchUser(listeners.userId, true), matchUser(agents.userId, true)))
          .limit(1);
        return rows[0] ? toListener(rows[0].listener) : null;
      },
      async create(input: NewListener) {
        if (!(await ownedAgent(input.agentId))) throw new Error('agent not found');
        const inserted = await db
          .insert(listeners)
          .values({
            userId: bound(),
            agentId: input.agentId,
            name: input.name,
            kind: input.kind,
            profileId: input.profileId,
            promptTemplate: input.promptTemplate,
            secret: input.secret,
            enabled: input.enabled,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('listener insert failed');
        return toListener(row);
      },
      async update(id: string, patch: ListenerPatch) {
        if (!isUuid(id)) return null;
        const current = await db
          .select({ id: listeners.id })
          .from(listeners)
          .innerJoin(agents, eq(listeners.agentId, agents.id))
          .where(and(eq(listeners.id, id), matchUser(listeners.userId, false), matchUser(agents.userId, false)))
          .limit(1);
        if (!current[0]) return null;
        const values: {
          name?: string;
          profileId?: string;
          promptTemplate?: string;
          enabled?: boolean;
          updatedAt: Date;
        } = { updatedAt: new Date() };
        if (patch.name !== undefined) values.name = patch.name;
        if (patch.profileId !== undefined) values.profileId = patch.profileId;
        if (patch.promptTemplate !== undefined) values.promptTemplate = patch.promptTemplate;
        if (patch.enabled !== undefined) values.enabled = patch.enabled;
        const updated = await db.update(listeners).set(values).where(eq(listeners.id, id)).returning();
        return updated[0] ? toListener(updated[0]) : null;
      },
      async setSecret(id: string, secret: string) {
        if (!isUuid(id)) return null;
        const current = await db
          .select({ id: listeners.id })
          .from(listeners)
          .innerJoin(agents, eq(listeners.agentId, agents.id))
          .where(and(eq(listeners.id, id), matchUser(listeners.userId, false), matchUser(agents.userId, false)))
          .limit(1);
        if (!current[0]) return null;
        const updated = await db
          .update(listeners)
          .set({ secret, updatedAt: new Date() })
          .where(eq(listeners.id, id))
          .returning();
        return updated[0] ? toListener(updated[0]) : null;
      },
      async delete(id: string) {
        if (!isUuid(id)) return false;
        const removed = await db
          .delete(listeners)
          .where(
            and(
              eq(listeners.id, id),
              inArray(
                listeners.agentId,
                db.select({ id: agents.id }).from(agents).where(matchUser(agents.userId, false)),
              ),
            ),
          )
          .returning({ id: listeners.id });
        return removed.length > 0;
      },
    },
    listenerDeliveries: {
      async list(listenerId: string, opts?: { limit?: number; offset?: number }) {
        if (!isUuid(listenerId)) return [];
        const owned = await db
          .select({ id: listeners.id })
          .from(listeners)
          .innerJoin(agents, eq(listeners.agentId, agents.id))
          .where(and(eq(listeners.id, listenerId), matchUser(agents.userId, false)))
          .limit(1);
        if (!owned[0]) return [];
        const { size, skip } = page(opts?.limit, opts?.offset, 20);
        const rows = await db
          .select()
          .from(listenerDeliveries)
          .where(eq(listenerDeliveries.listenerId, listenerId))
          .orderBy(desc(listenerDeliveries.receivedAt), desc(listenerDeliveries.id))
          .limit(size)
          .offset(skip);
        return rows.map(toDelivery);
      },
      async get(id: string) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ delivery: listenerDeliveries })
          .from(listenerDeliveries)
          .innerJoin(listeners, eq(listenerDeliveries.listenerId, listeners.id))
          .innerJoin(agents, eq(listeners.agentId, agents.id))
          .where(and(eq(listenerDeliveries.id, id), matchUser(agents.userId, true)))
          .limit(1);
        return rows[0] ? toDelivery(rows[0].delivery) : null;
      },
      async create(input: NewListenerDelivery) {
        if (!isUuid(input.listenerId)) throw new Error('listener not found');
        const inserted = await db
          .insert(listenerDeliveries)
          .values({
            listenerId: input.listenerId,
            status: input.status,
            httpStatus: input.httpStatus,
            error: input.error ?? null,
            payloadBytes: input.payloadBytes,
            payloadPreview: input.payloadPreview,
            chatId: input.chatId ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('delivery insert failed');
        return toDelivery(row);
      },
      async update(id: string, patch: ListenerDeliveryPatch) {
        if (!isUuid(id)) return null;
        const values: {
          status?: ListenerDeliveryStatus;
          error?: string | null;
          chatId?: string | null;
          leaseOwner?: string | null;
          leaseExpiresAt?: Date | null;
        } = {};
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.error !== undefined) values.error = patch.error;
        if (patch.chatId !== undefined) values.chatId = patch.chatId;
        if (patch.leaseOwner !== undefined) values.leaseOwner = patch.leaseOwner;
        if (patch.leaseExpiresAt !== undefined) {
          values.leaseExpiresAt = patch.leaseExpiresAt === null ? null : asDate(patch.leaseExpiresAt, 'leaseExpiresAt');
        }
        const updated = await db
          .update(listenerDeliveries)
          .set(values)
          .where(eq(listenerDeliveries.id, id))
          .returning();
        return updated[0] ? toDelivery(updated[0]) : null;
      },
      async claimLease(id: string, owner: string, expiresAt: string) {
        if (!isUuid(id)) return false;
        const nowIso = new Date().toISOString();
        const updated = await db.execute(sql`
          UPDATE listener_deliveries AS d
          SET lease_owner = ${owner},
              lease_expires_at = ${expiresAt}::timestamptz
          WHERE d.id = ${id}::uuid
            AND d.status = 'accepted'
            AND EXISTS (
              SELECT 1 FROM listeners l
              WHERE l.id = d.listener_id AND (${currentUserId() === null}::boolean OR l.user_id = ${bound()}::uuid)
            )
            AND (
              d.lease_expires_at IS NULL
              OR d.lease_expires_at <= ${nowIso}::timestamptz
              OR d.lease_owner = ${owner}
            )
          RETURNING d.id
        `);
        return asRows(updated).length > 0;
      },
      async renewLease(id: string, owner: string, expiresAt: string) {
        if (!isUuid(id)) return false;
        const updated = await db
          .update(listenerDeliveries)
          .set({ leaseExpiresAt: asDate(expiresAt, 'leaseExpiresAt') })
          .where(
            and(
              eq(listenerDeliveries.id, id),
              eq(listenerDeliveries.leaseOwner, owner),
              eq(listenerDeliveries.status, 'accepted'),
            ),
          )
          .returning({ id: listenerDeliveries.id });
        return updated.length > 0;
      },
      async finishOwned(id: string, owner: string, patch: ListenerDeliveryPatch) {
        if (!isUuid(id)) return null;
        const values: {
          status?: ListenerDeliveryStatus;
          error?: string | null;
          chatId?: string | null;
          leaseOwner: null;
          leaseExpiresAt: null;
        } = { leaseOwner: null, leaseExpiresAt: null };
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.error !== undefined) values.error = patch.error;
        if (patch.chatId !== undefined) values.chatId = patch.chatId;
        const updated = await db
          .update(listenerDeliveries)
          .set(values)
          .where(
            and(
              eq(listenerDeliveries.id, id),
              eq(listenerDeliveries.leaseOwner, owner),
              eq(listenerDeliveries.status, 'accepted'),
            ),
          )
          .returning();
        return updated[0] ? toDelivery(updated[0]) : null;
      },
      async reapExpired(now: Date) {
        const nowIso = now.toISOString();
        const cutoffIso = new Date(now.getTime() - RUN_LEASE_MS).toISOString();
        return db.transaction(async (tx) => {
          const updated = await tx.execute(sql`
            UPDATE listener_deliveries AS d
            SET status = 'failed',
                error = ${INTERRUPTED},
                lease_owner = NULL,
                lease_expires_at = NULL
            FROM listeners AS l
            WHERE d.listener_id = l.id
              AND (${currentUserId() === null}::boolean OR l.user_id = ${bound()}::uuid)
              AND d.status = 'accepted'
              AND (
                (d.lease_expires_at IS NOT NULL AND d.lease_expires_at <= ${nowIso}::timestamptz)
                OR (d.lease_expires_at IS NULL AND d.received_at <= ${cutoffIso}::timestamptz)
              )
            RETURNING d.id AS id, d.chat_id AS chat_id, l.name AS name, l.agent_id AS agent_id, l.user_id AS user_id
          `);
          const rows = asRows(updated);
          for (const row of rows) {
            await tx.insert(notifications).values({
              userId: text(row.user_id),
              kind: 'run_failed',
              title: `${text(row.name) || 'Listener'} failed`,
              body: INTERRUPTED,
              agentId: text(row.agent_id) || null,
              chatId: row.chat_id == null ? null : text(row.chat_id),
              listenerDeliveryId: text(row.id),
            });
          }
          return rows.length;
        });
      },
    },
    notifications: {
      async list(opts?: { limit?: number; offset?: number }) {
        const { size, skip } = page(opts?.limit, opts?.offset, 30);
        const rows = await db
          .select()
          .from(notifications)
          .where(matchUser(notifications.userId, false))
          .orderBy(sql`(${notifications.readAt} is null) desc`, desc(notifications.createdAt), desc(notifications.id))
          .limit(size)
          .offset(skip);
        return rows.map(toNotification);
      },
      async unreadCount() {
        const rows = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(matchUser(notifications.userId, false), sql`${notifications.readAt} is null`));
        return rows.length;
      },
      async get(id: string) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.id, id), matchUser(notifications.userId, false)))
          .limit(1);
        return rows[0] ? toNotification(rows[0]) : null;
      },
      async create(input: NewNotification) {
        const owner = await ownerFor(input.agentId);
        const inserted = await db
          .insert(notifications)
          .values({
            userId: owner,
            kind: input.kind,
            title: input.title,
            body: input.body,
            agentId: input.agentId ?? null,
            chatId: input.chatId ?? null,
            routineRunId: input.routineRunId ?? null,
            listenerDeliveryId: input.listenerDeliveryId ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('notification insert failed');
        return toNotification(row);
      },
      async markRead(id: string, now: Date) {
        if (!isUuid(id)) return null;
        const current = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.id, id), matchUser(notifications.userId, false)))
          .limit(1);
        const row = current[0];
        if (!row) return null;
        if (row.readAt) return toNotification(row);
        const updated = await db
          .update(notifications)
          .set({ readAt: now })
          .where(eq(notifications.id, id))
          .returning();
        return updated[0] ? toNotification(updated[0]) : null;
      },
      async markAllRead(now: Date) {
        const updated = await db
          .update(notifications)
          .set({ readAt: now })
          .where(and(matchUser(notifications.userId, false), sql`${notifications.readAt} is null`))
          .returning({ id: notifications.id });
        return updated.length;
      },
    },
  };
}

export type AlwaysOn = ReturnType<typeof createAlwaysOn>;

type RoutineRow = typeof routines.$inferSelect;
type RunRow = typeof routineRuns.$inferSelect;
type ListenerRow = typeof listeners.$inferSelect;
type DeliveryRow = typeof listenerDeliveries.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;

function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    timezone: row.timezone,
    profileId: row.profileId,
    enabled: row.enabled,
    nextRunAt: iso(row.nextRunAt),
    lastRunAt: row.lastRunAt ? iso(row.lastRunAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toRun(row: RunRow): RoutineRun {
  return {
    id: row.id,
    routineId: row.routineId,
    trigger: row.trigger as RoutineRunTrigger,
    scheduledFor: iso(row.scheduledFor),
    startedAt: row.startedAt ? iso(row.startedAt) : null,
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
    status: row.status as RoutineRunStatus,
    error: row.error,
    chatId: row.chatId,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt ? iso(row.leaseExpiresAt) : null,
    createdAt: iso(row.createdAt),
  };
}

function toListener(row: ListenerRow): Listener {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    name: row.name,
    kind: row.kind,
    profileId: row.profileId,
    promptTemplate: row.promptTemplate,
    secret: row.secret,
    enabled: row.enabled,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toDelivery(row: DeliveryRow): ListenerDelivery {
  return {
    id: row.id,
    listenerId: row.listenerId,
    receivedAt: iso(row.receivedAt),
    status: row.status as ListenerDeliveryStatus,
    httpStatus: row.httpStatus,
    error: row.error,
    payloadBytes: row.payloadBytes,
    payloadPreview: row.payloadPreview,
    chatId: row.chatId,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt ? iso(row.leaseExpiresAt) : null,
  };
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    agentId: row.agentId,
    chatId: row.chatId,
    routineRunId: row.routineRunId,
    listenerDeliveryId: row.listenerDeliveryId,
    readAt: row.readAt ? iso(row.readAt) : null,
    createdAt: iso(row.createdAt),
  };
}

function routineFromSql(row: Record<string, unknown>): Routine {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    agentId: text(row.agent_id),
    name: text(row.name),
    prompt: text(row.prompt),
    cron: text(row.cron),
    timezone: text(row.timezone),
    profileId: text(row.profile_id),
    enabled: flag(row.enabled),
    nextRunAt: text(row.next_run_at),
    lastRunAt: row.last_run_at == null ? null : text(row.last_run_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function runFromSql(row: Record<string, unknown>): RoutineRun {
  return {
    id: text(row.id),
    routineId: text(row.routine_id),
    trigger: text(row.trigger) as RoutineRunTrigger,
    scheduledFor: text(row.scheduled_for),
    startedAt: row.started_at == null ? null : text(row.started_at),
    finishedAt: row.finished_at == null ? null : text(row.finished_at),
    status: text(row.status) as RoutineRunStatus,
    error: row.error == null ? null : text(row.error),
    chatId: row.chat_id == null ? null : text(row.chat_id),
    leaseOwner: row.lease_owner == null ? null : text(row.lease_owner),
    leaseExpiresAt: row.lease_expires_at == null ? null : text(row.lease_expires_at),
    createdAt: text(row.created_at),
  };
}

function asRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) || /^\d{4}-\d{2}-\d{2} /.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime()) && value.includes(':')) return parsed.toISOString();
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error('unexpected SQL value');
}

function flag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp from postgres');
  return date.toISOString();
}

function asDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid timestamp`);
  return date;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function page(limit: number | undefined, offset: number | undefined, fallback: number) {
  const size = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit ?? fallback))) : fallback;
  const skip = Number.isFinite(offset) ? Math.max(0, Math.floor(offset ?? 0)) : 0;
  return { size, skip };
}

function clampLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(limit)));
}
