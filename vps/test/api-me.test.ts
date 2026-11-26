import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import {
  TEST_SHARED_SECRET,
  TEST_USER_ID,
  injectSigned,
  seedUser,
} from './helpers/auth.js';
import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

interface Corpus {
  database: TestDatabase;
  app: FastifyInstance;
  db: Db;
}

let current: Corpus | null = null;

async function setup(prefix = 'tele-lenta-api-me-'): Promise<Corpus> {
  const database = await createTestDatabase(prefix);
  const app = buildApp({
    db: database.db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET },
  });
  seedUser(database.db);
  current = { database, app, db: database.db };
  return current;
}

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

describe('GET /v1/me', () => {
  it('returns the profile and the row defaults', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, { url: '/v1/me' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      telegram_user_id: TEST_USER_ID,
      username: 'beta_tester',
      first_name: 'Тест',
      allowed: true,
      digest_enabled: true,
      quiet_start: '23:00',
      quiet_end: '08:00',
      spam_filter: true,
      ad_filter: false,
    });
  });

  it('rejects an unsigned request', async () => {
    const { app } = await setup();

    const response = await app.inject({ method: 'GET', url: '/v1/me' });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
  });

  it('denies a user who is not allowlisted', async () => {
    const { app, db } = await setup();
    db.prepare('UPDATE users SET allowed = 0 WHERE telegram_user_id = ?').run(TEST_USER_ID);

    const response = await injectSigned(app, { url: '/v1/me' });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'not_invited');
  });
});

describe('PATCH /v1/me', () => {
  it('patches each setting and returns the new state', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, {
      url: '/v1/me',
      method: 'PATCH',
      body: {
        digest_enabled: false,
        quiet_start: '22:15',
        quiet_end: '07:45',
        spam_filter: false,
        ad_filter: true,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().digest_enabled, false);
    assert.equal(response.json().quiet_start, '22:15');
    assert.equal(response.json().quiet_end, '07:45');
    assert.equal(response.json().spam_filter, false);
    assert.equal(response.json().ad_filter, true);
    assert.equal(response.json().telegram_user_id, TEST_USER_ID);

    const read = await injectSigned(app, { url: '/v1/me' });
    assert.equal(read.json().quiet_start, '22:15');
  });

  it('keeps unpatched settings untouched', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, {
      url: '/v1/me',
      method: 'PATCH',
      body: { ad_filter: true },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ad_filter, true);
    assert.equal(response.json().digest_enabled, true);
    assert.equal(response.json().quiet_start, '23:00');
    assert.equal(response.json().spam_filter, true);
  });

  it('never lets the body change the allowlist bit', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, {
      url: '/v1/me',
      method: 'PATCH',
      body: { allowed: false, digest_enabled: false },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().allowed, true);
    assert.equal(response.json().digest_enabled, false);
  });

  it('rejects a malformed quiet hour as invalid_request', async () => {
    const { app } = await setup();

    for (const body of [
      { quiet_start: '24:00' },
      { quiet_end: '8:00' },
      { quiet_start: '23:60' },
      { quiet_start: 'soon' },
      { quiet_end: 800 },
      { digest_enabled: 'yes' },
      { spam_filter: 1 },
    ]) {
      const response = await injectSigned(app, {
        url: '/v1/me',
        method: 'PATCH',
        body,
      });
      assert.equal(response.statusCode, 400, `body ${JSON.stringify(body)} must be rejected`);
      assert.equal(response.json().error.code, 'invalid_request');
    }

    const unchanged = await injectSigned(app, { url: '/v1/me' });
    assert.equal(unchanged.json().quiet_start, '23:00');
  });

  it('accepts the day boundary on both quiet hours', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, {
      url: '/v1/me',
      method: 'PATCH',
      body: { quiet_start: '00:00', quiet_end: '23:59' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().quiet_start, '00:00');
    assert.equal(response.json().quiet_end, '23:59');
  });
});
