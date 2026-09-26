import { dispatch, type RpcMessage } from "./protocol.js";

export interface HttpFixture {
  url: string;
  headers: () => Headers | undefined;
  stop: () => void;
}

/** Streamable HTTP MCP server. JSON responses, GET returns 405. */
export function startHttpFixture(): HttpFixture {
  const sessions = new Set<string>();
  let lastHeaders: Headers | undefined;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
      lastHeaders = request.headers;

      if (request.method === "GET") return new Response("method not allowed", { status: 405 });
      if (request.method === "DELETE") {
        sessions.delete(request.headers.get("mcp-session-id") ?? "");
        return new Response(null, { status: 204 });
      }
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

      let message: RpcMessage;
      try {
        message = (await request.json()) as RpcMessage;
      } catch {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
      }

      const session = request.headers.get("mcp-session-id");
      if (message.method === "initialize") {
        const id = crypto.randomUUID();
        sessions.add(id);
        const response = dispatch(message);
        return json(response, 200, { "mcp-session-id": id });
      }
      if (!session || !sessions.has(session)) {
        return json({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32000, message: "session required" } }, 400);
      }
      if (message.id === undefined || message.id === null) return new Response(null, { status: 202 });
      return json(dispatch(message), 200, { "mcp-session-id": session });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    headers: () => lastHeaders,
    stop: () => server.stop(true),
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}
