import { parseSseEvents } from "./frame";
import { PendingRequests, type McpTransport } from "./transport";

/**
 * MCP streamable HTTP: one POST per JSON-RPC message.
 * Responses are either a JSON body or an SSE body on the same response.
 */
export class HttpMcpTransport implements McpTransport {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly headers?: Record<string, string>,
  ) {}

  async start(): Promise<void> {}

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return this.post({ jsonrpc: "2.0", id, method, params: params ?? {} }, true);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params: params ?? {} }, false);
  }

  async close(): Promise<void> {}

  private async post(message: { id?: number; method: string; params?: unknown; jsonrpc: string }, expectResponse: boolean): Promise<unknown> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.requestHeaders(),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30_000),
    });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!expectResponse) {
      if (!response.ok && response.status !== 202) {
        throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
      }
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("text/event-stream")
      ? rpcFromSse(await response.text(), message.id)
      : ((await response.json()) as unknown);
    return unwrapRpc(payload, message.id);
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2024-11-05",
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
  }
}

/**
 * Legacy MCP HTTP+SSE: a long-lived GET carries responses, POSTs go to the
 * endpoint advertised by the first `endpoint` event.
 */
export class SseMcpTransport implements McpTransport {
  private readonly pending: PendingRequests;
  private readonly abort = new AbortController();
  private postUrl: string | null = null;
  private started: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private closing = false;

  constructor(
    private readonly url: string,
    private readonly headers?: Record<string, string>,
    timeoutMs = 30_000,
  ) {
    this.pending = new PendingRequests(timeoutMs);
  }

  async start(): Promise<void> {
    if (!this.started) {
      this.started = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      void this.connect();
    }
    await this.started;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.start();
    const { id, promise } = this.pending.register(method);
    try {
      await this.post({ jsonrpc: "2.0", id, method, params: params ?? {} });
    } catch (error) {
      this.pending.fail(id, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.start();
    await this.post({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.abort.abort();
    this.rejectReady?.(new Error("MCP connection closed"));
    this.pending.failAll(new Error("MCP connection closed"));
  }

  private async connect(): Promise<void> {
    const timeout = setTimeout(() => {
      this.rejectReady?.(new Error("MCP SSE endpoint timeout"));
    }, 10_000);
    try {
      const response = await fetch(this.url, {
        headers: { ...this.headers, accept: "text/event-stream" },
        signal: this.abort.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`MCP SSE connect failed (${response.status})`);
      }
      await this.readLoop(response.body, timeout);
      if (!this.postUrl && !this.closing) {
        throw new Error("MCP SSE stream ended before the endpoint event");
      }
    } catch (error) {
      clearTimeout(timeout);
      if (!this.closing) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        this.rejectReady?.(wrapped);
        this.pending.failAll(wrapped);
      }
    }
  }

  private async readLoop(body: ReadableStream<Uint8Array>, timeout: ReturnType<typeof setTimeout>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!this.closing) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const event of parseSseEvents(`${part}\n\n`)) {
          if (!this.postUrl && (event.event === "endpoint" || event.data.startsWith("/"))) {
            this.postUrl = new URL(event.data.trim(), this.url).toString();
            clearTimeout(timeout);
            this.resolveReady?.();
            continue;
          }
          if (!event.data.startsWith("{")) continue;
          try {
            this.pending.resolveMessage(JSON.parse(event.data) as unknown);
          } catch {
            // Ignore non-JSON keepalive payloads.
          }
        }
      }
    }
  }

  private async post(message: unknown): Promise<void> {
    if (!this.postUrl) throw new Error("MCP SSE endpoint is not ready");
    const response = await fetch(this.postUrl, {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(message),
      signal: this.abort.signal,
    });
    if (!response.ok && response.status !== 202) {
      throw new Error(`MCP SSE post failed (${response.status}): ${await response.text()}`);
    }
  }
}

function rpcFromSse(text: string, id: number | undefined): unknown {
  const events = parseSseEvents(text);
  const messages = events.map((event) => JSON.parse(event.data) as { id?: number | string });
  return messages.find((message) => message.id === id) ?? messages.at(-1);
}

function unwrapRpc(payload: unknown, id: number | undefined): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as { id?: number | string; result?: unknown; error?: { message?: string } };
  if (id != null && record.id != null && String(record.id) !== String(id) && record.result === undefined && !record.error) {
    return payload;
  }
  if (record.error) throw new Error(record.error.message ?? "MCP error");
  if ("result" in record) return record.result;
  return payload;
}
