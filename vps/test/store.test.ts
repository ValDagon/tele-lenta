import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  NEGATIVE_CACHE_TTL_MS,
  parserFailureCutoff,
  type NewListing,
} from '../src/store/index.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

const T0 = '2026-11-01T08:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();
const t0 = Date.parse(T0);

let current: TestDatabase | null = null;

afterEach(async () => {
  if (current !== null) {
    await closeTestDatabase(current);
    current = null;
  }
});

async function database(prefix: string): Promise<TestDatabase> {
  current = await createTestDatabase(prefix);
  return current;
}

function listingInput(sourceId: number, messageId: number, overrides: Partial<NewListing> = {}): NewListing {
  return {
    sourceId,
    messageId,
    url: `https://t.me/source/${messageId}`,
    publishedAt: T0,
    fetchedAt: T0,
    textRaw: 'Продам квартиру в Подгорице',
    textNormalized: 'продам квартиру в подгорице',
    searchText: 'продам квартиру в подгорице podgorica',
    contentHash: `hash-${messageId}`,
    title: 'Продам квартиру',
    section: 'classifieds',
    category: 'real_estate',
    demand: 'offer',
    city: 'Podgorica',
    priceRaw: '650 €',
    priceValue: 650,
    priceCurrency: 'EUR',
    pricePeriod: '/мес',
    parserVersion: 'test-1',
    ...overrides,
  };
}

