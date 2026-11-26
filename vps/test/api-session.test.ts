import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import type { Store } from '../src/store/index.js';

import {
  TEST_FIRST_NAME,
  TEST_SHARED_SECRET,
  TEST_USER_ID,
  TEST_USERNAME,
  injectSigned,
  seedUser,
} from './helpers/auth.js';
import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedSource } from './helpers/seed.js';

const T0 = Date.parse('2026-11-05T12:00:00.000Z');

interface SessionCorpus {
  database: TestDatabase;
  app: FastifyInstance;
  db: Db;
  store: Store;
  clock: { now: () => number; advance: (ms: number) => void };
}

let current: SessionCorpus | null = null;

async function setup(): Promise<SessionCorpus> {
  const database = await createTestDatabase('tele-lenta-api-session-');
  let now = T0;
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const app = buildApp({
    db: database.db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET, now: clock.now },
  });

  seedSource(database.db, { username: 'enabled_one', title: 'One' });
  seedSource(database.db, { username: 'enabled_two', title: 'Two', sectionHint: 'jobs' });
  seedSource(database.db, { username: 'disabled_one', title: 'Off', enabled: false });

  current = { database, app, db: database.db, store: database.store, clock };
  return current;
}

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

function session(
  corpus: SessionCorpus,
  options: { userId?: number; body?: unknown; url?: string; method?: string } = {},
) {
  return injectSigned(corpus.app, {
    method: options.method ?? 'POST',
    url: options.url ?? '/v1/session',
    body: options.body ?? { username: TEST_USERNAME, first_name: TEST_FIRST_NAME },
    userId: options.userId ?? TEST_USER_ID,
    timestamp: Math.floor(corpus.clock.now() / 1000),
  });
}

function userRow(corpus: SessionCorpus): Record<string, unknown> | undefined {
  return corpus.db
    .prepare('SELECT * FROM users WHERE telegram_user_id = ?')
    .get(TEST_USER_ID) as Record<string, unknown> | undefined;
}

describe('POST /v1/session', () => {
  it('records an unknown profile and still denies it until the owner allows it', async () => {
    const corpus = await setup();

    assert.equal(userRow(corpus), undefined);

    const denied = await session(corpus);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'not_invited');

    const row = userRow(corpus);
    assert.ok(row !== undefined);
    assert.equal(row.telegram_user_id, TEST_USER_ID);
    assert.equal(row.username, TEST_USERNAME);
    assert.equal(row.first_name, TEST_FIRST_NAME);
    assert.equal(row.allowed, 0);
    assert.equal(row.last_seen_at, new Date(T0).toISOString());

    // The owner finds the recorded attempt by id and allows it.
    assert.equal(corpus.store.users.allow(TEST_USER_ID), true);

    const allowed = await session(corpus);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().allowed, true);
  });

  it('returns the documented session shape with defaults', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    const response = await session(corpus);
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      'allowed',
      'digest_interval_seconds',
      'enabled_source_count',
      'retention_days',
      'settings',
    ]);
    assert.equal(body.allowed, true);
    assert.equal(body.enabled_source_count, 2);
    assert.equal(body.retention_days, 30);
    assert.equal(body.digest_interval_seconds, 1800);
    assert.deepEqual(body.settings, {
      digest_enabled: true,
      quiet_start: '23:00',
      quiet_end: '08:00',
      spam_filter: true,
      ad_filter: false,
    });
  });

  it('updates last_seen_at and the profile on a second call', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    const first = await session(corpus);
    assert.equal(first.statusCode, 200);

    corpus.clock.advance(60_000);
    const second = await session(corpus, {
      body: { username: 'new_username', first_name: 'Новое имя' },
    });
    assert.equal(second.statusCode, 200);

    const row = userRow(corpus);
    assert.ok(row !== undefined);
    assert.equal(row.last_seen_at, new Date(T0 + 60_000).toISOString());
    assert.equal(row.username, 'new_username');
    assert.equal(row.first_name, 'Новое имя');
    assert.equal(row.allowed, 1);
  });

  it('clears digest_undeliverable_at on a successful upsert', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });
    corpus.db
      .prepare('UPDATE users SET digest_undeliverable_at = ? WHERE telegram_user_id = ?')
      .run('2026-11-04T09:00:00.000Z', TEST_USER_ID);

    assert.equal(userRow(corpus)?.digest_undeliverable_at, '2026-11-04T09:00:00.000Z');

    const response = await session(corpus);
    assert.equal(response.statusCode, 200);
    assert.equal(userRow(corpus)?.digest_undeliverable_at, null);
  });

  it('never changes allowed or the settings from the request', async () => {
    const corpus = await setup();
    corpus.db
      .prepare(
        `INSERT INTO users
           (telegram_user_id, allowed, digest_enabled, quiet_start, quiet_end,
            spam_filter, ad_filter, created_at)
         VALUES (?, 1, 0, '22:00', '07:30', 0, 1, ?)`,
      )
      .run(TEST_USER_ID, new Date(T0).toISOString());

    const response = await session(corpus, {
      body: {
        username: TEST_USERNAME,
        first_name: TEST_FIRST_NAME,
        allowed: false,
        digest_enabled: true,
        quiet_start: '01:00',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().settings, {
      digest_enabled: false,
      quiet_start: '22:00',
      quiet_end: '07:30',
      spam_filter: false,
      ad_filter: true,
    });
    assert.equal(userRow(corpus)?.allowed, 1);
  });

  it('accepts a body id that matches the signed id and rejects a mismatch', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    const matching = await session(corpus, {
      body: { id: TEST_USER_ID, first_name: TEST_FIRST_NAME },
    });
    assert.equal(matching.statusCode, 200);

    const other = await session(corpus, {
      userId: 2_003_004_005,
      body: { id: TEST_USER_ID, first_name: TEST_FIRST_NAME },
    });
    assert.equal(other.statusCode, 400);
    assert.equal(other.json().error.code, 'invalid_request');
  });

  it('rejects a body that is not a JSON object', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: true });

    const response = await session(corpus, { body: ['not', 'an', 'object'] });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
  });

  it('denies a recorded but disallowed profile on every later call, keeping its data', async () => {
    const corpus = await setup();
    seedUser(corpus.db, TEST_USER_ID, { allowed: false });

    const denied = await session(corpus);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'not_invited');

    const row = userRow(corpus);
    assert.equal(row?.allowed, 0);
    assert.equal(row?.first_name, TEST_FIRST_NAME);
  });
});
