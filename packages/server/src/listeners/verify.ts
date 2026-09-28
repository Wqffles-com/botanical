import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SHA256_PREFIX = /^sha256=([0-9a-f]{64})$/i;

/**
 * Listener secrets are random and stored in full. HMAC needs the original bytes,
 * so hashing them at rest would make verification impossible. Database access
 * is secret access.
 */
export function generateListenerSecret(): string {
  return randomBytes(32).toString("base64url");
}

export interface WebhookVerification {
  headers: Headers;
  rawBody: Uint8Array;
  secret: string;
}

/**
 * Accept either an HMAC of the raw body or a bearer/token header.
 * Comparison is constant-time. A missing or bad credential is the same failure.
 */
export function verifyWebhook(input: WebhookVerification): boolean {
  const botanical = input.headers.get("x-botanical-signature");
  const hub = input.headers.get("x-hub-signature-256");
  if (botanical && verifyHmac(botanical, input.secret, input.rawBody)) return true;
  if (hub && verifyHmac(hub, input.secret, input.rawBody)) return true;
  const bearer = bearerToken(input.headers.get("authorization"));
  if (bearer && safeEqual(bearer, input.secret)) return true;
  const token = input.headers.get("x-botanical-token");
  if (token && safeEqual(token.trim(), input.secret)) return true;
  return false;
}

function verifyHmac(header: string, secret: string, body: Uint8Array): boolean {
  const match = SHA256_PREFIX.exec(header.trim());
  if (!match?.[1]) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return safeEqual(match[1].toLowerCase(), expected.toLowerCase());
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
