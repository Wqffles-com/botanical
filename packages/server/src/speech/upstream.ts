import { HttpError, isRecord } from "../http.ts";
import type { SpeechFetch } from "./types.ts";

export const STT_TIMEOUT_MS = 60_000;

const SNIPPET_MAX = 300;
const READ_MAX = 8_192;

export interface UpstreamRequest {
  provider: string;
  url: string;
  apiKey: string | null;
  body: BodyInit;
  json: boolean;
  fetchImpl?: SpeechFetch;
  timeoutMs?: number;
}

export function speechUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

/**
 * POST to a speech provider. Failures are generic for the client.
 * The API key, the Authorization header, and the upstream body are not returned.
 * A short sanitized snippet is written to the server log.
 */
export async function postSpeech(input: UpstreamRequest): Promise<unknown> {
  const headers = new Headers();
  if (input.apiKey) headers.set("authorization", `Bearer ${input.apiKey}`);
  if (input.json) headers.set("content-type", "application/json");

  const fetchImpl: SpeechFetch = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: "POST",
      headers,
      body: input.body,
      signal: AbortSignal.timeout(input.timeoutMs ?? STT_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = isTimeout(error);
    logUpstreamFailure(input.provider, null, timeout ? "timeout" : "network", input.apiKey);
    throw new HttpError(
      502,
      "transcription_failed",
      timeout ? "Speech transcription timed out" : "Speech transcription failed",
    );
  }

  if (!response.ok) {
    const snippet = await readSnippet(response);
    logUpstreamFailure(input.provider, response.status, snippet, input.apiKey);
    throw new HttpError(502, "transcription_failed", "Speech transcription failed");
  }

  try {
    return await response.json();
  } catch {
    logUpstreamFailure(input.provider, response.status, "invalid json", input.apiKey);
    throw new HttpError(502, "transcription_failed", "Speech transcription failed");
  }
}

/** `{ text: string }` payloads (OpenAI-compatible, OpenRouter, xAI). */
export function requireText(payload: unknown, provider: string): string {
  if (!isRecord(payload) || typeof payload.text !== "string") {
    logUpstreamFailure(provider, 200, "unexpected transcript shape", null);
    throw new HttpError(502, "transcription_failed", "Speech transcription failed");
  }
  return payload.text;
}

export function logUpstreamFailure(
  provider: string,
  status: number | null,
  body: string,
  apiKey: string | null,
): void {
  const snippet = sanitizeSnippet(body, apiKey);
  const statusText = status === null ? "network" : String(status);
  console.warn(
    `[botanical] stt upstream failure provider=${provider} status=${statusText} body=${JSON.stringify(snippet)}`,
  );
}

/** Drop the API key and bearer tokens, then keep at most 300 characters. */
export function sanitizeSnippet(body: string, apiKey: string | null): string {
  let text = body.replaceAll("\u0000", "");
  if (apiKey) text = text.split(apiKey).join("[redacted]");
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  text = text.replace(/authorization\s*[:=]\s*\S+/gi, "authorization=[redacted]");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > SNIPPET_MAX) text = text.slice(0, SNIPPET_MAX);
  return text;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function readSnippet(response: Response): Promise<string> {
  try {
    const buf = await response.arrayBuffer();
    const view = new Uint8Array(buf.byteLength > READ_MAX ? buf.slice(0, READ_MAX) : buf);
    if (looksBinary(view)) return "[binary body omitted]";
    return new TextDecoder("utf-8", { fatal: false }).decode(view);
  } catch {
    return "";
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
