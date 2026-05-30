/**
 * Token-bucket rate limiter (Integration Gateway). Connectors call `tryRemove`
 * before each outbound request; it refills continuously at `refillPerSec` up to
 * `capacity`. Pure and clock-injected so it is deterministic in tests.
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSec: number;
  /** Epoch milliseconds; injected for testability (defaults to Date.now). */
  now?: () => number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;
  private tokens: number;
  private last: number;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.now = opts.now ?? (() => Date.now());
    this.tokens = opts.capacity;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.last) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.last = t;
  }

  /** Available tokens right now (after refill). */
  available(): number {
    this.refill();
    return this.tokens;
  }

  /** Remove `n` tokens if available; returns false (without removing) otherwise. */
  tryRemove(n = 1): boolean {
    this.refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
