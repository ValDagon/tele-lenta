import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import { buildApp } from '../src/app.js';
import type { RateLimitConfig } from '../src/auth/rate-limit.js';
import type { Db } from '../src/db.js';

import {
  TEST_FIRST_NAME,
  TEST_SHARED_SECRET,
  TEST_USER_ID,
  TEST_USERNAME,
  injectSigned,
  seedUser,
  signedRequest,
} from './helpers/auth.js';
import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

const T0 = Date.parse('2026-11-05T12:00:00.000Z');
const OTHER_USER_ID = 2_003_004_005;

interface Clock {
  now: () => number;
  advance: (ms: number) => void;
}

function fixedClock(start = T0): Clock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

interface AuthCorpus {
  database: TestDatabase;
  app: FastifyInstance;
  db: Db;
  clock: Clock;
}

let current: AuthCorpus | null = null;

async function setup(options: {
  rateLimit?: Partial<RateLimitConfig>;
  logger?: FastifyServerOptions['logger'];
} = {}): Promise<AuthCorpus> {
  const database = await createTestDatabase('tele-lenta-api-auth-');
  const clock = fixedClock();
  const app = buildApp({
    db: database.db,
    logger: options.logger ?? false,
    auth: {
      sharedSecret: TEST_SHARED_SECRET,
      now: clock.now,
      ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    },
  });
  current = { database, app, db: database.db, clock };
  return current;
}

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

function signed(
  corpus: AuthCorpus,
  options: {
    url: string;
    method?: string;
    body?: unknown;
    userId?: number | string;
    secret?: string;
    timestamp?: number;
  },
) {
  return injectSigned(corpus.app, {
    timestamp: Math.floor(corpus.clock.now() / 1000),
    ...options,
  });
}

const ROUTES: ReadonlyArray<{ method: string; url: string; body?: unknown }> = [
  { method: 'GET', url: '/v1/feed' },
  { method: 'GET', url: '/v1/cards/1' },
  { method: 'GET', url: '/v1/sources' },
  { method: 'POST', url: '/v1/session', body: { first_name: 'Иван' } },
];

function assertEnvelope(body: unknown, code: string, status: number, actual: number): void {
  assert.equal(actual, status);
  assert.deepEqual(Object.keys(body as object), ['error'], 'the envelope has one key');
  const error = (body as { error: Record<string, unknown> }).error;
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message']);
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
}

describe('/v1 authentication', () => {
  it('rejects a request with no signed headers on every route', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    for (const route of ROUTES) {
      const response = await corpus.app.inject({
        method: route.method as 'GET',
        url: route.url,
        ...(route.body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(route.body) }),
      });
      assertEnvelope(response.json(), 'invalid_request', 400, response.statusCode);
    }
  });

  it('rejects a partially signed request', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });
    const { headers } = signedRequest({
      url: '/v1/feed',
      userId: TEST_USER_ID,
      timestamp: Math.floor(corpus.clock.now() / 1000),
    });

    for (const missing of ['x-tl-user', 'x-tl-timestamp', 'x-tl-signature'] as const) {
      const partial = { ...headers };
      delete (partial as Record<string, string>)[missing];
      const response = await corpus.app.inject({ method: 'GET', url: '/v1/feed', headers: partial });
      assertEnvelope(response.json(), 'invalid_request', 400, response.statusCode);
    }
  });

  it('rejects a bad signature on every route', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    for (const route of ROUTES) {
      const response = await signed(corpus, {
        ...route,
        secret: 'a-different-secret-that-is-long-enough',
      });
      assertEnvelope(response.json(), 'init_data_invalid', 401, response.statusCode);
    }
  });

  it('rejects the 61st second of skew in either direction and accepts 60', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });
    const now = Math.floor(corpus.clock.now() / 1000);

    const stale = await signed(corpus, { url: '/v1/feed', timestamp: now - 61 });
    assertEnvelope(stale.json(), 'init_data_expired', 401, stale.statusCode);

    const future = await signed(corpus, { url: '/v1/feed', timestamp: now + 61 });
    assertEnvelope(future.json(), 'init_data_expired', 401, future.statusCode);

    const boundary = await signed(corpus, { url: '/v1/feed', timestamp: now - 60 });
    assert.equal(boundary.statusCode, 200);
  });

  it('rejects a malformed timestamp or user id as invalid_request', async () => {
    const corpus = await setup();
    const { headers } = signedRequest({ url: '/v1/feed', userId: TEST_USER_ID });

    const badTime = await corpus.app.inject({
      method: 'GET',
      url: '/v1/feed',
      headers: { ...headers, 'x-tl-timestamp': '2026-11-05T12:00:00Z' },
    });
    assertEnvelope(badTime.json(), 'invalid_request', 400, badTime.statusCode);

    const badUser = await corpus.app.inject({
      method: 'GET',
      url: '/v1/feed',
      headers: { ...headers, 'x-tl-user': '01' },
    });
    assertEnvelope(badUser.json(), 'invalid_request', 400, badUser.statusCode);
  });

  it('answers not_invited when the user row is missing', async () => {
    const corpus = await setup();

    for (const route of ROUTES.filter((entry) => entry.url !== '/v1/session')) {
      const response = await signed(corpus, { ...route, userId: OTHER_USER_ID });
      assertEnvelope(response.json(), 'not_invited', 403, response.statusCode);
    }
  });

  it('answers not_invited for an existing row with allowed = 0 on every route', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: false });

    for (const route of ROUTES) {
      const response = await signed(corpus, route);
      assertEnvelope(response.json(), 'not_invited', 403, response.statusCode);
    }
  });

  it('serves every route for an allowed user', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    assert.equal((await signed(corpus, { url: '/v1/feed' })).statusCode, 200);
    assert.equal((await signed(corpus, { url: '/v1/sources' })).statusCode, 200);

    const missingCard = await signed(corpus, { url: '/v1/cards/999' });
    assertEnvelope(missingCard.json(), 'not_found', 404, missingCard.statusCode);

    const session = await signed(corpus, {
      method: 'POST',
      url: '/v1/session',
      body: { first_name: TEST_FIRST_NAME },
    });
    assert.equal(session.statusCode, 200);
  });

  it('keeps /health public', async () => {
    const corpus = await setup();
    const response = await corpus.app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
  });
});

