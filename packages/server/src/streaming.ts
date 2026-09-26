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

export function sseStream(events: AsyncIterable<SseEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeSse(event)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "The model request failed";
        controller.enqueue(
          encoder.encode(encodeSse({ event: "error", data: { type: "error", error: message, code: "internal_error" } })),
        );
        controller.enqueue(encoder.encode(encodeSse({ event: "done", data: { type: "done" } })));
      } finally {
        controller.close();
      }
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
