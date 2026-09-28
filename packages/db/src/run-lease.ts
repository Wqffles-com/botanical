/** How long an executing process may hold a run or delivery before another process may reap it. */
export const RUN_LEASE_MS = 2 * 60 * 1000;

/** How often the executing process extends the lease while the turn is still running. */
export const RUN_LEASE_RENEW_MS = 30 * 1000;

export const INTERRUPTED_STOPPED = "interrupted: server stopped";

/**
 * A live lease (expiry strictly after `now`) is kept.
 * An expired lease is reaped.
 * A row that never received a lease is reaped once it is older than the lease window.
 */
export function shouldReapLease(input: {
  leaseExpiresAt: string | null;
  ageAnchor: string;
  now: Date;
  windowMs?: number;
}): boolean {
  const nowMs = input.now.getTime();
  if (input.leaseExpiresAt) {
    const expires = Date.parse(input.leaseExpiresAt);
    return Number.isFinite(expires) && expires <= nowMs;
  }
  const age = Date.parse(input.ageAnchor);
  if (!Number.isFinite(age)) return false;
  return nowMs - age >= (input.windowMs ?? RUN_LEASE_MS);
}
