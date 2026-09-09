import { Injectable } from '@nestjs/common';
import { TooManyRequestsException } from '../common/http/app-error';

/**
 * Per-instance sliding-window rate limiter for auth endpoints (doc 18 §4:
 * strictest limits on /auth/**). In-memory is correct for the single-instance
 * development/test topology; production multi-instance deployments will swap
 * this for the Redis sliding-window store (upgrade path documented in the
 * traceability doc).
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, number[]>();

  /** Assert the caller is under `max` hits in the last `windowMs`; else 429. */
  async check(key: string, max: number, windowMs: number): Promise<void> {
    const now = Date.now();
    const hits = (this.buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      this.buckets.set(key, hits);
      throw new TooManyRequestsException();
    }
    hits.push(now);
    this.buckets.set(key, hits);
  }

  reset(): void {
    this.buckets.clear();
  }
}
