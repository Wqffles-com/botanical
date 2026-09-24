import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DeploymentMode } from "./config.js";

export function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export type SessionBody = {
  exp: number;
  mode: DeploymentMode;
  v: 1;
};

export function signSession(secret: string, ttlSeconds: number, mode: DeploymentMode, nowSeconds = now()): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: nowSeconds + ttlSeconds, mode, v: 1 } satisfies SessionBody),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(secret: string, token: string, nowSeconds = now()): SessionBody | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionBody>;
    if (body.v !== 1 || (body.mode !== "self_host" && body.mode !== "saas")) return null;
    if (typeof body.exp !== "number" || body.exp < nowSeconds) return null;
    return { exp: body.exp, mode: body.mode, v: 1 };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, maxAge: number, secure: boolean, clear = false): string {
  const parts = [
    `botanical_session=${clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}
