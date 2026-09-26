export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MIN_TIMEOUT_MS = 100;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_MAX_STDIN_BYTES = 64 * 1024;
export const DEFAULT_MAX_CODE_BYTES = 200_000;
export const DEFAULT_MAX_COMMAND_BYTES = 100_000;
/** Cap the writable jail root so a runaway process cannot fill the host disk via `/`. */
export const ROOT_TMPFS_SIZE = "32m";
export const TMP_TMPFS_SIZE = "64m";
export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_NOFILE = 1024;

export interface ResolvedLimits {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  maxStdinBytes: number;
  maxCodeBytes: number;
  maxCommandBytes: number;
  maxFileBytes: number;
  nofile: number;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readPositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Model-supplied timeout. Values above the operator max are clamped.
 * Values below the minimum are rejected by the caller.
 */
export function resolveTimeoutMs(
  requested: unknown,
  limits: Pick<ResolvedLimits, "defaultTimeoutMs" | "maxTimeoutMs">,
): { timeoutMs: number; clamped: boolean } {
  if (requested == null) {
    return { timeoutMs: limits.defaultTimeoutMs, clamped: false };
  }
  if (typeof requested !== "number" || !Number.isInteger(requested)) {
    throw new Error("timeout_ms must be an integer");
  }
  if (requested < MIN_TIMEOUT_MS) {
    throw new Error(`timeout_ms must be >= ${MIN_TIMEOUT_MS}`);
  }
  if (requested > limits.maxTimeoutMs) {
    return { timeoutMs: limits.maxTimeoutMs, clamped: true };
  }
  return { timeoutMs: requested, clamped: false };
}
