/** Read the body up to `max` bytes. Oversized requests are cancelled without buffering the rest. */
export async function readLimitedBytes(
  request: Request,
  max: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared.trim()) || Number(declared) > max) return { ok: false };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export function payloadPreview(bytes: Uint8Array, max = 480): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
