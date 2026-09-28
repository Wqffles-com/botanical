import type { Store } from "../types.ts";
import { nextFutureSlot } from "./cron.ts";
import type { TurnCoordinator } from "../runtime/turns.ts";

/**
 * In-process scheduler. Claiming is delegated to the store so two processes
 * (Postgres SKIP LOCKED + a unique schedule slot) cannot fire the same run.
 *
 * `start` is what arms the interval. Each tick reads instance settings:
 * `always_on.scheduler_enabled` skips claiming, and a new interval applies
 * on the tick that observes it.
 */
export function createScheduler(deps: {
  store: Store;
  turns: TurnCoordinator;
  executeRun: (runId: string) => Promise<void>;
  now?: () => Date;
}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let intervalMs = 15_000;

  function clock(): Date {
    return deps.now?.() ?? new Date();
  }

  function arm(next: number): void {
    intervalMs = next;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    timer.unref?.();
  }

  function applyInterval(next: number): void {
    if (!timer || next === intervalMs) return;
    clearInterval(timer);
    arm(next);
  }

  async function reap(): Promise<void> {
    const now = clock();
    await deps.store.routineRuns.reapExpired(now);
    await deps.store.listenerDeliveries.reapExpired(now);
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      await reap();
      const settings = await deps.store.alwaysOnSettings.get();
      applyInterval(settings.schedulerIntervalMs);
      if (!settings.schedulerEnabled) return;
      const room = deps.turns.available();
      if (room <= 0) return;
      const claimed = await deps.store.routines.claimDue(room, clock(), nextFutureSlot);
      for (const item of claimed) {
        void deps.executeRun(item.run.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] tick failed: ${message}`);
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    async start(): Promise<void> {
      if (timer) return;
      const settings = await deps.store.alwaysOnSettings.get();
      if (timer) return;
      arm(settings.schedulerIntervalMs);
      void tick();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    /** Reap expired leases. A live lease owned by another process is left alone. */
    async recover(): Promise<void> {
      await reap();
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
