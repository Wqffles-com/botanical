/** Counts failed logins per client key inside a sliding window. */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  isAllowed(key: string): boolean {
    return this.recent(key).length < this.maxFailures;
  }

  recordFailure(key: string): void {
    const recent = this.recent(key);
    recent.push(Date.now());
    this.failures.set(key, recent);
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const windowStart = Date.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((stamp) => stamp > windowStart);
  }
}
