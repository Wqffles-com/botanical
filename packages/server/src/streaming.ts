export interface SseEvent {
  event: string;
  data: unknown;
}

export function textDeltas(text: string, size = 24): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

export function encodeSse(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function sseResponse(events: readonly SseEvent[]): Response {
  return sseStream((async function* () {
    yield* events;
  })());
}

/**
 * An SSE comment is sent while no event has gone out for this long. Bun.serve
 * closes a connection after 10s without traffic (`idleTimeout` default), and
 * proxies in front of the API drop idle upstream sockets too. Either one
 * aborts the turn. CLI turns are often silent for longer than that while the
 * CLI looks up or runs tools; slow reasoning models can be as well.
 */
export const SSE_HEARTBEAT_MS = 5_000;

export function sseStream(events: AsyncIterable<SseEvent>, options: { heartbeatMs?: number } = {}): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastWrite = Date.now();
      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          if (Date.now() - lastWrite < heartbeatMs) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
            lastWrite = Date.now();
          } catch {
            // Stream already closed or cancelled.
          }
        }, Math.max(10, Math.floor(heartbeatMs / 3)));
        heartbeat.unref?.();
      }
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeSse(event)));
          lastWrite = Date.now();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "The model request failed";
        controller.enqueue(
          encoder.encode(encodeSse({ event: "error", data: { type: "error", error: message, code: "internal_error" } })),
        );
        controller.enqueue(encoder.encode(encodeSse({ event: "done", data: { type: "done" } })));
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
}
