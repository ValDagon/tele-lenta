/**
 * `GET /v1/cards/{id}` live not-found probe (spec «Edits and deletions»).
 *
 * Every case uses a real temporary SQLite database and a scripted transport:
 * no test sleeps or touches the network. The clock is pinned so "older than 48
 * hours" and the one-second tick throttle are deterministic.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import {
  PolitenessLimiter,
  createPoliteClient,
  type FetchLike,
  type FetchResponse,
  type PoliteClient,
} from '../src/net/polite-client.js';
import type { Store } from '../src/store/index.js';

import { TEST_SHARED_SECRET, injectSigned, seedUser } from './helpers/auth.js';
import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource } from './helpers/seed.js';
import { fixture } from './helpers/tick.js';

const HOUR = 60 * 60 * 1000;
/** Pinned "now" for both the probe and the auth clock. */
const T0 = Date.parse('2026-11-10T12:00:00.000Z');
const at = (hours: number): string => new Date(T0 + hours * HOUR).toISOString();

interface RecordedCall {
  url: string;
  signal: AbortSignal;
  headers: Record<string, string>;
}

interface Recorder {
  client: PoliteClient;
  calls: RecordedCall[];
  /** Every timeout passed to the injected signal factory. */
  timeouts: number[];
}

function makeClient(
  handler: (url: string) => FetchResponse | Promise<FetchResponse>,
  retry?: { maxAttempts: number },
): Recorder {
  const calls: RecordedCall[] = [];
  const timeouts: number[] = [];

  const transport: FetchLike = async (url, init) => {
    calls.push({ url, signal: init.signal, headers: init.headers });
    return handler(url);
  };

  const client = createPoliteClient({
    transport,
    clock: { now: () => T0, sleep: async () => {} },
    random: () => 0,
    limiter: new PolitenessLimiter(2),
    ...(retry === undefined ? {} : { retry }),
    createTimeoutSignal: (ms) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
  });

  return { client, calls, timeouts };
}

function response(status: number, body = ''): FetchResponse {
  return {
    status,
    headers: { get: () => null },
    text: async () => body,
  };
}

function transportError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

interface Corpus {
  database: TestDatabase;
  app: FastifyInstance;
  store: Store;
  recorder: Recorder;
  multi: number;
  single: number;
  newer: number;
  /** `rent_src` listing ids inside the multi-member cluster. */
  firstListingId: number;
}

let current: Corpus | null = null;

afterEach(async () => {
  if (current !== null) {
    await current.app.close();
    await closeTestDatabase(current.database);
    current = null;
  }
});

async function setup(
  handler: (url: string) => FetchResponse | Promise<FetchResponse>,
  options: { retry?: { maxAttempts: number }; recentRunAgeMs?: number } = {},
): Promise<Corpus> {
  const database = await createTestDatabase('tele-lenta-detail-probe-');
  const { db, store } = database;
  seedUser(db);

  const rent = seedSource(db, { username: 'rent_src', title: 'Rent Source' });
  const dup = seedSource(db, { username: 'dup_src', title: 'Dup Source' });

  const multi = seedCluster(db, store, [
    {
      sourceId: rent,
      messageId: 1,
      publishedAt: at(-72),
      title: 'Первый',
      textRaw: 'Сдам квартиру, первый источник',
    },
    {
      sourceId: dup,
      messageId: 2,
      publishedAt: at(-70),
      title: 'Второй',
      textRaw: 'Сдам квартиру, второй источник',
    },
  ]);

  const single = seedCluster(db, store, [
    { sourceId: rent, messageId: 10, publishedAt: at(-72), title: 'Один' },
  ]);

  const newer = seedCluster(db, store, [
    { sourceId: rent, messageId: 20, publishedAt: at(-2), title: 'Свежий' },
  ]);

  if (options.recentRunAgeMs !== undefined) {
    store.ingestRuns.start(rent, new Date(T0 - options.recentRunAgeMs).toISOString());
  }

  const recorder = makeClient(handler, options.retry);
  const app = buildApp({
    db,
    logger: false,
    auth: { sharedSecret: TEST_SHARED_SECRET, now: () => T0 },
    detailProbe: { client: recorder.client },
    config: { userAgent: 'TeleLenta/test', detailProbeTimeoutMs: 2_000 },
  });

  const firstListing = store.listings.find(rent, 1);
  assert.ok(firstListing !== null);

  current = {
    database,
    app,
    store,
    recorder,
    multi,
    single,
    newer,
    firstListingId: firstListing.id,
  };
  return current;
}

async function detail(corpus: Corpus, id: number): Promise<{ status: number; body: any }> {
  const result = await injectSigned(corpus.app, {
    url: `/v1/cards/${id}`,
    timestamp: Math.floor(T0 / 1000),
  });
  return { status: result.statusCode, body: result.json() };
}

