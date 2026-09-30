import { randomUUID } from "node:crypto";

import { currentUserId } from "@botanical/db";
import {
  alwaysOnToRaw,
  createAlwaysOnSettingsAccessor,
  INTERRUPTED_STOPPED,
  shouldReapLease,
  type AlwaysOnSettingsRepository,
} from "@botanical/db";

import type {
  ClaimedRoutine,
  Listener,
  ListenerDelivery,
  ListenerDeliveryPatch,
  ListenerDeliveryRepository,
  ListenerPatch,
  ListenerRepository,
  NewListener,
  NewListenerDelivery,
  NewNotification,
  NewRoutine,
  NewRoutineRun,
  NextSlot,
  Notification,
  NotificationRepository,
  Routine,
  RoutinePatch,
  RoutineRepository,
  RoutineRun,
  RoutineRunPatch,
  RoutineRunRepository,
} from "../types.ts";

const INTERRUPTED = INTERRUPTED_STOPPED;

/**
 * Single-process stand-in for the Postgres lease. `claimDue` is serialized
 * so two scheduler ticks in one process cannot insert the same slot.
 */
/** Stable owner id for the in-memory store. Postgres uses the real operator row. */
export const MEMORY_OPERATOR_ID = "00000000-0000-4000-8000-0000000000a1";

function leaseHeldByOther(owner: string | null, expiresAt: string | null, claimant: string): boolean {
  if (!owner || !expiresAt || owner === claimant) return false;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > Date.now();
}

