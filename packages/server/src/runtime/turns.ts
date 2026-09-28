import type { SseEvent } from "../streaming.ts";

/**
 * One turn at a time per chat, and a process-wide cap on background turns.
 * Interactive HTTP turns share the per-chat lock and do not consume the cap.
 */
export function createTurnCoordinator(options: { concurrency: number | (() => number) }) {
  const limit = (): number => {
    const raw = typeof options.concurrency === "function" ? options.concurrency() : options.concurrency;
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.floor(raw));
  };
  const tails = new Map<string, Promise<void>>();
  let active = 0;
  const waiting: Array<() => void> = [];
  const idleWaiters: Array<() => void> = [];

  function lock(chatId: string): Promise<() => void> {
    const previous = tails.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    const settled = tail.then(
      () => undefined,
      () => undefined,
    );
    tails.set(chatId, settled);
    return previous.then(() => () => {
      release();
      if (tails.get(chatId) === settled) tails.delete(chatId);
    });
  }

  function pump(): void {
    while (active < limit() && waiting.length > 0) {
      const start = waiting.shift();
      start?.();
    }
    if (active === 0 && waiting.length === 0) {
      const pending = idleWaiters.splice(0);
      for (const waiter of pending) waiter();
    }
  }

  return {
    /** Slots that can accept a new background turn without queueing. */
    available(): number {
      return Math.max(0, limit() - active - waiting.length);
    },

    whenIdle(): Promise<void> {
      if (active === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    },

    /** Background work. Counts against the global cap, then runs `fn`. */
    runInBackground<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const start = () => {
          active += 1;
          void fn().then(resolve, reject).finally(() => {
            active -= 1;
            pump();
          });
        };
        if (active < limit()) start();
        else waiting.push(start);
      });
    },

    exclusive<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
      return lock(chatId).then(async (release) => {
        try {
          return await fn();
        } finally {
          release();
        }
      });
    },

    async *stream<T extends SseEvent>(chatId: string, open: () => AsyncGenerator<T>): AsyncGenerator<T> {
      const release = await lock(chatId);
      try {
        yield* open();
      } finally {
        release();
      }
    },
  };
}

export type TurnCoordinator = ReturnType<typeof createTurnCoordinator>;
