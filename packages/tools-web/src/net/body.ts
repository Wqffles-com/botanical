export interface LimitedBody {
  bytes: Uint8Array;
  truncated: boolean;
}

/** Read at most `maxBytes`. Further bytes are discarded and `truncated` is set. */
export async function readBodyLimited(response: Response, maxBytes: number): Promise<LimitedBody> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffered = new Uint8Array(await response.arrayBuffer());
    if (buffered.byteLength <= maxBytes) return { bytes: buffered, truncated: false };
    return { bytes: buffered.subarray(0, maxBytes), truncated: true };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    const room = maxBytes - received;
    if (value.byteLength > room) {
      if (room > 0) chunks.push(value.subarray(0, room));
      received = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

type TextEncoding = NonNullable<ConstructorParameters<typeof TextDecoder>[0]>;

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  const charset = match?.[1]?.trim() || "utf-8";
  try {
    return new TextDecoder(charset as TextEncoding).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function mediaType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = Math.min(bytes.length, 1024);
  for (let i = 0; i < sample; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
