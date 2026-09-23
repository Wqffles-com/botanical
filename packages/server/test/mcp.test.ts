import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createMcpToolSource } from "@botanical/core";
import { FrameDecoder, encodeFrame } from "../src/mcp/frame";
import { McpManager } from "../src/mcp/manager";

describe("MCP frame codec", () => {
  test("round-trips a unicode payload split across chunks", () => {
    const frame = encodeFrame({ jsonrpc: "2.0", id: 1, method: "ping", params: { text: "葉" } });
    const decoder = new FrameDecoder();
    expect(decoder.push(frame.subarray(0, 10))).toEqual([]);
    expect(decoder.push(frame.subarray(10))).toEqual([
      { jsonrpc: "2.0", id: 1, method: "ping", params: { text: "葉" } },
    ]);
  });

  test("decodes two frames from one chunk", () => {
    const first = encodeFrame({ id: 1 });
    const second = encodeFrame({ id: 2 });
    const combined = new Uint8Array(first.byteLength + second.byteLength);
    combined.set(first, 0);
    combined.set(second, first.byteLength);
    const decoded = new FrameDecoder().push(combined) as Array<{ id: number }>;
    expect(decoded.map((message) => message.id)).toEqual([1, 2]);
  });
});

describe("MCP transports", () => {
  test("streamable HTTP lists and calls a namespaced tool", async () => {
    let session: string | null = null;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          id?: number;
          method?: string;
          params?: { name?: string; arguments?: { text?: string } };
        };
        if (body.method === "initialize") {
          session = "sess-1";
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id,
              result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock", version: "0" } },
            },
            { headers: { "mcp-session-id": session } },
          );
        }
        if (req.headers.get("mcp-session-id") !== session) {
          return new Response("missing session", { status: 400 });
        }
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "tools/list") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "ping",
                  description: "Ping",
                  inputSchema: { type: "object", properties: { text: { type: "string" } } },
                },
              ],
            },
          });
        }
        if (body.method === "tools/call") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: `pong:${body.params?.arguments?.text ?? ""}` }], isError: false },
          });
        }
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "nope" } });
      },
    });

    const manager = McpManager.fromConfig({
      servers: [{ id: "remote", transport: "http", url: `http://127.0.0.1:${server.port}/mcp` }],
    });
    try {
      const source = createMcpToolSource(manager);
      const tools = await source.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["mcp.remote.ping"]);
      const result = await source.call("mcp.remote.ping", { text: "hi" }, { agentId: "ada", chatId: "chat" });
      expect(result).toEqual({ output: "pong:hi", isError: false });
      expect(await manager.status()).toEqual([{ id: "remote", ok: true, toolCount: 1 }]);
    } finally {
      await manager.close();
      server.stop(true);
    }
  });

  test("legacy SSE transport completes the handshake and a tool call", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/sse") {
          const stream = new ReadableStream<Uint8Array>({
            start(streamController) {
              controller = streamController;
              streamController.enqueue(encoder.encode("event: endpoint\ndata: /messages?session=1\n\n"));
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream" } });
        }
        if (req.method === "POST" && url.pathname === "/messages") {
          return req.json().then((raw: unknown) => {
            const body = raw as { id?: number; method?: string; params?: { arguments?: { text?: string } } };
            let result: unknown;
            if (body.method === "initialize") {
              result = { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sse", version: "0" } };
            } else if (body.method === "tools/list") {
              result = { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: {} } }] };
            } else if (body.method === "tools/call") {
              result = { content: [{ type: "text", text: `sse:${body.params?.arguments?.text ?? ""}` }], isError: false };
            }
            if (body.id != null && result !== undefined) {
              controller?.enqueue(
                encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`),
              );
            }
            return new Response(null, { status: 202 });
          });
        }
        return new Response("nope", { status: 404 });
      },
    });

    const manager = McpManager.fromConfig({
      servers: [{ id: "live", transport: "sse", url: `http://127.0.0.1:${server.port}/sse` }],
    });
    try {
      const source = createMcpToolSource(manager);
      expect((await source.listTools()).map((tool) => tool.name)).toEqual(["mcp.live.echo"]);
      const result = await source.call("mcp.live.echo", { text: "moss" }, { agentId: "ada", chatId: "c" });
      expect(result.output).toBe("sse:moss");
    } finally {
      await manager.close();
      server.stop(true);
    }
  });

  test("stdio transport talks to the echo fixture", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/mcp-echo.ts", import.meta.url));
    const manager = McpManager.fromConfig({
      servers: [{ id: "local", transport: "stdio", command: process.execPath, args: [fixture] }],
    });
    try {
      const source = createMcpToolSource(manager);
      const tools = await source.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["mcp.local.echo"]);
      const result = await source.call("mcp.local.echo", { text: "soil" }, { agentId: "ada", chatId: "c" });
      expect(result).toEqual({ output: "echo:soil", isError: false });
    } finally {
      await manager.close();
    }
  }, { timeout: 20_000 });
});