describe('source registry', () => {
  it('seeds the eleven v1 sources disabled with no cursor', async () => {
    const { store } = await database('tele-lenta-store-seed-');

    const sources = store.sources.listAll();
    assert.equal(sources.length, 11);
    assert.deepEqual(
      sources.map((source) => source.username).sort(),
      [
        'baraholka_Monte',
        'jobmonte',
        'monte_Job',
        'monteafisha',
        'montenegro_market',
        'montework',
        'nedviga_montenegro',
        'prodai_montenegro',
        'sale_me_com',
        'saleme_job',
        'sutomoremontenegro',
      ],
    );

    for (const source of sources) {
      assert.equal(source.enabled, false, `${source.username} must start disabled`);
      assert.equal(source.cursorMessageId, null, `${source.username} must start with no cursor`);
      assert.equal(source.region, 'montenegro');
      assert.equal(source.accessStatus, 'public');
      assert.equal(source.consecutiveFailures, 0);
      assert.ok(!Number.isNaN(Date.parse(source.createdAt)));
    }

    assert.deepEqual(store.sources.listEnabled(), []);

    const byName = new Map(sources.map((source) => [source.username, source]));
    assert.equal(byName.get('montework')?.kind, 'channel');
    assert.equal(byName.get('monteafisha')?.kind, 'channel');
    assert.equal(byName.get('montework')?.intervalSeconds, 60);
    assert.equal(byName.get('jobmonte')?.kind, 'group');
    assert.equal(byName.get('jobmonte')?.intervalSeconds, 300);
    assert.equal(byName.get('nedviga_montenegro')?.categoryHint, 'real_estate');
    assert.equal(byName.get('baraholka_Monte')?.categoryHint, 'goods');
    assert.equal(byName.get('sale_me_com')?.categoryHint, null);

    const sections = sources.reduce<Record<string, number>>((counts, source) => {
      counts[source.sectionHint] = (counts[source.sectionHint] ?? 0) + 1;
      return counts;
    }, {});
    assert.deepEqual(sections, { classifieds: 5, jobs: 4, events: 2 });
  });

  it('advances a cursor, counts failures, and records success', async () => {
    const { store } = await database('tele-lenta-store-source-state-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    store.sources.setCursor(source.id, 4_200);
    assert.equal(store.sources.getById(source.id)?.cursorMessageId, 4_200);

    store.sources.recordFailure(source.id, iso(t0));
    store.sources.recordFailure(source.id, iso(t0 + HOUR));
    let reloaded = store.sources.getById(source.id);
    assert.equal(reloaded?.consecutiveFailures, 2);
    assert.equal(reloaded?.lastErrorAt, iso(t0 + HOUR));
    assert.equal(reloaded?.lastSuccessAt, null);

    store.sources.recordSuccess(source.id, iso(t0 + 2 * HOUR));
    reloaded = store.sources.getById(source.id);
    assert.equal(reloaded?.consecutiveFailures, 0);
    assert.equal(reloaded?.lastSuccessAt, iso(t0 + 2 * HOUR));
    assert.equal(reloaded?.lastErrorAt, iso(t0 + HOUR), 'the last error time is history');

    store.sources.setAccessStatus(source.id, 'invite');
    assert.equal(store.sources.getById(source.id)?.accessStatus, 'invite');
  });

  it('toggles the per-source kill switch', async () => {
    const { store } = await database('tele-lenta-store-source-toggle-');
    const source = store.sources.getByUsername('jobmonte');
    assert.ok(source);

    store.sources.setEnabled(source.id, true);
    assert.deepEqual(
      store.sources.listEnabled().map((row) => row.username),
      ['jobmonte'],
    );

    store.sources.setEnabled(source.id, false);
    assert.deepEqual(store.sources.listEnabled(), []);
  });
});

describe('listings', () => {
  it('stores a listing with photos and finds it by its source message key', async () => {
    const { store } = await database('tele-lenta-store-listing-insert-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    const id = store.listings.insert(
      listingInput(source.id, 101, {
        photos: [
          { url: 'https://cdn4.telesco.pe/file/a.jpg', width: 800, height: 600 },
          { url: 'https://cdn4.telesco.pe/file/b.jpg' },
        ],
      }),
    );

    const found = store.listings.find(source.id, 101);
    assert.ok(found);
    assert.equal(found.id, id);
    assert.equal(found.hasPhotos, true);
    assert.equal(found.photoCount, 2);
    assert.equal(found.hasVideo, false);
    assert.equal(found.messageStatus, 'available');
    assert.equal(found.clusterId, null);
    assert.equal(found.priceValue, 650);
    assert.equal(found.pricePeriod, '/мес');

    const photos = store.listings.listPhotos(id);
    assert.deepEqual(
      photos.map((photo) => [photo.position, photo.url, photo.width]),
      [
        [0, 'https://cdn4.telesco.pe/file/a.jpg', 800],
        [1, 'https://cdn4.telesco.pe/file/b.jpg', null],
      ],
    );

    assert.equal(store.listings.find(source.id, 999), null);
  });

  it('refuses a duplicate source message row', async () => {
    const { store } = await database('tele-lenta-store-listing-unique-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    store.listings.insert(listingInput(source.id, 7));
    assert.throws(() => store.listings.insert(listingInput(source.id, 7)), /UNIQUE/);
  });

  it('applies an edit re-check and replaces photos only when given', async () => {
    const { store } = await database('tele-lenta-store-listing-edit-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    const id = store.listings.insert(
      listingInput(source.id, 202, {
        photos: [{ url: 'https://cdn4.telesco.pe/file/old.jpg' }],
      }),
    );

    store.listings.updateFromRecheck(id, {
      textRaw: 'Продам квартиру, цена снижена',
      textNormalized: 'продам квартиру цена снижена',
      searchText: 'продам квартиру цена снижена',
      contentHash: 'hash-edited',
      editedAt: iso(t0 + HOUR),
      title: 'Квартира, цена снижена',
      section: 'classifieds',
      category: 'real_estate',
      demand: 'offer',
      city: 'Podgorica',
      priceRaw: '600 €',
      priceValue: 600,
      priceCurrency: 'EUR',
      pricePeriod: null,
      salaryRaw: null,
      eventStartsAt: null,
      hasPhotos: true,
      hasVideo: false,
      isAd: false,
      isSpam: false,
      fetchedAt: iso(t0 + HOUR),
    });

    let updated = store.listings.getById(id);
    assert.equal(updated?.contentHash, 'hash-edited');
    assert.equal(updated?.priceValue, 600);
    assert.equal(updated?.editedAt, iso(t0 + HOUR));
    assert.deepEqual(
      store.listings.listPhotos(id).map((photo) => photo.url),
      ['https://cdn4.telesco.pe/file/old.jpg'],
      'omitted photos leave the stored set alone',
    );

    store.listings.updateFromRecheck(id, {
      textRaw: 'Продам квартиру, цена снижена',
      textNormalized: 'продам квартиру цена снижена',
      searchText: 'продам квартиру цена снижена',
      contentHash: 'hash-edited',
      editedAt: iso(t0 + HOUR),
      title: 'Квартира, цена снижена',
      section: 'classifieds',
      category: 'real_estate',
      demand: 'offer',
      city: 'Podgorica',
      priceRaw: '600 €',
      priceValue: 600,
      priceCurrency: 'EUR',
      pricePeriod: null,
      salaryRaw: null,
      eventStartsAt: null,
      hasPhotos: true,
      hasVideo: false,
      isAd: false,
      isSpam: false,
      fetchedAt: iso(t0 + HOUR),
      photos: [
        { url: 'https://cdn4.telesco.pe/file/new-1.jpg' },
        { url: 'https://cdn4.telesco.pe/file/new-2.jpg' },
      ],
    });

    updated = store.listings.getById(id);
    assert.equal(updated?.photoCount, 2);
    assert.deepEqual(
      store.listings.listPhotos(id).map((photo) => photo.url),
      ['https://cdn4.telesco.pe/file/new-1.jpg', 'https://cdn4.telesco.pe/file/new-2.jpg'],
    );
  });

  it('flips message status and moves membership through the store', async () => {
    const { store } = await database('tele-lenta-store-listing-status-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    const id = store.listings.insert(listingInput(source.id, 303));

    store.clusters.applyBookkeeping(42, {
      clusterKey: 'a-cluster-key',
      earliestPublishedAt: T0,
      listingCount: 1,
      sourceCount: 1,
      availableListingCount: 1,
      hidden: false,
      section: 'classifieds',
      category: 'real_estate',
      demand: 'offer',
      representativeId: id,
    });
    store.listings.setCluster(id, 42);
    assert.equal(store.listings.getById(id)?.clusterId, 42);

    store.listings.setMessageStatus(id, 'deleted');
    assert.equal(store.listings.getById(id)?.messageStatus, 'deleted');
  });

  it('lists only available hot-window listings for re-check', async () => {
    const { store } = await database('tele-lenta-store-listing-hot-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    store.listings.insert(listingInput(source.id, 1, { publishedAt: iso(t0 - 72 * HOUR) }));
    const fresh = store.listings.insert(
      listingInput(source.id, 2, { publishedAt: iso(t0 - 2 * HOUR) }),
    );
    store.listings.insert(
      listingInput(source.id, 3, { publishedAt: iso(t0 - 3 * HOUR), messageStatus: 'deleted' }),
    );

    const hot = store.listings.listHotWindow({ since: iso(t0 - 48 * HOUR) });
    assert.deepEqual(
      hot.map((listing) => listing.id),
      [fresh],
    );

    const limited = store.listings.listHotWindow({
      since: iso(t0 - 48 * HOUR),
      until: iso(t0 - 4 * HOUR),
    });
    assert.deepEqual(limited, []);
  });

  it('deletes listings older than the retention cutoff and cascades photos', async () => {
    const { store } = await database('tele-lenta-store-listing-retention-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    const oldId = store.listings.insert(
      listingInput(source.id, 11, {
        publishedAt: iso(t0 - 31 * DAY),
        photos: [{ url: 'https://cdn4.telesco.pe/file/old.jpg' }],
      }),
    );
    const keptId = store.listings.insert(
      listingInput(source.id, 12, { publishedAt: iso(t0 - 29 * DAY) }),
    );

    const deleted = store.listings.deleteOlderThan(iso(t0 - 30 * DAY));
    assert.equal(deleted, 1);
    assert.equal(store.listings.getById(oldId), null);
    assert.deepEqual(store.listings.listPhotos(oldId), [], 'photo rows cascade with the listing');
    assert.ok(store.listings.getById(keptId));
  });
});

describe('ingest runs', () => {
  it('records a run with counts and the cursor move', async () => {
    const { store } = await database('tele-lenta-store-runs-');
    const source = store.sources.getByUsername('montework');
    assert.ok(source);

    const runId = store.ingestRuns.start(source.id, iso(t0));
    let run = store.ingestRuns.getById(runId);
    assert.equal(run?.status, 'running');
    assert.equal(run?.finishedAt, null);

    store.ingestRuns.finish(runId, {
      status: 'ok',
      fetched: 20,
      inserted: 12,
      updated: 2,
      skipped: 6,
      errors: 0,
      cursorBefore: 100,
      cursorAfter: 120,
      finishedAt: iso(t0 + 5 * 1000),
    });

    run = store.ingestRuns.getById(runId);
    assert.equal(run?.status, 'ok');
    assert.equal(run?.fetched, 20);
    assert.equal(run?.inserted, 12);
    assert.equal(run?.updated, 2);
    assert.equal(run?.skipped, 6);
    assert.equal(run?.errors, 0);
    assert.equal(run?.cursorBefore, 100);
    assert.equal(run?.cursorAfter, 120);
    assert.equal(run?.finishedAt, iso(t0 + 5 * 1000));
  });

  it('returns the last run per source', async () => {
    const { store } = await database('tele-lenta-store-runs-last-');
    const channel = store.sources.getByUsername('montework');
    const group = store.sources.getByUsername('jobmonte');
    assert.ok(channel && group);

    const older = store.ingestRuns.start(channel.id, iso(t0));
    store.ingestRuns.finish(older, {
      status: 'failed',
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 1,
      cursorBefore: null,
      cursorAfter: null,
      errorSample: 'timeout',
    });
    const newer = store.ingestRuns.start(channel.id, iso(t0 + HOUR));
    const groupRun = store.ingestRuns.start(group.id, iso(t0 + 2 * HOUR));

    assert.equal(store.ingestRuns.lastForSource(channel.id)?.id, newer);
    assert.equal(store.ingestRuns.lastForSource(group.id)?.id, groupRun);

    assert.deepEqual(
      store.ingestRuns.listLastPerSource().map((run) => run.id),
      [newer, groupRun],
    );
  });
});

describe('negative cache', () => {
  it('expires an explicit not-found after 24 hours and prunes it', async () => {
    const { store } = await database('tele-lenta-store-negative-');
    const source = store.sources.getByUsername('jobmonte');
    assert.ok(source);

    assert.equal(store.negativeCache.has(source.id, 55, T0), false);

    store.negativeCache.add(source.id, 55, T0);
    assert.equal(store.negativeCache.has(source.id, 55, iso(t0 + NEGATIVE_CACHE_TTL_MS - 1)), true);
    assert.equal(
      store.negativeCache.has(source.id, 55, iso(t0 + NEGATIVE_CACHE_TTL_MS)),
      false,
      'the entry is gone at exactly 24 hours',
    );

    assert.equal(store.negativeCache.pruneExpired(iso(t0 + NEGATIVE_CACHE_TTL_MS)), 1);
    assert.equal(store.negativeCache.has(source.id, 55, T0), false);
  });

  it('refreshes the window when the same miss repeats', async () => {
    const { store } = await database('tele-lenta-store-negative-refresh-');
    const source = store.sources.getByUsername('jobmonte');
    assert.ok(source);

    store.negativeCache.add(source.id, 56, T0);
    store.negativeCache.add(source.id, 56, iso(t0 + 12 * HOUR));
    assert.equal(store.negativeCache.has(source.id, 56, iso(t0 + 30 * HOUR)), true);
  });
});

describe('parser failures', () => {
  it('records a failure and prunes rows older than seven days', async () => {
    const { store } = await database('tele-lenta-store-parser-failures-');
    const source = store.sources.getByUsername('monteafisha');
    assert.ok(source);

    store.parserFailures.add({
      sourceId: source.id,
      messageId: 900,
      url: 'https://t.me/monteafisha/900',
      error: 'event date did not parse',
      htmlExcerpt: '<div class="tgme_widget_message">…</div>',
      createdAt: iso(t0),
    });
    store.parserFailures.add({
      sourceId: source.id,
      url: 'https://t.me/s/monteafisha',
      error: 'markup drift',
      createdAt: iso(t0 + 8 * DAY),
    });

    assert.equal(store.parserFailures.list().length, 2);

    const pruned = store.parserFailures.pruneOlderThan(parserFailureCutoff(iso(t0 + 8 * DAY)));
    assert.equal(pruned, 1);

    const remaining = store.parserFailures.list(source.id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.error, 'markup drift');
    assert.equal(remaining[0]?.messageId, null);
  });
});

describe('app state', () => {
  it('stores, reads, lists, and deletes flags', async () => {
    const { store } = await database('tele-lenta-store-app-state-');

    assert.equal(store.appState.get('INGEST_ENABLED'), null);

    store.appState.set('INGEST_ENABLED', 'false');
    store.appState.set('last_global_ingest_at', T0);
    assert.equal(store.appState.get('INGEST_ENABLED'), 'false');
    assert.deepEqual(store.appState.getAll(), {
      INGEST_ENABLED: 'false',
      last_global_ingest_at: T0,
    });

    store.appState.set('INGEST_ENABLED', 'true');
    assert.equal(store.appState.get('INGEST_ENABLED'), 'true');

    store.appState.delete('INGEST_ENABLED');
    assert.equal(store.appState.get('INGEST_ENABLED'), null);
  });
});
