/**
 * In-memory sliding-window rate limit for authenticated `/v1/*` requests:
 * 60 per minute per user and 600 per minute across all users (spec «API and
 * auth»).
 *
 * This is per process. The API is one long-running Fastify process behind
 * Caddy, so a per-process bucket is a per-deployment bucket; a restart empties
 * it. If the API is ever run as more than one process, the limit becomes per
 * process and the effective ceiling multiplies — a shared store would be the
 * fix then, not now.
 *
 * Rejected-for-auth requests never reach the limiter: callers check the
 * signature and the allowlist first, so bad credentials cannot exhaust another
 * user's budget.
 */

export interface RateLimitConfig {
  perUserLimit: number;
  globalLimit: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  perUserLimit: 60,
  globalLimit: 600,
  windowMs: 60_000,
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: 'user' | 'global' };

export interface RateLimiter {
  /** Records the request when it fits both limits and says whether it did. */
  check(telegramUserId: number): RateLimitResult;
  /** Drops all buckets; the rate limit is deliberately not durable. */
  reset(): void;
}

/** Above this many tracked users, empty buckets are swept so memory is bounded. */
const SWEEP_THRESHOLD = 1_024;

function prune(bucket: number[], cutoff: number): void {
  let index = 0;
  while (index < bucket.length && bucket[index]! <= cutoff) index += 1;
  if (index > 0) bucket.splice(0, index);
}

export function createRateLimiter(
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now: () => number = Date.now,
): RateLimiter {
  const perUser = new Map<number, number[]>();
  let global: number[] = [];

  const sweep = (): void => {
    for (const [userId, bucket] of perUser) {
      if (bucket.length === 0) perUser.delete(userId);
    }
    if (global.length === 0) global = [];
  };

  return {
    check(telegramUserId: number): RateLimitResult {
      const nowMs = now();
      const cutoff = nowMs - config.windowMs;

      prune(global, cutoff);
      const bucket = perUser.get(telegramUserId) ?? [];
      prune(bucket, cutoff);

      if (bucket.length >= config.perUserLimit) {
        perUser.set(telegramUserId, bucket);
        return { allowed: false, scope: 'user' };
      }
      if (global.length >= config.globalLimit) {
        perUser.set(telegramUserId, bucket);
        return { allowed: false, scope: 'global' };
      }

      bucket.push(nowMs);
      perUser.set(telegramUserId, bucket);
      global.push(nowMs);

      if (perUser.size > SWEEP_THRESHOLD) sweep();

      return { allowed: true };
    },
    reset(): void {
      perUser.clear();
      global = [];
    },
  };
}
