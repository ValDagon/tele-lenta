import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import type { Store } from '../src/store/index.js';

import { TEST_SHARED_SECRET, injectSigned, seedUser } from './helpers/auth.js';
import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource, type SeedMemberOptions } from './helpers/seed.js';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T08:00:00.000Z');
const at = (hours: number): string => new Date(T0 + hours * HOUR).toISOString();

interface Corpus {
  database: TestDatabase;
  app: FastifyInstance;
  db: Db;
  store: Store;
  sources: { rent: number; jobs: number; events: number; disabled: number };
  clusters: {
    rent: number;
    job: number;
    event: number;
    partlyDeleted: number;
    multi: number;
    repFromAvailable: number;
    hidden: number;
  };
}

let current: Corpus | null = null;

async function setup(prefix = 'tele-lenta-api-feed-'): Promise<Corpus> {
  const database = await createTestDatabase(prefix);
  const app = buildApp({
    db: database.db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET },
  });
  seedUser(database.db);
  current = {
    database,
    app,
    db: database.db,
    store: database.store,
    sources: { rent: 0, jobs: 0, events: 0, disabled: 0 },
    clusters: {
      rent: 0,
      job: 0,
      event: 0,
      partlyDeleted: 0,
      multi: 0,
      repFromAvailable: 0,
      hidden: 0,
    },
  };
  return current;
}

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

function member(overrides: Partial<SeedMemberOptions> & Pick<SeedMemberOptions, 'sourceId' | 'messageId' | 'publishedAt'>): SeedMemberOptions {
  return { ...overrides };
}

/** The standard corpus: six visible clusters, one hidden, four sources. */
function seedCorpus(corpus: Corpus): void {
  const { db, store } = corpus;
  const rent = seedSource(db, {
    username: 'podgorica_rent',
    title: 'Podgorica Rent',
    sectionHint: 'classifieds',
    lastSuccessAt: at(10),
  });
  const jobs = seedSource(db, {
    username: 'jobs_chat',
    title: 'Jobs Chat',
    sectionHint: 'jobs',
    lastSuccessAt: at(12),
  });
  const events = seedSource(db, {
    username: 'events_chat',
    title: null,
    sectionHint: 'events',
    accessStatus: 'invite',
    lastSuccessAt: at(11),
  });
  const disabled = seedSource(db, {
    username: 'disabled_chat',
    title: 'Disabled Chat',
    enabled: false,
    lastSuccessAt: at(20),
  });
  corpus.sources = { rent, jobs, events, disabled };

  corpus.clusters.rent = seedCluster(db, store, [
    member({
      sourceId: rent,
      messageId: 1,
      publishedAt: at(1),
      title: 'Сдам квартиру',
      category: 'real_estate',
      textRaw: 'Сдам квартиру #Квартира #ремонт',
      city: 'Podgorica',
      priceRaw: '650 €',
      priceValue: 650,
      priceCurrency: 'EUR',
      pricePeriod: '/мес',
      photos: [
        { url: 'https://cdn1.telesco.pe/file/a.jpg', width: 800, height: 600 },
        { url: 'https://cdn1.telesco.pe/file/b.jpg', width: 800, height: 600 },
      ],
    }),
    member({
      sourceId: rent,
      messageId: 2,
      publishedAt: at(1.5),
      title: 'Сдам квартиру (копия)',
    }),
  ]);

  corpus.clusters.job = seedCluster(db, store, [
    member({
      sourceId: jobs,
      messageId: 10,
      publishedAt: at(2),
      section: 'jobs',
      category: 'other',
      demand: 'wanted',
      title: 'Ищу работу',
      salaryRaw: '800 €',
      priceRaw: '800 €',
      priceValue: 800,
      priceCurrency: 'EUR',
    }),
  ]);

  corpus.clusters.event = seedCluster(db, store, [
    member({
      sourceId: events,
      messageId: 20,
      publishedAt: at(3),
      section: 'events',
      category: 'other',
      title: 'Концерт',
      eventStartsAt: at(50),
    }),
  ]);

  corpus.clusters.partlyDeleted = seedCluster(db, store, [
    member({
      sourceId: rent,
      messageId: 30,
      publishedAt: at(4),
      title: 'Доступное объявление',
    }),
    member({
      sourceId: rent,
      messageId: 31,
      publishedAt: at(4.5),
      messageStatus: 'deleted',
      title: 'Удалённое объявление',
    }),
  ]);

  corpus.clusters.multi = seedCluster(db, store, [
    member({ sourceId: rent, messageId: 40, publishedAt: at(5), title: 'Кросс-пост' }),
    member({ sourceId: events, messageId: 41, publishedAt: at(5.5), title: 'Кросс-пост' }),
    member({ sourceId: jobs, messageId: 42, publishedAt: at(6), title: 'Кросс-пост' }),
  ]);

  corpus.clusters.repFromAvailable = seedCluster(db, store, [
    member({
      sourceId: rent,
      messageId: 50,
      publishedAt: at(6.5),
      messageStatus: 'deleted',
      title: 'Удалённый первый',
    }),
    member({
      sourceId: jobs,
      messageId: 51,
      publishedAt: at(7),
      title: 'Заголовок представителя',
      city: 'Nikšić',
    }),
    member({ sourceId: jobs, messageId: 52, publishedAt: at(7.5), title: 'Поздний дубль' }),
  ]);

  corpus.clusters.hidden = seedCluster(db, store, [
    member({
      sourceId: rent,
      messageId: 60,
      publishedAt: at(8),
      messageStatus: 'deleted',
      title: 'Скрытый кластер',
    }),
  ]);
}

