import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createRequestBudget } from '../src/net/polite-client.js';
import { deriveGroupWindow, scanGroup } from '../src/tick/group.js';
import { runTick } from '../src/tick/tick.js';
import type { NewListing, Source } from '../src/store/types.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import {
  ScriptedServer,
  embed,
  fixture,
  html,
  seedSource,
  statusOnly,
  testClient,
  testConfig,
} from './helpers/tick.js';

const GROUP = 'sale_me_com';
const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

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

function embedUrl(id: number, username = GROUP): string {
  return `https://t.me/${username}/${id}?embed=1`;
}

function listingInput(sourceId: number, messageId: number, overrides: Partial<NewListing> = {}): NewListing {
  return {
    sourceId,
    messageId,
    url: `https://t.me/${GROUP}/${messageId}`,
    publishedAt: new Date(NOW - 3 * HOUR).toISOString(),
    fetchedAt: new Date(NOW - 2 * HOUR).toISOString(),
    textRaw: 'Продам старый стол, 40 €, самовывоз из Подгорицы',
    textNormalized: 'продам старый стол 40 самовывоз из подгорицы',
    searchText: 'продам старый стол podgorica',
    contentHash: `hash-${messageId}`,
    title: 'Продам старый стол',
    section: 'classifieds',
    category: 'goods',
    demand: 'offer',
    city: 'Podgorica',
    priceRaw: '40 €',
    priceValue: 40,
    priceCurrency: 'eur',
    parserVersion: 'test',
    ...overrides,
  };
}

function sourceOf(databaseUnderTest: TestDatabase, sourceId: number): Source {
  const source = databaseUnderTest.store.sources.getById(sourceId);
  assert.ok(source !== null);
  return source;
}

describe('group scan window', () => {
  it('grows with observed traffic and is clamped to 20..200', () => {
    assert.equal(deriveGroupWindow(0), 40);
    assert.equal(deriveGroupWindow(5), 40);
    assert.equal(deriveGroupWindow(30), 60);
    assert.equal(deriveGroupWindow(500), 200);
  });
});

