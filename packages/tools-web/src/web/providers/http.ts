import { readBodyLimited, decodeBody } from "../../net/body.ts";
import { ToolCallError } from "../../result.ts";
import type { FetchLike } from "../../types.ts";

const PROVIDER_MAX_BYTES = 1_000_000;

export interface JsonRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  fetchImpl: FetchLike;
  signal: AbortSignal;
  userAgent: string;
  secrets: readonly string[];
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

export async function requestJson(options: JsonRequest): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": options.userAgent,
    ...options.headers,
  };
  const response = await options.fetchImpl(options.url, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    redirect: "manual",
    cache: "no-store",
  });

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new ToolCallError(
      "search_failed",
      `Search provider returned HTTP ${response.status} and redirects are not followed.`,
    );
  }

  const limited = await readBodyLimited(response, PROVIDER_MAX_BYTES);
  if (limited.truncated) {
    throw new ToolCallError("search_failed", "Search provider response exceeded the size limit.");
  }
  const text = decodeBody(limited.bytes, response.headers.get("content-type"));
  if (!response.ok) {
    const snippet = redact(text, options.secrets).replace(/\s+/g, " ").trim().slice(0, 300);
    const detail = snippet ? `: ${snippet}` : "";
    throw new ToolCallError("search_failed", `Search provider returned HTTP ${response.status}${detail}.`);
  }
  if (!text.trim()) {
    throw new ToolCallError("search_failed", "Search provider returned an empty response.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolCallError("search_failed", "Search provider returned a non-JSON response.");
  }
}
