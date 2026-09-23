import { timingSafeEqual } from "node:crypto";
import type { PasswordAuth } from "../config.ts";

export function timingSafeEqualString(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.byteLength !== b.byteLength) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function verifyPasscode(secret: string, auth: PasswordAuth): Promise<boolean> {
  if (auth.method === "hash") {
    return Bun.password.verify(secret, auth.hash);
  }
  return timingSafeEqualString(secret, auth.password);
}
