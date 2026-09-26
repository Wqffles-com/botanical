import { createHash, timingSafeEqual } from "node:crypto";

import {
  DeploymentConfigError,
  DeploymentConfigErrorCode,
  type DeploymentMode,
  type PasscodeCheck,
  type SingleTenantPasscode,
} from "./types.ts";

const SHA256_PREFIX = "sha256:";

/**
 * Hash a self-host passcode as `sha256:<64 lowercase hex>`.
 * Equivalent to `printf '%s' "$passcode" | sha256sum` with the prefix added.
 */
export function hashPasscode(passcode: string): string {
  const hex = createHash("sha256").update(passcode, "utf8").digest("hex");
  return `${SHA256_PREFIX}${hex}`;
}

/** Accept `sha256:` plus 64 hex chars. Prefix case is ignored. Does not echo the value on failure. */
export function normalizePasscodeHash(value: string): string {
  const match = /^sha256:([\da-fA-F]{64})$/i.exec(value.trim());
  const hex = match?.[1];
  if (hex === undefined) {
    throw new DeploymentConfigError(
      DeploymentConfigErrorCode.InvalidPasscodeHash,
      "BOTANICAL_PASSWORD_HASH must be sha256:<64 hex characters> (SHA-256 of the passcode, no newline).",
    );
  }
  return `${SHA256_PREFIX}${hex.toLowerCase()}`;
}

export function verifySingleTenantPasscode(
  config: { readonly mode: DeploymentMode; readonly passcode: SingleTenantPasscode | null },
  presented: string,
): PasscodeCheck {
  if (config.mode !== "self-host") {
    return { ok: false, reason: "not-single-tenant" };
  }
  if (config.passcode === null) {
    return { ok: false, reason: "missing-passcode" };
  }

  const actual = config.passcode.source === "password" ? presented : hashPasscode(presented);
  return timingSafeEqualString(actual, config.passcode.secret)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
