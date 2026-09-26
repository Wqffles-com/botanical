import { ProviderError, isAbortError, isTimeoutError } from "./errors.ts";

export const USER_AGENT = "botanical-providers/0.0.1";

const FORBIDDEN_HEADERS = new Set(["authorization", "x-api-key", "api-key"]);

export function joinUrl(base: string, path: string): string {
  const left = base.replace(/\/+$/, "");
  const right = path.replace(/^\/+/, "");
  return `${left}/${right}`;
}

export function assertHttpUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError(`${label} is not a valid URL.`, { code: "config" });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProviderError(`${label} must use http or https.`, { code: "config" });
  }
}

export function assertSafeHeaders(headers: Record<string, string> | undefined): void {
  if (!headers) return;
  for (const key of Object.keys(headers)) {
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
      throw new ProviderError(
        `Header "${key}" is not allowed in provider config. API keys come from the server environment.`,
        { code: "config" },
      );
    }
  }
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export async function readBodyLimited(response: Response, limit = 8_192): Promise<string> {
  const text = await response.text();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function combineSignals(signals: AbortSignal[], timeoutMs?: number): AbortSignal | undefined {
  const list = signals.filter((signal) => signal !== undefined);
  if (timeoutMs !== undefined) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new ProviderError("timeoutMs must be a positive number.", { code: "config" });
    }
    list.push(AbortSignal.timeout(timeoutMs));
  }
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return AbortSignal.any(list);
}

export function rethrowTransport(err: unknown, providerId: string, secret?: string): never {
  if (isAbortError(err)) throw err;
  if (isTimeoutError(err)) {
    throw new ProviderError(`Provider "${providerId}" timed out.`, {
      providerId,
      code: "timeout",
      cause: err,
    });
  }
  const message = err instanceof Error ? redactSecrets(err.message, [secret]) : "request failed";
  throw new ProviderError(`Provider "${providerId}" request failed: ${message}`, {
    providerId,
    code: "network",
    cause: err,
  });
}

export function httpError(providerId: string, status: number, body: string, secret?: string): ProviderError {
  const snippet = redactSecrets(body, [secret]).replace(/\s+/g, " ").trim();
  const detail = snippet.length > 0 ? `: ${snippet}` : "";
  return new ProviderError(`Provider "${providerId}" request failed (${status})${detail}`, {
    providerId,
    status,
    code: "http",
  });
}
