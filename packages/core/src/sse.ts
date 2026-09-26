import { coerceStreamEvent } from "./normalize";
import type { ChatStreamEvent } from "./types";

export type StreamEncoding = "sse" | "ndjson";

export function encodingFromContentType(contentType: string): StreamEncoding | null {
  const ct = contentType.toLowerCase();
  if (ct.includes("text/event-stream")) return "sse";
  if (ct.includes("ndjson") || ct.includes("jsonl") || ct.includes("x-json-stream")) return "ndjson";
  return null;
}

/** Parse one SSE frame (no trailing blank line required). Returns null for comments and empty frames. */
export function parseSseFrame(frame: string): ChatStreamEvent | null {
  let eventName = "";
  const dataLines: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = (colon === -1 ? line : line.slice(0, colon)).trim();
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value.trim();
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n").trim();
  if (!data) return null;
  if (data === "[DONE]") return { type: "done" };
  try {
    return coerceStreamEvent(JSON.parse(data) as unknown, eventName);
  } catch {
    if (eventName === "error") return { type: "error", error: data };
    if (eventName === "done" || eventName === "finish") return { type: "done" };
    return { type: "text-delta", text: data };
  }
}

export function parseNdjsonLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (trimmed === "[DONE]") return { type: "done" };
  if (trimmed.startsWith("data:")) return parseSseFrame(trimmed);
  try {
    return coerceStreamEvent(JSON.parse(trimmed) as unknown);
  } catch {
    return { type: "text-delta", text: trimmed };
  }
}

function sniffEncoding(buffer: string): StreamEncoding | null {
  const trimmed = buffer.trimStart();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "ndjson";
  if (trimmed.startsWith("data:") || trimmed.startsWith("event:") || trimmed.startsWith(":")) return "sse";
  return null;
}

/**
 * Read a fetch response body as Botanical chat events.
 * Honors `Content-Type` when it says SSE or NDJSON. Otherwise sniffs the first bytes.
 */
export async function* readChatStream(
  body: ReadableStream<Uint8Array>,
  contentType = "",
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let encoding = encodingFromContentType(contentType);

  const takeEvents = function* (final: boolean): Generator<ChatStreamEvent> {
    if (!encoding) {
      encoding = sniffEncoding(buffer);
      if (!encoding) return;
    }
    if (encoding === "ndjson") {
      const lines = buffer.split(/\r?\n/);
      buffer = final ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const event = parseNdjsonLine(line);
        if (event) yield event;
      }
      if (final && buffer.trim()) {
        const event = parseNdjsonLine(buffer);
        buffer = "";
        if (event) yield event;
      }
      return;
    }
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) yield event;
    }
    if (final && buffer.trim()) {
      const event = parseSseFrame(buffer);
      buffer = "";
      if (event) yield event;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* takeEvents(false);
    }
    buffer += decoder.decode();
    yield* takeEvents(true);
  } finally {
    reader.releaseLock();
  }
}