async function feed(corpus: Corpus, query = ''): Promise<{
  statusCode: number;
  body: any;
}> {
  const response = await injectSigned(corpus.app, { url: `/v1/feed${query}` });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('GET /v1/feed', () => {
  it('returns one card per visible cluster, newest first, with display fields', async () => {
    const corpus = await setup();
    seedCorpus(corpus);
    const { clusters } = corpus;

    const { statusCode, body } = await feed(corpus);

    assert.equal(statusCode, 200);
    assert.deepEqual(
      body.cards.map((card: { id: number }) => card.id),
      [
        clusters.repFromAvailable,
        clusters.multi,
        clusters.partlyDeleted,
        clusters.event,
        clusters.job,
        clusters.rent,
      ],
    );
    assert.equal(body.total, 6);
    assert.equal(body.next_cursor, null);
    assert.equal(body.updated_at, at(12));

    const rent = body.cards[5];
    assert.equal(rent.section, 'classifieds');
    assert.equal(rent.category, 'real_estate');
    assert.equal(rent.demand, 'offer');
    assert.equal(rent.title, 'Сдам квартиру');
    assert.equal(rent.earliest_published_at, at(1));
    assert.deepEqual(rent.price, { raw: '650 €', value: 650, currency: 'EUR', period: '/мес' });
    assert.equal(rent.city, 'Podgorica');
    assert.deepEqual(rent.photo, { url: 'https://cdn1.telesco.pe/file/a.jpg', count: 2 });
    assert.equal(rent.source_count, 1);
    assert.deepEqual(rent.sources, [
      {
        id: corpus.sources.rent,
        username: 'podgorica_rent',
        name: 'Podgorica Rent',
        monogram: 'PR',
      },
    ]);

    const job = body.cards[4];
    assert.equal(job.section, 'jobs');
    assert.equal(job.salary.raw, '800 €');
    assert.equal(job.price, undefined);
    assert.equal(job.photo, undefined);
    assert.equal(job.city, undefined);

    const event = body.cards[3];
    assert.deepEqual(event.event, { starts_at: at(50) });

    const multi = body.cards[1];
    assert.equal(multi.source_count, 3);
    assert.equal(multi.sources.length, 3);
    assert.deepEqual(
      multi.sources.map((source: { username: string }) => source.username),
      ['podgorica_rent', 'events_chat', 'jobs_chat'],
    );
    assert.equal(multi.sources[1].monogram, 'EC');
  });

  it('never renders a deleted message while an available copy exists', async () => {
    const corpus = await setup();
    seedCorpus(corpus);

    const { body } = await feed(corpus);
    const rep = body.cards.find(
      (card: { id: number }) => card.id === corpus.clusters.repFromAvailable,
    );

    assert.equal(rep.title, 'Заголовок представителя');
    assert.equal(rep.city, 'Nikšić');
    // The cluster's date is the absolute earliest member, deleted included.
    assert.equal(rep.earliest_published_at, at(6.5));
    assert.ok(!body.cards.some((card: { id: number }) => card.id === corpus.clusters.hidden));
  });

  it('applies section, category, demand, source, and combined filters', async () => {
    const corpus = await setup();
    seedCorpus(corpus);
    const { clusters, sources } = corpus;

    const ids = async (query: string): Promise<number[]> => {
      const { body } = await feed(corpus, query);
      return body.cards.map((card: { id: number }) => card.id);
    };

    assert.deepEqual(await ids('?section=jobs'), [clusters.job]);
    assert.deepEqual(await ids('?category=real_estate'), [clusters.rent]);
    assert.deepEqual(await ids('?demand=wanted'), [clusters.job]);
    assert.deepEqual(await ids(`?sources=${sources.rent}`), [
      clusters.repFromAvailable,
      clusters.multi,
      clusters.partlyDeleted,
      clusters.rent,
    ]);
    assert.deepEqual(await ids(`?sources=${sources.events}`), [
      clusters.multi,
      clusters.event,
    ]);
    assert.deepEqual(await ids(`?sources=${sources.rent}&sources=${sources.events}`), [
      clusters.repFromAvailable,
      clusters.multi,
      clusters.partlyDeleted,
      clusters.event,
      clusters.rent,
    ]);
    assert.deepEqual(await ids('?section=classifieds&demand=offer&sources=' + sources.rent), [
      clusters.repFromAvailable,
      clusters.multi,
      clusters.partlyDeleted,
      clusters.rent,
    ]);
  });

  it('computes total for the same filters, including limit=0', async () => {
    const corpus = await setup();
    seedCorpus(corpus);
    const { sources } = corpus;

    const filtered = await feed(corpus, `?sources=${sources.rent}`);
    assert.equal(filtered.body.total, 4);
    assert.equal(filtered.body.cards.length, 4);

    const countOnly = await feed(corpus, `?sources=${sources.rent}&limit=0`);
    assert.equal(countOnly.statusCode, 200);
    assert.deepEqual(countOnly.body.cards, []);
    assert.equal(countOnly.body.next_cursor, null);
    assert.equal(countOnly.body.total, 4);
    assert.equal(countOnly.body.updated_at, at(12));

    const empty = await feed(corpus, '?section=jobs&category=real_estate');
    assert.equal(empty.body.total, 0);
    assert.deepEqual(empty.body.cards, []);
  });

  it('reports updated_at from enabled sources only, and null when none', async () => {
    const corpus = await setup();
    const onlyDisabled = seedSource(corpus.db, {
      username: 'only_disabled',
      enabled: false,
      lastSuccessAt: at(1),
    });
    assert.ok(onlyDisabled > 0);

    const none = await feed(corpus);
    assert.equal(none.body.updated_at, null);

    seedCorpus(corpus);
    const mixed = await feed(corpus);
    assert.equal(mixed.body.updated_at, at(12));
  });

  it('paginates the whole corpus exactly once with the opaque cursor', async () => {
    const corpus = await setup();
    seedCorpus(corpus);

    const full = await feed(corpus);
    const expected = full.body.cards.map((card: { id: number }) => card.id);

    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const { statusCode, body } = await feed(corpus, `?limit=2${suffix}`);
      assert.equal(statusCode, 200);
      assert.equal(body.total, 6);
      seen.push(...body.cards.map((card: { id: number }) => card.id));
      cursor = body.next_cursor;
      pages += 1;
      assert.ok(pages < 10, 'pagination must terminate');
    } while (cursor !== null);

    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, expected.length);
    assert.equal(pages, 3);
  });

  it('clamps a limit above 50 instead of rejecting it', async () => {
    const corpus = await setup('tele-lenta-api-feed-clamp-');
    const source = seedSource(corpus.db, { username: 'bulk', title: 'Bulk' });
    for (let index = 0; index < 55; index += 1) {
      seedCluster(corpus.db, corpus.store, [
        member({
          sourceId: source,
          messageId: 1000 + index,
          publishedAt: at(index / 60),
          title: `Объявление ${index}`,
        }),
      ]);
    }

    const { statusCode, body } = await feed(corpus, '?limit=100');
    assert.equal(statusCode, 200);
    assert.equal(body.cards.length, 50);
    assert.equal(body.total, 55);
    assert.notEqual(body.next_cursor, null);
  });

  it('rejects an invalid cursor, an invalid limit, and a bad section', async () => {
    const corpus = await setup();
    seedCorpus(corpus);

    for (const query of [
      '?cursor=not-a-cursor',
      `?cursor=${Buffer.from('[1]', 'utf8').toString('base64url')}`,
      '?limit=-1',
      '?limit=abc',
      '?limit=1.5',
      '?section=housing',
      '?sources=zero',
    ]) {
      const { statusCode, body } = await feed(corpus, query);
      assert.equal(statusCode, 400, query);
      assert.equal(body.error.code, 'invalid_request', query);
      assert.equal(typeof body.error.message, 'string');
    }
  });

  it('keeps the error envelope and serves /health beside the new routes', async () => {
    const corpus = await setup();

    const health = await corpus.app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, 'ok');

    const missing = await injectSigned(corpus.app, { url: '/v1/nope' });
    assert.equal(missing.statusCode, 404);
    const body = missing.json();
    assert.deepEqual(Object.keys(body), ['error']);
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
    assert.equal(body.error.code, 'not_found');
  });
});
