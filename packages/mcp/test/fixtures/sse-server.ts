import { dispatch, type RpcMessage } from "./protocol.js";

export interface SseFixture {
  url: string;
  headers: () => Headers | undefined;
  stop: () => void;
}

interface Session {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

/** Legacy HTTP+SSE MCP server. POST responses are delivered on the SSE stream. */
export function startSseFixture(): SseFixture {
  const sessions = new Map<string, Session>();
  let lastHeaders: Headers | undefined;
  const encoder = new TextEncoder();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      lastHeaders = request.headers;

      if (request.method === "GET" && url.pathname === "/sse") {
        const id = crypto.randomUUID();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(next) {
            controller = next;
            sessions.set(id, { controller });
            const endpoint = `/messages?sessionId=${id}`;
            next.enqueue(encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
          },
          cancel() {
            sessions.delete(id);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/messages") {
        const id = url.searchParams.get("sessionId") ?? "";
        const session = sessions.get(id);
        if (!session) return new Response("unknown session", { status: 404 });
        return request.json().then((body) => {
          const message = body as RpcMessage;
          const response = dispatch(message);
          if (response) {
            session.controller.enqueue(encoder.encode(`data: ${JSON.stringify(response)}\n\n`));
          }
          return new Response(null, { status: 202 });
        }).catch(() => new Response("bad json", { status: 400 }));
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/sse`,
    headers: () => lastHeaders,
    stop: () => {
      for (const session of sessions.values()) {
        try {
          session.controller.close();
        } catch {
          // Already closed.
        }
      }
      server.stop(true);
    },
  };
}