describe('GET /v1/cards/{id} detail probe', () => {
  it('marks an old source deleted on 404 and recomputes the cluster bookkeeping', async () => {
    const corpus = await setup(() => response(404));

    const { status, body } = await detail(corpus, corpus.multi);

    assert.equal(status, 200);
    assert.equal(corpus.recorder.calls.length, 1);
    assert.equal(corpus.recorder.calls[0]?.url, 'https://t.me/rent_src/1?embed=1');

    const listing = corpus.store.listings.getById(corpus.firstListingId);
    assert.equal(listing?.messageStatus, 'deleted');

    const cluster = corpus.store.clusters.getCluster(corpus.multi);
    assert.equal(cluster?.availableListingCount, 1);
    assert.equal(cluster?.hidden, false);
    assert.equal(cluster?.listingCount, 2);
    assert.equal(cluster?.earliestPublishedAt, at(-72));

    // The response is re-read: the trail shows the deletion and the card now
    // renders from the next available member.
    assert.equal(body.title, 'Второй');
    assert.equal(body.sources.length, 2);
    assert.equal(body.sources[0].message_status, 'deleted');
    assert.equal(body.sources[0].is_first, true);
    assert.equal(body.sources[1].message_status, 'available');
  });

  it('answers 404 when the probe deletes the only available member', async () => {
    const corpus = await setup(() => response(404));

    const { status, body } = await detail(corpus, corpus.single);

    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');

    const cluster = corpus.store.clusters.getCluster(corpus.single);
    assert.equal(cluster?.availableListingCount, 0);
    assert.equal(cluster?.hidden, true);
  });

  it('treats a 2xx body with «Post not found» exactly like a 404', async () => {
    const corpus = await setup(() => response(200, fixture('not-found.html')));

    const { status, body } = await detail(corpus, corpus.single);

    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
    assert.equal(
      corpus.store.listings.getById(corpus.firstListingId)?.messageStatus,
      'available',
      'the multi cluster representative was not probed for this card',
    );
  });

  it('leaves the row available and the response 200 on 5xx, timeout, network, and parse errors', async () => {
    const cases: Array<[string, () => FetchResponse | Promise<FetchResponse>]> = [
      ['5xx', () => response(503)],
      ['timeout', () => Promise.reject(transportError('TimeoutError'))],
      ['network', () => Promise.reject(new Error('socket hang up'))],
      ['parse error', () => response(200, '<html><body>no widgets</body></html>')],
    ];

    for (const [label, handler] of cases) {
      const corpus = await setup(handler);
      const { status, body } = await detail(corpus, corpus.single);

      assert.equal(status, 200, label);
      assert.equal(body.id, corpus.single, label);
      assert.equal(
        corpus.store.listings.getById(corpus.firstListingId)?.messageStatus,
        'available',
        label,
      );
      assert.equal(corpus.store.clusters.getCluster(corpus.single)?.hidden, false, label);

      await corpus.app.close();
      await closeTestDatabase(corpus.database);
      current = null;
    }
  });

  it('never probes a card newer than 48 hours', async () => {
    const corpus = await setup(() => response(404));

    const { status, body } = await detail(corpus, corpus.newer);

    assert.equal(status, 200);
    assert.equal(body.title, 'Свежий');
    assert.equal(corpus.recorder.calls.length, 0);
  });

  it('uses the configured 2-second timeout and never retries', async () => {
    const corpus = await setup(() => response(500), { retry: { maxAttempts: 3 } });

    const { status } = await detail(corpus, corpus.single);

    assert.equal(status, 200);
    assert.deepEqual(corpus.recorder.timeouts, [2_000]);
    // The per-request budget of 1 blocks the second attempt even though this
    // client was configured to retry.
    assert.equal(corpus.recorder.calls.length, 1);
  });

  it('skips the probe when the tick started a run less than a second ago', async () => {
    const corpus = await setup(() => response(404), { recentRunAgeMs: 500 });

    const { status, body } = await detail(corpus, corpus.single);

    assert.equal(status, 200);
    assert.equal(body.id, corpus.single);
    assert.equal(corpus.recorder.calls.length, 0);
    assert.equal(
      corpus.store.listings.getById(corpus.firstListingId)?.messageStatus,
      'available',
    );
  });

  it('leaves the detail response shape unchanged for a healthy card', async () => {
    const corpus = await setup(() => response(200, fixture('group-text-photos.html')));

    const probed = await detail(corpus, corpus.single);
    assert.equal(probed.status, 200);
    assert.equal(corpus.recorder.calls.length, 1);

    // The same card answered with the probe off is the reference shape.
    const plain = buildApp({
      db: corpus.database.db,
      logger: false,
      auth: { sharedSecret: TEST_SHARED_SECRET, now: () => T0 },
      detailProbe: null,
    });
    try {
      const expected = await injectSigned(plain, {
        url: `/v1/cards/${corpus.single}`,
        timestamp: Math.floor(T0 / 1000),
      });
      assert.equal(expected.statusCode, probed.status);
      assert.deepEqual(probed.body, expected.json());
    } finally {
      await plain.close();
    }
  });
});