describe('signature binding and replay', () => {
  it('rejects a signature made for one user when the header names another', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });
    seedUser(corpus.db, OTHER_USER_ID, { allowed: true });

    // Signed for TEST_USER_ID, then the header is swapped to another allowed
    // user; the MAC covers the id, so it cannot follow the swap.
    const { headers } = signedRequest({
      url: '/v1/feed',
      userId: TEST_USER_ID,
      timestamp: Math.floor(corpus.clock.now() / 1000),
    });
    const response = await corpus.app.inject({
      method: 'GET',
      url: '/v1/feed',
      headers: { ...headers, 'x-tl-user': String(OTHER_USER_ID) },
    });

    assertEnvelope(response.json(), 'init_data_invalid', 401, response.statusCode);
  });

  it('rejects the same signed request after the body changes', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    const { headers } = signedRequest({
      method: 'POST',
      url: '/v1/session',
      body: { first_name: 'Иван' },
      userId: TEST_USER_ID,
      timestamp: Math.floor(corpus.clock.now() / 1000),
    });

    const tampered = await corpus.app.inject({
      method: 'POST',
      url: '/v1/session',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify({ first_name: 'Не Иван' }),
    });

    assertEnvelope(tampered.json(), 'init_data_invalid', 401, tampered.statusCode);
  });

  it('accepts the identical signed request twice (no nonce cache in v1)', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    const first = await signed(corpus, { url: '/v1/feed' });
    const second = await signed(corpus, { url: '/v1/feed' });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
  });
});

describe('/v1 rate limits', () => {
  it('allows 60 requests per user and answers rate_limited for the 61st', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    for (let request = 1; request <= 60; request += 1) {
      const response = await signed(corpus, { url: '/v1/feed' });
      assert.equal(response.statusCode, 200, `request ${request}`);
    }

    const limited = await signed(corpus, { url: '/v1/feed' });
    assertEnvelope(limited.json(), 'rate_limited', 429, limited.statusCode);
  });

  it('enforces the global limit across users', async () => {
    const corpus = await setup({ rateLimit: { perUserLimit: 10, globalLimit: 3 } });
    for (const id of [1, 2, 3, 4]) seedUser(corpus.db, id, { allowed: true });

    for (const id of [1, 2, 3]) {
      assert.equal((await signed(corpus, { url: '/v1/feed', userId: id })).statusCode, 200);
    }

    const limited = await signed(corpus, { url: '/v1/feed', userId: 4 });
    assertEnvelope(limited.json(), 'rate_limited', 429, limited.statusCode);
  });

  it('does not count requests rejected for authentication', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    for (let request = 0; request < 70; request += 1) {
      const rejected = await signed(corpus, {
        url: '/v1/feed',
        secret: 'a-different-secret-that-is-long-enough',
      });
      assert.equal(rejected.statusCode, 401);
    }

    const accepted = await signed(corpus, { url: '/v1/feed' });
    assert.equal(accepted.statusCode, 200);
  });
});

describe('denial logging', () => {
  it('logs the Telegram id and display name, never the secret or initData', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const corpus = await setup({ logger: { level: 'info', stream } });
    seedUser(corpus.db, TEST_USER_ID, {
      allowed: false,
      username: TEST_USERNAME,
      firstName: TEST_FIRST_NAME,
    });

    const initData = 'query_id=AAHdF6IQ&hash=deadbeef12345678';
    const response = await signed(corpus, {
      method: 'POST',
      url: '/v1/session',
      body: { first_name: TEST_FIRST_NAME, init_data: initData },
    });
    assert.equal(response.statusCode, 403);

    await corpus.app.close();
    const output = chunks.join('');

    assert.match(output, /"code":"not_invited"/);
    assert.ok(output.includes(`"telegram_user_id":${TEST_USER_ID}`));
    assert.ok(output.includes(`"display_name":"${TEST_FIRST_NAME}"`));
    assert.ok(!output.includes(TEST_SHARED_SECRET), 'the shared secret must never be logged');
    assert.ok(!output.includes('deadbeef'), 'initData must never be logged');
    assert.ok(!output.includes('query_id'), 'initData must never be logged');
    assert.ok(!output.includes('x-tl-signature'), 'headers must never be logged');

    // The app is closed here; the shared afterEach close is idempotent.
    current = null;
    await closeTestDatabase(corpus.database);
  });
});