export function createAlwaysOn(options: {
  now: () => Date;
  hasAgent: (id: string) => boolean;
  operatorId?: string;
}): {
  routines: RoutineRepository;
  routineRuns: RoutineRunRepository;
  listeners: ListenerRepository;
  listenerDeliveries: ListenerDeliveryRepository;
  notifications: NotificationRepository;
  alwaysOnSettings: AlwaysOnSettingsRepository;
  reassign(from: string, to: string): void;
  onAgentDeleted(agentId: string): void;
} {
  const routines = new Map<string, Routine>();
  const runs = new Map<string, RoutineRun>();
  const listeners = new Map<string, Listener>();
  const deliveries = new Map<string, ListenerDelivery>();
  const notifications = new Map<string, Notification>();
  const scheduleSlots = new Set<string>();
  let claimChain: Promise<void> = Promise.resolve();
  const operatorId = options.operatorId ?? MEMORY_OPERATOR_ID;
  function bound(): string {
    return currentUserId() ?? operatorId;
  }
  /** Anonymous reads of one row or a due slot see every owner. Lists stay on the acting user. */
  function visible(owner: string, wide: boolean): boolean {
    const actor = currentUserId();
    if (actor) return owner === actor;
    if (wide) return true;
    return owner === operatorId;
  }
  let settingsRaw: Record<string, unknown> = {};
  const alwaysOnSettings = createAlwaysOnSettingsAccessor({
    async read() {
      return { ...settingsRaw };
    },
    async write(value) {
      settingsRaw = alwaysOnToRaw(value);
    },
  });

  function stamp(): string {
    return options.now().toISOString();
  }

  function clone<T>(value: T): T {
    return structuredClone(value);
  }

  const routineRepo: RoutineRepository = {
    async list(query) {
      return [...routines.values()]
        .filter((row) => visible(row.userId, false))
        .filter((row) => !query?.agentId || row.agentId === query.agentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(clone);
    },
    async get(id) {
      const row = routines.get(id);
      if (!row || !visible(row.userId, true)) return null;
      return clone(row);
    },
    async create(input: NewRoutine) {
      if (!options.hasAgent(input.agentId)) throw new Error("agent not found");
      const now = stamp();
      const row: Routine = {
        id: randomUUID(),
        userId: bound(),
        agentId: input.agentId,
        name: input.name,
        prompt: input.prompt,
        cron: input.cron,
        timezone: input.timezone,
        profileId: input.profileId,
        enabled: input.enabled,
        nextRunAt: input.nextRunAt,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      };
      routines.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: RoutinePatch) {
      const current = routines.get(id);
      if (!current) return null;
      const next: Routine = { ...current, updatedAt: stamp() };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.prompt !== undefined) next.prompt = patch.prompt;
      if (patch.cron !== undefined) next.cron = patch.cron;
      if (patch.timezone !== undefined) next.timezone = patch.timezone;
      if (patch.profileId !== undefined) next.profileId = patch.profileId;
      if (patch.enabled !== undefined) next.enabled = patch.enabled;
      if (patch.nextRunAt !== undefined) next.nextRunAt = patch.nextRunAt;
      if (patch.lastRunAt !== undefined) next.lastRunAt = patch.lastRunAt;
      routines.set(id, next);
      return clone(next);
    },
    async delete(id) {
      if (!routines.has(id)) return false;
      routines.delete(id);
      for (const run of [...runs.values()]) {
        if (run.routineId !== id) continue;
        runs.delete(run.id);
        scheduleSlots.delete(slotKey(id, run.scheduledFor));
        for (const notice of notifications.values()) {
          if (notice.routineRunId === run.id) notice.routineRunId = null;
        }
      }
      return true;
    },
    claimDue(limit, now, nextSlot) {
      const previous = claimChain;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      claimChain = gate;
      return previous.then(async () => {
        try {
          await Promise.resolve();
          return claimSync(limit, now, nextSlot);
        } finally {
          release();
        }
      });
    },
  };

  function claimSync(limit: number, now: Date, nextSlot: NextSlot): ClaimedRoutine[] {
    const room = Math.max(0, Math.min(100, Math.floor(limit)));
    if (room === 0) return [];
    const due = [...routines.values()]
      .filter((row) => row.enabled && Date.parse(row.nextRunAt) <= now.getTime())
      .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt) || a.id.localeCompare(b.id))
      .slice(0, room);
    const claimed: ClaimedRoutine[] = [];
    const updatedAt = now.toISOString();
    for (const routine of due) {
      let next: Date;
      try {
        next = nextSlot(routine, now);
        if (Number.isNaN(next.getTime())) throw new Error("invalid next slot");
      } catch {
        routine.enabled = false;
        routine.updatedAt = updatedAt;
        continue;
      }
      const scheduledFor = routine.nextRunAt;
      const key = slotKey(routine.id, scheduledFor);
      routine.nextRunAt = next.toISOString();
      routine.updatedAt = updatedAt;
      if (scheduleSlots.has(key)) continue;
      scheduleSlots.add(key);
      const run: RoutineRun = {
        id: randomUUID(),
        routineId: routine.id,
        trigger: "schedule",
        scheduledFor,
        startedAt: null,
        finishedAt: null,
        status: "queued",
        error: null,
        chatId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: updatedAt,
      };
      runs.set(run.id, run);
      claimed.push({ routine: clone(routine), run: clone(run) });
    }
    return claimed;
  }

  const runRepo: RoutineRunRepository = {
    async list(routineId, opts) {
      const { size, skip } = page(opts?.limit, opts?.offset, 20);
      return [...runs.values()]
        .filter((row) => row.routineId === routineId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(skip, skip + size)
        .map(clone);
    },
    async get(id) {
      const row = runs.get(id);
      return row ? clone(row) : null;
    },
    async create(input: NewRoutineRun) {
      if (!routines.has(input.routineId)) throw new Error("routine not found");
      if (input.trigger === "schedule") {
        const key = slotKey(input.routineId, input.scheduledFor);
        if (scheduleSlots.has(key)) throw new Error("schedule slot already exists");
        scheduleSlots.add(key);
      }
      const row: RoutineRun = {
        id: randomUUID(),
        routineId: input.routineId,
        trigger: input.trigger,
        scheduledFor: input.scheduledFor,
        startedAt: null,
        finishedAt: null,
        status: input.status ?? "queued",
        error: null,
        chatId: input.chatId ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: stamp(),
      };
      runs.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: RoutineRunPatch) {
      const current = runs.get(id);
      if (!current) return null;
      const next: RoutineRun = { ...current };
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.error !== undefined) next.error = patch.error;
      if (patch.chatId !== undefined) next.chatId = patch.chatId;
      if (patch.startedAt !== undefined) next.startedAt = patch.startedAt;
      if (patch.finishedAt !== undefined) next.finishedAt = patch.finishedAt;
      if (patch.leaseOwner !== undefined) next.leaseOwner = patch.leaseOwner;
      if (patch.leaseExpiresAt !== undefined) next.leaseExpiresAt = patch.leaseExpiresAt;
      runs.set(id, next);
      return clone(next);
    },
    async latest(routineId) {
      const row = [...runs.values()]
        .filter((item) => item.routineId === routineId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
      return row ? clone(row) : null;
    },
    async claimLease(id, owner, expiresAt) {
      const row = runs.get(id);
      if (!row || (row.status !== "queued" && row.status !== "running")) return false;
      const routine = routines.get(row.routineId);
      if (!routine || !visible(routine.userId, false)) return false;
      if (leaseHeldByOther(row.leaseOwner, row.leaseExpiresAt, owner)) return false;
      row.status = "running";
      if (!row.startedAt) row.startedAt = stamp();
      row.leaseOwner = owner;
      row.leaseExpiresAt = expiresAt;
      return true;
    },
    async renewLease(id, owner, expiresAt) {
      const row = runs.get(id);
      if (!row || row.leaseOwner !== owner) return false;
      if (row.status !== "queued" && row.status !== "running") return false;
      row.leaseExpiresAt = expiresAt;
      return true;
    },
    async finishOwned(id, owner, patch) {
      const row = runs.get(id);
      if (!row || row.leaseOwner !== owner) return null;
      if (row.status !== "queued" && row.status !== "running") return null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.chatId !== undefined) row.chatId = patch.chatId;
      if (patch.startedAt !== undefined) row.startedAt = patch.startedAt;
      if (patch.finishedAt !== undefined) row.finishedAt = patch.finishedAt;
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      return clone(row);
    },
    async reapExpired(now) {
      const finished = now.toISOString();
      let count = 0;
      for (const run of runs.values()) {
        if (run.status !== "queued" && run.status !== "running") continue;
        const routine = routines.get(run.routineId);
        if (routine && !visible(routine.userId, true)) continue;
        if (!shouldReapLease({ leaseExpiresAt: run.leaseExpiresAt, ageAnchor: run.createdAt, now })) continue;
        run.status = "failed";
        run.error = INTERRUPTED;
        run.finishedAt = finished;
        run.leaseOwner = null;
        run.leaseExpiresAt = null;
        const notice: Notification = {
          id: randomUUID(),
          userId: routine?.userId ?? operatorId,
          kind: "run_failed",
          title: `${routine?.name ?? "Routine"} failed`,
          body: INTERRUPTED,
          agentId: routine?.agentId ?? null,
          chatId: run.chatId,
          routineRunId: run.id,
          listenerDeliveryId: null,
          readAt: null,
          createdAt: finished,
        };
        notifications.set(notice.id, notice);
        count += 1;
      }
      return count;
    },
  };

  const listenerRepo: ListenerRepository = {
    async list(query) {
      return [...listeners.values()]
        .filter((row) => visible(row.userId, false))
        .filter((row) => !query?.agentId || row.agentId === query.agentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(clone);
    },
    async get(id) {
      const row = listeners.get(id);
      if (!row || !visible(row.userId, true)) return null;
      return clone(row);
    },
    async create(input: NewListener) {
      if (!options.hasAgent(input.agentId)) throw new Error("agent not found");
      const now = stamp();
      const row: Listener = {
        id: randomUUID(),
        userId: bound(),
        agentId: input.agentId,
        name: input.name,
        kind: input.kind,
        events: [...input.events],
        profileId: input.profileId,
        promptTemplate: input.promptTemplate,
        secret: input.secret,
        enabled: input.enabled,
        createdAt: now,
        updatedAt: now,
      };
      listeners.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: ListenerPatch) {
      const current = listeners.get(id);
      if (!current) return null;
      const next: Listener = { ...current, updatedAt: stamp() };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.events !== undefined) next.events = [...patch.events];
      if (patch.profileId !== undefined) next.profileId = patch.profileId;
      if (patch.promptTemplate !== undefined) next.promptTemplate = patch.promptTemplate;
      if (patch.enabled !== undefined) next.enabled = patch.enabled;
      listeners.set(id, next);
      return clone(next);
    },
    async setSecret(id, secret) {
      const current = listeners.get(id);
      if (!current) return null;
      current.secret = secret;
      current.updatedAt = stamp();
      return clone(current);
    },
    async delete(id) {
      if (!listeners.has(id)) return false;
      listeners.delete(id);
      for (const delivery of [...deliveries.values()]) {
        if (delivery.listenerId !== id) continue;
        deliveries.delete(delivery.id);
        for (const notice of notifications.values()) {
          if (notice.listenerDeliveryId === delivery.id) notice.listenerDeliveryId = null;
        }
      }
      return true;
    },
  };

  const deliveryRepo: ListenerDeliveryRepository = {
    async list(listenerId, opts) {
      const { size, skip } = page(opts?.limit, opts?.offset, 20);
      return [...deliveries.values()]
        .filter((row) => row.listenerId === listenerId)
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
        .slice(skip, skip + size)
        .map(clone);
    },
    async get(id) {
      const row = deliveries.get(id);
      return row ? clone(row) : null;
    },
    async create(input: NewListenerDelivery) {
      if (!listeners.has(input.listenerId)) throw new Error("listener not found");
      const row: ListenerDelivery = {
        id: randomUUID(),
        listenerId: input.listenerId,
        receivedAt: stamp(),
        status: input.status,
        httpStatus: input.httpStatus,
        error: input.error ?? null,
        payloadBytes: input.payloadBytes,
        payloadPreview: input.payloadPreview,
        chatId: input.chatId ?? null,
        leaseOwner: null,
        leaseExpiresAt: null,
      };
      deliveries.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: ListenerDeliveryPatch) {
      const current = deliveries.get(id);
      if (!current) return null;
      if (patch.status !== undefined) current.status = patch.status;
      if (patch.error !== undefined) current.error = patch.error;
      if (patch.chatId !== undefined) current.chatId = patch.chatId;
      if (patch.leaseOwner !== undefined) current.leaseOwner = patch.leaseOwner;
      if (patch.leaseExpiresAt !== undefined) current.leaseExpiresAt = patch.leaseExpiresAt;
      return clone(current);
    },
    async claimLease(id, owner, expiresAt) {
      const row = deliveries.get(id);
      if (!row || row.status !== "accepted") return false;
      const listener = listeners.get(row.listenerId);
      if (!listener || !visible(listener.userId, false)) return false;
      if (leaseHeldByOther(row.leaseOwner, row.leaseExpiresAt, owner)) return false;
      row.leaseOwner = owner;
      row.leaseExpiresAt = expiresAt;
      return true;
    },
    async renewLease(id, owner, expiresAt) {
      const row = deliveries.get(id);
      if (!row || row.leaseOwner !== owner || row.status !== "accepted") return false;
      row.leaseExpiresAt = expiresAt;
      return true;
    },
    async finishOwned(id, owner, patch) {
      const row = deliveries.get(id);
      if (!row || row.leaseOwner !== owner || row.status !== "accepted") return null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.chatId !== undefined) row.chatId = patch.chatId;
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      return clone(row);
    },
    async reapExpired(now) {
      const finished = now.toISOString();
      let count = 0;
      for (const delivery of deliveries.values()) {
        if (delivery.status !== "accepted") continue;
        const listener = listeners.get(delivery.listenerId);
        if (listener && !visible(listener.userId, true)) continue;
        if (!shouldReapLease({ leaseExpiresAt: delivery.leaseExpiresAt, ageAnchor: delivery.receivedAt, now })) {
          continue;
        }
        delivery.status = "failed";
        delivery.error = INTERRUPTED;
        delivery.leaseOwner = null;
        delivery.leaseExpiresAt = null;
        const notice: Notification = {
          id: randomUUID(),
          userId: listener?.userId ?? operatorId,
          kind: "run_failed",
          title: `${listener?.name ?? "Listener"} failed`,
          body: INTERRUPTED,
          agentId: listener?.agentId ?? null,
          chatId: delivery.chatId,
          routineRunId: null,
          listenerDeliveryId: delivery.id,
          readAt: null,
          createdAt: finished,
        };
        notifications.set(notice.id, notice);
        count += 1;
      }
      return count;
    },
  };

  const notificationRepo: NotificationRepository = {
    async list(opts) {
      const { size, skip } = page(opts?.limit, opts?.offset, 30);
      return [...notifications.values()]
        .filter((notice) => visible(notice.userId, false))
        .sort(byNotice)
        .slice(skip, skip + size)
        .map(clone);
    },
    async unreadCount() {
      let count = 0;
      for (const notice of notifications.values()) {
        if (visible(notice.userId, false) && !notice.readAt) count += 1;
      }
      return count;
    },
    async get(id) {
      const row = notifications.get(id);
      if (!row || !visible(row.userId, true)) return null;
      return clone(row);
    },
    async create(input: NewNotification) {
      const row: Notification = {
        id: randomUUID(),
        userId: bound(),
        kind: input.kind,
        title: input.title,
        body: input.body,
        agentId: input.agentId ?? null,
        chatId: input.chatId ?? null,
        routineRunId: input.routineRunId ?? null,
        listenerDeliveryId: input.listenerDeliveryId ?? null,
        readAt: null,
        createdAt: stamp(),
      };
      notifications.set(row.id, row);
      return clone(row);
    },
    async markRead(id, now) {
      const row = notifications.get(id);
      if (!row || !visible(row.userId, true)) return null;
      if (!row.readAt) row.readAt = now.toISOString();
      return clone(row);
    },
    async markAllRead(now) {
      const readAt = now.toISOString();
      let count = 0;
      for (const notice of notifications.values()) {
        if (!visible(notice.userId, false) || notice.readAt) continue;
        notice.readAt = readAt;
        count += 1;
      }
      return count;
    },
  };

  return {
    routines: routineRepo,
    routineRuns: runRepo,
    listeners: listenerRepo,
    listenerDeliveries: deliveryRepo,
    notifications: notificationRepo,
    alwaysOnSettings,
    reassign(from: string, to: string) {
      for (const row of routines.values()) if (row.userId === from) row.userId = to;
      for (const row of listeners.values()) if (row.userId === from) row.userId = to;
      for (const row of notifications.values()) if (row.userId === from) row.userId = to;
    },
    onAgentDeleted(agentId) {
      for (const routine of [...routines.values()]) {
        if (routine.agentId === agentId) void routineRepo.delete(routine.id);
      }
      for (const listener of [...listeners.values()]) {
        if (listener.agentId === agentId) void listenerRepo.delete(listener.id);
      }
      for (const notice of notifications.values()) {
        if (notice.agentId === agentId) notice.agentId = null;
      }
    },
  };
}

function slotKey(routineId: string, scheduledFor: string): string {
  return `${routineId}\0${scheduledFor}`;
}

function page(limit: number | undefined, offset: number | undefined, fallback: number) {
  const size = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit ?? fallback))) : fallback;
  const skip = Number.isFinite(offset) ? Math.max(0, Math.floor(offset ?? 0)) : 0;
  return { size, skip };
}

function byNotice(a: Notification, b: Notification): number {
  const unread = Number(b.readAt === null) - Number(a.readAt === null);
  if (unread !== 0) return unread;
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}
