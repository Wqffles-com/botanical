import { FrameDecoder, encodeFrame } from "./frame";
import { PendingRequests, type McpTransport } from "./transport";

/**
 * Stdio MCP client. Frames follow the Content-Length header encoding from the
 * MCP spec. The command comes from server config, never from the model.
 */
export class StdioMcpTransport implements McpTransport {
  private proc: Bun.Subprocess | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly pending: PendingRequests;
  private stderrTail = "";
  private closing = false;
  private started = false;

  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly env?: Record<string, string>,
    timeoutMs = 30_000,
  ) {
    this.pending = new PendingRequests(timeoutMs);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.proc = Bun.spawn([this.command, ...this.args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv(this.env),
    });
    this.started = true;
    void this.readStderr();
    void this.readStdout();
    void this.proc.exited.then((code) => {
      if (this.closing) return;
      this.pending.failAll(new Error(`MCP stdio process exited (${code}): ${this.stderrTail}`));
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.start();
    const { id, promise } = this.pending.register(method);
    try {
      await this.send({ jsonrpc: "2.0", id, method, params: params ?? {} });
    } catch (error) {
      this.pending.fail(id, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.start();
    await this.send({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.pending.failAll(new Error("MCP connection closed"));
    this.proc?.kill();
    this.proc = null;
  }

  private async send(message: unknown): Promise<void> {
    const stdin = this.proc?.stdin;
    if (!stdin || typeof stdin === "number") throw new Error("MCP stdin is not writable");
    stdin.write(encodeFrame(message));
    await stdin.flush();
  }

  private async readStdout(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === "number") return;
    const reader = stdout.getReader();
    try {
      while (!this.closing) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const message of this.decoder.push(value)) this.pending.resolveMessage(message);
      }
    } catch (error) {
      if (!this.closing) {
        this.pending.failAll(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async readStderr(): Promise<void> {
    const stderr = this.proc?.stderr;
    if (!stderr || typeof stderr === "number") return;
    const reader = stderr.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || total >= 4096) continue;
      chunks.push(value);
      total += value.byteLength;
    }
    this.stderrTail = new TextDecoder().decode(concatBytes(chunks)).slice(0, 4096);
  }
}

function childEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...extra };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
