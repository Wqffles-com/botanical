export interface McpTransport {
  start(): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Shared id/pending bookkeeping for transports whose responses arrive out of band. */
export class PendingRequests {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly timeoutMs: number) {}

  register(method: string): { id: number; promise: Promise<unknown> } {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    return { id, promise };
  }

  fail(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  resolveMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const record = message as { id?: number | string; result?: unknown; error?: { message?: string } };
    if (record.id == null) return;
    const id = typeof record.id === "number" ? record.id : Number(record.id);
    if (!Number.isFinite(id)) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (record.error) pending.reject(new Error(record.error.message ?? "MCP error"));
    else pending.resolve(record.result);
  }

  failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
