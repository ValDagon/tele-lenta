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

const OTHER_USER_ID = 900_800_700;

interface Corpus {
  database: TestDatabase;
  app: FastifyInstance;
  db: Db;
}

let current: Corpus | null = null;

async function setup(prefix = 'tele-lenta-api-saved-'): Promise<Corpus> {
  const database = await createTestDatabase(prefix);
  const app = buildApp({
    db: database.db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET },
  });
  seedUser(database.db);
  seedUser(database.db, OTHER_USER_ID, { username: 'other', firstName: 'Другой' });
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

async function createSearch(
  app: FastifyInstance,
  data: Record<string, unknown>,
): Promise<{ statusCode: number; body: any }> {
  const response = await injectSigned(app, {
    url: '/v1/saved-searches',
    method: 'POST',
    body: data,
  });
  return { statusCode: response.statusCode, body: response.body === '' ? null : response.json() };
}

describe('saved searches API', () => {
  it('rejects an unsigned request', async () => {
    const { app } = await setup();

    const response = await app.inject({ method: 'GET', url: '/v1/saved-searches' });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
  });

  it('lists an empty array for a new user', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, { url: '/v1/saved-searches' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), []);
  });

  it('creates a search and returns it in the list', async () => {
    const { app } = await setup();

    const created = await createSearch(app, {
      name: 'Квартира в Подгорице',
      query: 'квартира',
      section: 'classifieds',
      categories: ['real_estate'],
      demand: 'offer',
      sources: [2, 5],
      enabled: true,
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.body.name, 'Квартира в Подгорице');
    assert.equal(created.body.query, 'квартира');
    assert.equal(created.body.section, 'classifieds');
    assert.deepEqual(created.body.categories, ['real_estate']);
    assert.equal(created.body.demand, 'offer');
    assert.deepEqual(created.body.sources, [2, 5]);
    assert.equal(created.body.enabled, true);
    assert.equal(created.body.last_sent_at, null);
    assert.equal(created.body.last_checked_at, created.body.created_at);
    assert.equal(created.body.user_id, undefined, 'the wire shape carries no user id');

    const list = await injectSigned(app, { url: '/v1/saved-searches' });
    assert.equal(list.statusCode, 200);
    const rows = list.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, created.body.id);
    assert.equal(rows[0].name, 'Квартира в Подгорице');
  });

  it('patches the name and the digest switch, leaving other fields intact', async () => {
    const { app } = await setup();
    const created = await createSearch(app, {
      name: 'Старое',
      query: 'работа',
      section: 'jobs',
      sources: [1],
    });
    assert.equal(created.statusCode, 201);

    const renamed = await injectSigned(app, {
      url: `/v1/saved-searches/${created.body.id}`,
      method: 'PATCH',
      body: { name: 'Новое', enabled: false },
    });

    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().name, 'Новое');
    assert.equal(renamed.json().enabled, false);
    assert.equal(renamed.json().query, 'работа');
    assert.equal(renamed.json().section, 'jobs');
    assert.deepEqual(renamed.json().sources, [1]);
  });

  it('deletes an owned search and reports it once', async () => {
    const { app } = await setup();
    const created = await createSearch(app, { name: 'Удалить' });

    const deleted = await injectSigned(app, {
      url: `/v1/saved-searches/${created.body.id}`,
      method: 'DELETE',
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.json(), { deleted: true });

    const list = await injectSigned(app, { url: '/v1/saved-searches' });
    assert.deepEqual(list.json(), []);

    const again = await injectSigned(app, {
      url: `/v1/saved-searches/${created.body.id}`,
      method: 'DELETE',
    });
    assert.equal(again.statusCode, 404);
    assert.equal(again.json().error.code, 'not_found');
  });

  it('answers invalid_request on the eleventh saved search', async () => {
    const { app } = await setup();

    for (let index = 0; index < 10; index += 1) {
      const created = await createSearch(app, { name: `Поиск ${index}` });
      assert.equal(created.statusCode, 201);
    }

    const eleventh = await createSearch(app, { name: 'Одиннадцатый' });
    assert.equal(eleventh.statusCode, 400);
    assert.equal(eleventh.body.error.code, 'invalid_request');

    const list = await injectSigned(app, { url: '/v1/saved-searches' });
    assert.equal(list.json().length, 10);
  });

  it('hides another user’s search behind not_found', async () => {
    const { app, db } = await setup();
    const foreign = db
      .prepare(
        `INSERT INTO saved_searches (user_id, name, query, created_at)
         VALUES (?, 'Чужой', '', ?)`,
      )
      .run(OTHER_USER_ID, new Date().toISOString());
    const foreignId = Number(foreign.lastInsertRowid);

    const list = await injectSigned(app, { url: '/v1/saved-searches' });
    assert.deepEqual(list.json(), []);

    const patched = await injectSigned(app, {
      url: `/v1/saved-searches/${foreignId}`,
      method: 'PATCH',
      body: { name: 'Захват' },
    });
    assert.equal(patched.statusCode, 404);
    assert.equal(patched.json().error.code, 'not_found');

    const deleted = await injectSigned(app, {
      url: `/v1/saved-searches/${foreignId}`,
      method: 'DELETE',
    });
    assert.equal(deleted.statusCode, 404);
    assert.equal(deleted.json().error.code, 'not_found');
  });

  it('rejects malformed bodies with invalid_request', async () => {
    const { app } = await setup();

    const cases: Array<Record<string, unknown>> = [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 'ok', categories: 'real_estate' },
      { name: 'ok', categories: ['not_a_category'] },
      { name: 'ok', sources: 'nope' },
      { name: 'ok', sources: [0] },
      { name: 'ok', sources: [1.5] },
      { name: 'ok', section: 'everything' },
      { name: 'ok', demand: 'maybe' },
      { name: 'ok', enabled: 'yes' },
      { name: 'ok', query: 42 },
    ];

    for (const body of cases) {
      const response = await createSearch(app, body);
      assert.equal(
        response.statusCode,
        400,
        `body ${JSON.stringify(body)} must be rejected`,
      );
      assert.equal(response.body.error.code, 'invalid_request');
    }

    const notAnObject = await injectSigned(app, {
      url: '/v1/saved-searches',
      method: 'POST',
      body: [1, 2, 3],
    });
    assert.equal(notAnObject.statusCode, 400);
  });

  it('deduplicates categories and sources instead of failing', async () => {
    const { app } = await setup();

    const created = await createSearch(app, {
      name: 'Дубли',
      categories: ['auto', 'auto', 'goods'],
      sources: [4, 4, 9],
    });

    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.body.categories, ['auto', 'goods']);
    assert.deepEqual(created.body.sources, [4, 9]);
  });

  it('rejects a non-numeric id as invalid_request', async () => {
    const { app } = await setup();

    const response = await injectSigned(app, {
      url: '/v1/saved-searches/abc',
      method: 'DELETE',
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_request');
  });

  it('denies a user who is not allowlisted', async () => {
    const { app } = await setup();
    // The seeded default user is allowed; flip it off instead of adding a row.
    const db = current!.db;
    db.prepare('UPDATE users SET allowed = 0 WHERE telegram_user_id = ?').run(TEST_USER_ID);

    const list = await injectSigned(app, { url: '/v1/saved-searches' });
    assert.equal(list.statusCode, 403);
    assert.equal(list.json().error.code, 'not_invited');

    const create = await createSearch(app, { name: 'Нельзя' });
    assert.equal(create.statusCode, 403);
  });
});
