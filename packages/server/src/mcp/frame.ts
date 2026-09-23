const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeFrame(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const frame = new Uint8Array(header.byteLength + body.byteLength);
  frame.set(header, 0);
  frame.set(body, header.byteLength);
  return frame;
}

/** Incremental decoder for stdio MCP frames (LSP-style Content-Length headers). */
export class FrameDecoder {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  push(chunk: Uint8Array): unknown[] {
    this.buffer = concat(this.buffer, chunk);
    const messages: unknown[] = [];
    while (this.buffer.length > 0) {
      const headerEnd = indexOfHeaderEnd(this.buffer);
      if (headerEnd < 0) break;
      const header = decoder.decode(this.buffer.subarray(0, headerEnd));
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match?.[1]) throw new Error("MCP frame is missing Content-Length");
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      const json = decoder.decode(this.buffer.subarray(bodyStart, bodyStart + length));
      this.buffer = this.buffer.subarray(bodyStart + length);
      messages.push(JSON.parse(json) as unknown);
    }
    return messages;
  }
}

export interface SseEvent {
  event?: string;
  data: string;
}

export function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) events.push({ ...(event ? { event } : {}), data: data.join("\n") });
  }
  return events;
}

function indexOfHeaderEnd(buffer: Uint8Array): number {
  for (let i = 0; i <= buffer.length - 4; i += 1) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}
