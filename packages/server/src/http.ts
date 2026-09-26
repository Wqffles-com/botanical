import type { ServerConfig } from "./config.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export function jsonError(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export async function readJson(request: Request, config: ServerConfig): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > config.maxBodyBytes) {
      throw new HttpError(413, "payload_too_large", "Request body is too large");
    }
  }
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const text = await request.text();
  if (text.length > config.maxBodyBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large");
  }
  if (text.trim() === "") {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy the response once, adding security and optional CORS headers. */
export function finish(response: Response, config: ServerConfig): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  if (config.corsOrigin) {
    headers.set("access-control-allow-origin", config.corsOrigin);
    headers.set("access-control-allow-credentials", "true");
    const vary = headers.get("vary");
    headers.set("vary", vary ? `${vary}, Origin` : "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function sessionCookie(token: string, config: ServerConfig): string {
  const parts = [
    `${config.cookieName}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${config.sessionTtlSeconds}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(config: ServerConfig): string {
  const parts = [
    `${config.cookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}
