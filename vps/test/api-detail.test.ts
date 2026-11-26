import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';

import { TEST_SHARED_SECRET, injectSigned, seedUser } from './helpers/auth.js';
import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource } from './helpers/seed.js';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T08:00:00.000Z');
const at = (hours: number): string => new Date(T0 + hours * HOUR).toISOString();

interface DetailCorpus {
  database: TestDatabase;
  app: FastifyInstance;
  visible: number;
  hidden: number;
  sources: { rent: number; events: number; disabled: number };
}

let current: DetailCorpus | null = null;

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

async function setup(): Promise<DetailCorpus> {
  const database = await createTestDatabase('tele-lenta-api-detail-');
  const { db, store } = database;
  const app = buildApp({
    db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET },
    // These fixtures predate the probe and must not touch the network.
    detailProbe: null,
  });
  seedUser(db);

  const rent = seedSource(db, {
    username: 'rent_src',
    title: 'Rent Source',
    accessStatus: 'public',
  });
  const events = seedSource(db, {
    username: 'events_src',
    title: 'Events Source',
    sectionHint: 'events',
    accessStatus: 'invite',
  });
  const disabled = seedSource(db, { username: 'off_src', enabled: false });

  const visible = seedCluster(db, store, [
    {
      sourceId: rent,
      messageId: 1,
      publishedAt: at(1),
      messageStatus: 'deleted',
      title: 'Удалённый первый',
      textRaw: 'Старое объявление',
    },
    {
      sourceId: rent,
      messageId: 2,
      publishedAt: at(2),
      title: 'Актуальное объявление',
      textRaw: 'Сдам квартиру #Квартира #ремонт\n\nПодробности в личке.',
      city: 'Podgorica',
      priceRaw: '650 €',
      priceValue: 650,
      priceCurrency: 'EUR',
      pricePeriod: '/мес',
      photos: [
        { url: 'https://cdn1.telesco.pe/file/one.jpg', width: 800, height: 600 },
        { url: 'https://cdn1.telesco.pe/file/two.jpg', width: 1024, height: 768 },
      ],
    },
    {
      sourceId: events,
      messageId: 3,
      publishedAt: at(3),
      title: 'Дубль',
      textRaw: 'Сдам квартиру #ремонт',
    },
  ]);

  const hidden = seedCluster(db, store, [
    {
      sourceId: rent,
      messageId: 10,
      publishedAt: at(5),
      messageStatus: 'deleted',
      title: 'Скрытый',
    },
  ]);

  current = { database, app, visible, hidden, sources: { rent, events, disabled } };
  return current;
}

async function detail(corpus: DetailCorpus, id: string | number): Promise<{
  statusCode: number;
  body: any;
}> {
  const response = await injectSigned(corpus.app, { url: `/v1/cards/${id}` });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('GET /v1/cards/{id}', () => {
  it('returns full text, photos, read-time hashtags, and the source trail', async () => {
    const corpus = await setup();

    const { statusCode, body } = await detail(corpus, corpus.visible);

    assert.equal(statusCode, 200);
    assert.equal(body.id, corpus.visible);
    assert.equal(body.title, 'Актуальное объявление');
    assert.equal(body.earliest_published_at, at(1));
    assert.equal(body.body, 'Сдам квартиру #Квартира #ремонт\n\nПодробности в личке.');
    assert.deepEqual(body.hashtags, ['квартира', 'ремонт']);
    assert.deepEqual(body.photos, [
      { url: 'https://cdn1.telesco.pe/file/one.jpg', width: 800, height: 600 },
      { url: 'https://cdn1.telesco.pe/file/two.jpg', width: 1024, height: 768 },
    ]);
    assert.deepEqual(body.photo, { url: 'https://cdn1.telesco.pe/file/one.jpg', count: 2 });
    assert.deepEqual(body.price, { raw: '650 €', value: 650, currency: 'EUR', period: '/мес' });
    assert.equal(body.source_count, 2);

    assert.equal(body.sources.length, 3);
    const [first, second, third] = body.sources;

    assert.equal(first.message_status, 'deleted');
    assert.equal(first.is_first, true);
    assert.equal(first.published_at, at(1));
    assert.equal(first.message_url, 'https://t.me/source/1');
    assert.equal(first.access, 'public');
    assert.equal(first.name, 'Rent Source');
    assert.equal(first.monogram, 'RS');

    assert.equal(second.message_status, 'available');
    assert.equal(second.is_first, false);
    assert.equal(second.published_at, at(2));

    assert.equal(third.source_id, corpus.sources.events);
    assert.equal(third.access, 'invite');
    assert.equal(third.name, 'Events Source');
    assert.equal(third.is_first, false);
  });

  it('answers not_found for a hidden cluster and an unknown id', async () => {
    const corpus = await setup();

    const hidden = await detail(corpus, corpus.hidden);
    assert.equal(hidden.statusCode, 404);
    assert.equal(hidden.body.error.code, 'not_found');

    const unknown = await detail(corpus, 999_999);
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.body.error.code, 'not_found');
  });

  it('rejects a non-numeric id with invalid_request', async () => {
    const corpus = await setup();

    for (const id of ['abc', '1.5', '-2']) {
      const { statusCode, body } = await detail(corpus, id);
      assert.equal(statusCode, 400, id);
      assert.equal(body.error.code, 'invalid_request', id);
    }
  });
});

describe('GET /v1/sources', () => {
  it('returns only enabled sources with the filter-sheet fields', async () => {
    const corpus = await setup();

    const response = await injectSigned(corpus.app, { url: '/v1/sources' });
    assert.equal(response.statusCode, 200);

    const body = response.json();
    assert.deepEqual(
      body.sources.map((source: { username: string }) => source.username),
      ['rent_src', 'events_src'],
    );
    assert.deepEqual(body.sources[0], {
      id: corpus.sources.rent,
      username: 'rent_src',
      name: 'Rent Source',
      monogram: 'RS',
      kind: 'group',
      section: 'classifieds',
    });
    assert.equal(body.sources[1].section, 'events');
    assert.ok(
      !body.sources.some(
        (source: { username: string }) => source.username === 'off_src',
      ),
    );
  });
});
