import { writeSync } from "node:fs";
import { FrameDecoder, encodeFrame } from "../../src/mcp/frame";

/**
 * Tiny MCP server used by the stdio client test.
 * Speaks Content-Length frames and exposes a single `echo` tool.
 */
const decoder = new FrameDecoder();

process.stdin.on("data", (chunk: Buffer | string) => {
  const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
  for (const message of decoder.push(bytes)) handle(message);
});

process.stdin.on("end", () => {
  process.exit(0);
});

function handle(message: unknown): void {
  if (!message || typeof message !== "object") return;
  const record = message as {
    id?: number;
    method?: string;
    params?: { name?: string; arguments?: { text?: string } };
  };
  if (record.method === "notifications/initialized") return;
  if (record.id == null) return;

  if (record.method === "initialize") {
    respond(record.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "mcp-echo", version: "0.0.0" },
    });
    return;
  }
  if (record.method === "tools/list") {
    respond(record.id, {
      tools: [
        {
          name: "echo",
          description: "Echo text",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      ],
    });
    return;
  }
  if (record.method === "tools/call") {
    const text = record.params?.arguments?.text ?? "";
    respond(record.id, {
      content: [{ type: "text", text: `echo:${text}` }],
      isError: false,
    });
    return;
  }
  writeSync(
    1,
    encodeFrame({
      jsonrpc: "2.0",
      id: record.id,
      error: { code: -32601, message: `unknown method ${record.method ?? ""}` },
    }),
  );
}

function respond(id: number, result: unknown): void {
  writeSync(1, encodeFrame({ jsonrpc: "2.0", id, result }));
}
