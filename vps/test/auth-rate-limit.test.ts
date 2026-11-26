import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_RATE_LIMIT,
  createRateLimiter,
} from '../src/auth/rate-limit.js';

const WINDOW = 60_000;

function clock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('rate limiter', () => {
  it('ships the spec defaults: 60 per user and 600 globally per minute', () => {
    assert.deepEqual(DEFAULT_RATE_LIMIT, {
      perUserLimit: 60,
      globalLimit: 600,
      windowMs: WINDOW,
    });
  });

  it('allows 60 requests for one user and denies the 61st', () => {
    const time = clock();
    const limiter = createRateLimiter(DEFAULT_RATE_LIMIT, time.now);

    for (let request = 1; request <= 60; request += 1) {
      assert.deepEqual(limiter.check(1), { allowed: true }, `request ${request}`);
      time.advance(100);
    }

    assert.deepEqual(limiter.check(1), { allowed: false, scope: 'user' });
    // Another user is unaffected by one user's bucket.
    assert.deepEqual(limiter.check(2), { allowed: true });
  });

  it('slides the window with the clock instead of resetting on a fixed minute', () => {
    const time = clock();
    const limiter = createRateLimiter({ perUserLimit: 2, globalLimit: 10, windowMs: WINDOW }, time.now);

    assert.deepEqual(limiter.check(1), { allowed: true });
    time.advance(30_000);
    assert.deepEqual(limiter.check(1), { allowed: true });
    assert.deepEqual(limiter.check(1), { allowed: false, scope: 'user' });

    // The first request expires at 60 s, freeing exactly one slot.
    time.advance(30_000);
    assert.deepEqual(limiter.check(1), { allowed: true });
    assert.deepEqual(limiter.check(1), { allowed: false, scope: 'user' });

    // At 90 s the request from 30 s has expired, so one slot is free again.
    time.advance(30_000);
    assert.deepEqual(limiter.check(1), { allowed: true });
    assert.deepEqual(limiter.check(1), { allowed: false, scope: 'user' });

    // At 120 s the request from 60 s expires; the 90 s one is still inside.
    time.advance(30_000);
    assert.deepEqual(limiter.check(1), { allowed: true });
    assert.deepEqual(limiter.check(1), { allowed: false, scope: 'user' });
  });

  it('denies the 601st request across users at the global limit', () => {
    const time = clock();
    const limiter = createRateLimiter(DEFAULT_RATE_LIMIT, time.now);

    // Ten users with sixty requests each fill the global bucket.
    for (let user = 1; user <= 10; user += 1) {
      for (let request = 0; request < 60; request += 1) {
        assert.deepEqual(limiter.check(user), { allowed: true }, `user ${user}`);
      }
    }

    assert.deepEqual(limiter.check(11), { allowed: false, scope: 'global' });

    time.advance(WINDOW);
    assert.deepEqual(limiter.check(11), { allowed: true });
  });

  it('does not count a rejected request against either bucket', () => {
    const time = clock();
    const limiter = createRateLimiter({ perUserLimit: 1, globalLimit: 2, windowMs: WINDOW }, time.now);

    assert.deepEqual(limiter.check(1), { allowed: true });
    assert.deepEqual(limiter.check(1), { allowed: false, scope: 'user' });
    // The rejected attempt did not consume the global slot.
    assert.deepEqual(limiter.check(2), { allowed: true });
    assert.deepEqual(limiter.check(3), { allowed: false, scope: 'global' });
  });

  it('forgets every bucket on reset', () => {
    const time = clock();
    const limiter = createRateLimiter({ perUserLimit: 1, globalLimit: 1, windowMs: WINDOW }, time.now);

    assert.deepEqual(limiter.check(1), { allowed: true });
    assert.deepEqual(limiter.check(2), { allowed: false, scope: 'global' });

    limiter.reset();
    assert.deepEqual(limiter.check(2), { allowed: true });
  });
});
