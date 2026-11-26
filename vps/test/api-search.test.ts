import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { buildSearchText } from '../src/ingest/text.js';

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

interface SearchCorpus {
  database: TestDatabase;
  app: FastifyInstance;
  classifieds: number;
  jobs: number;
  cyrillic: number;
  niksic: number;
}

let current: SearchCorpus | null = null;

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

async function setup(): Promise<SearchCorpus> {
  const database = await createTestDatabase('tele-lenta-api-search-');
  const { db, store } = database;
  const app = buildApp({
    db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET },
  });
  seedUser(db);

  const classifiedsSource = seedSource(db, {
    username: 'classifieds_src',
    title: 'Classifieds',
    sectionHint: 'classifieds',
  });
  const jobsSource = seedSource(db, {
    username: 'jobs_src',
    title: 'Jobs',
    sectionHint: 'jobs',
  });

  const classifieds = seedCluster(db, store, [
    {
      sourceId: classifiedsSource,
      messageId: 1,
      publishedAt: at(1),
      title: 'Stan',
      textNormalized: 'prodajem stan u podgorici',
      searchText: buildSearchText({
        title: 'Stan',
        textNormalized: 'prodajem stan u podgorici',
        city: 'Podgorica',
      }),
      city: 'Podgorica',
    },
  ]);

  const jobs = seedCluster(db, store, [
    {
      sourceId: jobsSource,
      messageId: 2,
      publishedAt: at(2),
      section: 'jobs',
      title: 'Posao',
      textNormalized: 'posao u podgorici',
      searchText: buildSearchText({
        title: 'Posao',
        textNormalized: 'posao u podgorici',
        city: 'Podgorica',
      }),
      city: 'Podgorica',
    },
  ]);

  const cyrillic = seedCluster(db, store, [
    {
      sourceId: classifiedsSource,
      messageId: 3,
      publishedAt: at(3),
      title: 'Квартира',
      textNormalized: 'продам квартиру в подгорице',
      searchText: buildSearchText({
        title: 'Квартира',
        textNormalized: 'продам квартиру в подгорице',
        city: 'Podgorica',
      }),
      city: 'Podgorica',
    },
  ]);

  const niksic = seedCluster(db, store, [
    {
      sourceId: classifiedsSource,
      messageId: 4,
      publishedAt: at(4),
      title: 'Stan Nikšić',
      textNormalized: 'prodajem stan u niksicu',
      searchText: buildSearchText({
        title: 'Stan Nikšić',
        textNormalized: 'prodajem stan u niksicu',
        city: 'Nikšić',
      }),
      city: 'Nikšić',
    },
  ]);

  current = { database, app, classifieds, jobs, cyrillic, niksic };
  return current;
}

async function search(
  corpus: SearchCorpus,
  query: string,
): Promise<{ statusCode: number; body: any }> {
  const response = await injectSigned(corpus.app, { url: `/v1/feed?${query}` });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('GET /v1/feed search', () => {
  it('finds the Latin city from a Cyrillic query and vice versa', async () => {
    const corpus = await setup();

    const cyrillicQuery = await search(corpus, `q=${encodeURIComponent('Подгорица')}`);
    assert.equal(cyrillicQuery.statusCode, 200);
    assert.equal(cyrillicQuery.body.total, 3);
    assert.deepEqual(
      cyrillicQuery.body.cards.map((card: { id: number }) => card.id).sort((a: number, b: number) => a - b),
      [corpus.classifieds, corpus.jobs, corpus.cyrillic].sort((a, b) => a - b),
    );

    const latinQuery = await search(corpus, 'q=Podgorica');
    assert.equal(latinQuery.body.total, 3);
  });

  it('is case-insensitive, diacritic-insensitive, and matches inflected substrings', async () => {
    const corpus = await setup();

    const upper = await search(corpus, 'q=PODGORICA');
    assert.equal(upper.body.total, 3);

    for (const query of ['Nikšić', 'niksic', 'NIKŠIĆ']) {
      const { body } = await search(corpus, `q=${encodeURIComponent(query)}`);
      assert.equal(body.total, 1, query);
      assert.equal(body.cards[0].id, corpus.niksic);
    }

    // «Подгорице»/«podgorici» inflect; a substring still meets them.
    const inflected = await search(corpus, 'q=podgoric');
    assert.equal(inflected.body.total, 3);
  });

  it('searches across sections by default and narrows with section', async () => {
    const corpus = await setup();

    const all = await search(corpus, 'q=podgoric');
    assert.equal(all.body.total, 3);

    const jobs = await search(corpus, 'q=podgoric&section=jobs');
    assert.equal(jobs.body.total, 1);
    assert.equal(jobs.body.cards[0].id, corpus.jobs);
  });

  it('rejects a query shorter than two normalized characters', async () => {
    const corpus = await setup();

    for (const query of ['q=a', 'q=a%3F', 'q=%3F%3F']) {
      const { statusCode, body } = await search(corpus, query);
      assert.equal(statusCode, 400, query);
      assert.equal(body.error.code, 'invalid_request', query);
    }

    const absent = await search(corpus, 'q=');
    assert.equal(absent.statusCode, 200);
    assert.equal(absent.body.total, 4);
  });

  it('caps a long query at 100 characters instead of failing', async () => {
    const corpus = await setup();
    const long = 'z'.repeat(150);

    const { statusCode, body } = await search(corpus, `q=${long}`);
    assert.equal(statusCode, 200);
    assert.equal(body.total, 0);
  });
});
