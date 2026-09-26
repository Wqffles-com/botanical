import type { AgentMessageBus } from "./bus";

/**
 * v0 delivery is a poll: pending rows become delivered on an interval.
 * Inbox injection happens later, when the recipient agent takes a turn
 * (or when a client reads the inbox). This worker never calls a model.
 */
export class DeliveryWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly bus: Pick<AgentMessageBus, "deliverPending">,
    private readonly intervalMs = 1000,
    private readonly limit = 100,
  ) {}

  start(): void {
    if (this.timer) return;
    const timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }
    this.timer = timer;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const delivered = await this.bus.deliverPending({ limit: this.limit });
      return delivered.length;
    } catch (error) {
      console.error("[a2a] delivery tick failed", error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
