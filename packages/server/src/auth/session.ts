import { createHash, randomBytes } from "node:crypto";
import type { ServerConfig } from "../config.ts";
import type { Session, Store } from "../types.ts";

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

export async function resolveSession(
  request: Request,
  store: Store,
  config: ServerConfig,
  now: Date,
): Promise<Session | null> {
  const bearer = readBearer(request.headers.get("authorization"));
  const token = bearer ?? readCookie(request.headers.get("cookie"), config.cookieName);
  if (!token) return null;
  const session = await store.sessions.getByTokenHash(hashToken(token));
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= now.getTime()) {
    await store.sessions.delete(session.id);
    return null;
  }
  return session;
}
