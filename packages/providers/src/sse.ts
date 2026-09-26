export interface SseMessage {
  event: string | null;
  data: string;
}

/**
 * Incremental SSE decoder. Holds a trailing CR so `\r\n` split across chunks
 * still delimits events.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingCr = false;

  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += normalizeNewlines(decoder.decode(value, { stream: true }), () => pendingCr, (next) => {
        pendingCr = next;
      });
      buffer = yield* drainEvents(buffer);
    }
    buffer += normalizeNewlines(decoder.decode(), () => pendingCr, (next) => {
      pendingCr = next;
    });
    if (pendingCr) buffer += "\n";
    buffer = yield* drainEvents(buffer);
    if (buffer.trim().length > 0) {
      const message = parseSseBlock(buffer);
      if (message) yield message;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function normalizeNewlines(
  chunk: string,
  getPending: () => boolean,
  setPending: (value: boolean) => void,
): string {
  let text = chunk;
  if (getPending()) {
    text = `\r${text}`;
    setPending(false);
  }
  if (text.endsWith("\r")) {
    setPending(true);
    text = text.slice(0, -1);
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function* drainEvents(buffer: string): Generator<SseMessage, string> {
  let rest = buffer;
  while (true) {
    const sep = rest.indexOf("\n\n");
    if (sep === -1) return rest;
    const raw = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    const message = parseSseBlock(raw);
    if (message) yield message;
  }
}

function parseSseBlock(raw: string): SseMessage | null {
  const lines = raw.split("\n");
  let event: string | null = null;
  const data: string[] = [];
  let sawData = false;
  for (const line of lines) {
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      sawData = true;
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!sawData) return null;
  return { event, data: data.join("\n") };
}