describe('group scan', () => {
  it('scans forward across gaps and advances the cursor to the highest id scanned', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-forward-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 10 });
    const server = new ScriptedServer()
      .on(
        embedUrl(11),
        html(embed({ id: 11, text: 'Продам холодильник в Подгорице, 200 €, самовывоз, работает' })),
      )
      .on(embedUrl(12), html(fixture('not-found.html')))
      .on(embedUrl(13), statusOnly(404))
      .on(embedUrl(14), html(fixture('not-found.html')))
      .on(
        embedUrl(15),
        html(embed({ id: 15, text: 'Продам стиральную машину в Баре, 180 €, почти новая, с доставкой' })),
      );
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 6 });

    const result = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(server),
      now: () => NOW,
    });

    assert.equal(result.runs[0]?.status, 'ok');
    assert.equal(result.runs[0]?.cursorBefore, 10);
    assert.equal(result.runs[0]?.cursorAfter, 15);
    assert.equal(result.runs[0]?.counts.inserted, 2);
    assert.equal(result.runs[0]?.counts.skipped, 3);
    assert.equal(databaseUnderTest.store.sources.getById(sourceId)?.cursorMessageId, 15);
    assert.equal(databaseUnderTest.store.negativeCache.has(sourceId, 12), true);
    assert.equal(databaseUnderTest.store.negativeCache.has(sourceId, 13), true);
    assert.equal(databaseUnderTest.store.negativeCache.has(sourceId, 14), true);
  });

  it('skips a negatively cached id until the entry expires', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-cache-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 10 });
    databaseUnderTest.store.negativeCache.add(sourceId, 11, new Date(NOW).toISOString());

    const server = new ScriptedServer();
    const client = testClient(server);
    const source = sourceOf(databaseUnderTest, sourceId);

    const cached = await scanGroup({
      store: databaseUnderTest.store,
      client,
      source,
      budget: createRequestBudget(1),
      ingestEnabled: true,
      fetchedAt: new Date(NOW).toISOString(),
      now: NOW,
    });
    assert.equal(cached.counts.skipped, 1);
    assert.equal(server.calls.length, 0, 'a cached miss must not hit the network');

    // Age the entry past its 24-hour lifetime.
    databaseUnderTest.store.negativeCache.add(sourceId, 11, '2000-01-01T00:00:00.000Z');
    server.on(embedUrl(11), html(fixture('not-found.html')));

    const expired = await scanGroup({
      store: databaseUnderTest.store,
      client,
      source,
      budget: createRequestBudget(1),
      ingestEnabled: true,
      fetchedAt: new Date(NOW).toISOString(),
      now: NOW,
    });
    assert.equal(server.callsTo(embedUrl(11)), 1, 'an expired entry must be refetched');
    assert.equal(expired.counts.skipped, 1);
  });

  it('does not negative-cache a 5xx and marks nothing', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-5xx-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 10 });
    const server = new ScriptedServer().on(embedUrl(11), statusOnly(503));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 1 });

    const result = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(server),
      now: () => NOW,
    });

    assert.equal(result.runs[0]?.status, 'failed');
    assert.equal(result.runs[0]?.counts.errors, 1);
    assert.equal(databaseUnderTest.store.negativeCache.has(sourceId, 11), false);
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 11), null);
  });

  it('marks an existing listing deleted on a 404', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-404-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 10 });
    databaseUnderTest.store.listings.insert(listingInput(sourceId, 11));
    const server = new ScriptedServer().on(embedUrl(11), statusOnly(404));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 1 });

    await runTick({ config, store: databaseUnderTest.store, client: testClient(server), now: () => NOW });

    assert.equal(databaseUnderTest.store.listings.find(sourceId, 11)?.messageStatus, 'deleted');
    assert.equal(databaseUnderTest.store.negativeCache.has(sourceId, 11), true);
  });

  it('collapses an album split across ids into one listing with one photo set', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-album-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 1109994 });
    const server = new ScriptedServer()
      .on(embedUrl(1109995), html(fixture('album-1109995.html')))
      .on(embedUrl(1109996), html(fixture('album-1109996.html')))
      .on(embedUrl(1109997), html(fixture('album-1109997.html')));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 3 });

    const result = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(server),
      now: () => NOW,
    });

    assert.equal(result.runs[0]?.status, 'ok');
    assert.equal(result.runs[0]?.counts.inserted, 1);
    const survivor = databaseUnderTest.store.listings.find(sourceId, 1109995);
    assert.ok(survivor !== null);
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 1109996), null);
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 1109997), null);
    assert.equal(survivor.photoCount, 7);
    assert.equal(databaseUnderTest.store.listings.listPhotos(survivor.id).length, 7);
  });

  it('records an unparsable event date in parser_failures and keeps it out of the feed', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-event-');
    const sourceId = seedSource(databaseUnderTest.db, {
      username: GROUP,
      sectionHint: 'events',
      cursor: 10,
    });
    const server = new ScriptedServer().on(
      embedUrl(11),
      html(embed({ id: 11, text: 'Приходите на концерт, будет весело и громко, вход свободный' })),
    );
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 1 });

    await runTick({ config, store: databaseUnderTest.store, client: testClient(server), now: () => NOW });

    assert.equal(databaseUnderTest.store.listings.find(sourceId, 11), null);
    const failures = databaseUnderTest.store.parserFailures.list(sourceId);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.messageId, 11);
  });

  it('re-checks a stale hot-window listing and marks an explicit not-found deleted', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-recheck-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 10 });
    databaseUnderTest.store.listings.insert(listingInput(sourceId, 5));
    const server = new ScriptedServer()
      .on(embedUrl(11), html(fixture('not-found.html')))
      .on(embedUrl(12), html(fixture('not-found.html')))
      .on(embedUrl(13), html(fixture('not-found.html')))
      .on(embedUrl(14), html(fixture('not-found.html')))
      .on(embedUrl(5), statusOnly(404));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    await runTick({ config, store: databaseUnderTest.store, client: testClient(server), now: () => NOW });

    assert.equal(server.callsTo(embedUrl(5)), 1);
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 5)?.messageStatus, 'deleted');
  });

  it('leaves a listing available when its re-check fails with a 5xx', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-group-recheck-error-');
    const sourceId = seedSource(databaseUnderTest.db, { username: GROUP, cursor: 10 });
    databaseUnderTest.store.listings.insert(listingInput(sourceId, 5));
    const server = new ScriptedServer()
      .on(embedUrl(11), html(fixture('not-found.html')))
      .on(embedUrl(12), html(fixture('not-found.html')))
      .on(embedUrl(13), html(fixture('not-found.html')))
      .on(embedUrl(14), html(fixture('not-found.html')))
      .on(embedUrl(5), statusOnly(500));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const result = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(server),
      now: () => NOW,
    });

    assert.equal(server.callsTo(embedUrl(5)), 1);
    assert.equal(databaseUnderTest.store.listings.find(sourceId, 5)?.messageStatus, 'available');
    assert.equal(result.runs[0]?.counts.errors, 1);
  });
});
