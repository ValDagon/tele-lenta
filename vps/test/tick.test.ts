import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { markListingDeleted } from '../src/tick/write.js';
import { INGEST_ENABLED_KEY, runTick } from '../src/tick/tick.js';
import type { Listing } from '../src/store/types.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import {
  EMPTY_PAGE,
  ScriptedServer,
  html,
  page,
  seedSource,
  statusOnly,
  testClient,
  testConfig,
} from './helpers/tick.js';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const CROSS_POST = 'Сдам квартиру в Подгорице, 650 € в месяц, центр, два балкона, лифт, рядом школа';

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

function channelUrl(username: string, before?: number): string {
  const base = `https://t.me/s/${username}`;
  return before === undefined ? base : `${base}?before=${before}`;
}

function runRowCount(databaseUnderTest: TestDatabase): number {
  const row = databaseUnderTest.db.prepare('SELECT COUNT(*) AS count FROM ingest_runs').get() as {
    count: number;
  };
  return row.count;
}

describe('tick orchestration', () => {
  it('clusters identical cross-posts from two sources into one cluster', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-crosspost-');
    seedSource(databaseUnderTest.db, { username: 'src_a', kind: 'channel', cursor: 9 });
    seedSource(databaseUnderTest.db, { username: 'src_b', kind: 'channel', cursor: 9 });
    const server = new ScriptedServer()
      .on(channelUrl('src_a'), html(page([{ id: 10, text: CROSS_POST }])))
      .on(channelUrl('src_a', 10), html(EMPTY_PAGE))
      .on(channelUrl('src_b'), html(page([{ id: 10, text: CROSS_POST }])))
      .on(channelUrl('src_b', 10), html(EMPTY_PAGE));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const result = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(server),
      now: () => NOW,
    });

    assert.equal(result.runs.length, 2);
    assert.deepEqual(result.runs.map((run) => run.counts.inserted), [1, 1]);

    const listings = databaseUnderTest.store.sources
      .listEnabled()
      .map((source) => databaseUnderTest.store.listings.find(source.id, 10));
    const first = listings[0];
    const second = listings[1];
    assert.ok(first !== null && first !== undefined);
    assert.ok(second !== null && second !== undefined);
    assert.notEqual(first.clusterId, null);
    assert.equal(first.clusterId, second.clusterId);

    const cluster = databaseUnderTest.store.clusters.getCluster(first.clusterId as number);
    assert.equal(cluster?.listingCount, 2);
    assert.equal(cluster?.sourceCount, 2);
    assert.equal(cluster?.availableListingCount, 2);
    assert.equal(cluster?.hidden, false);
  });

  it('recomputes available count and hidden when members are deleted', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-cluster-delete-');
    seedSource(databaseUnderTest.db, { username: 'src_a', kind: 'channel', cursor: 9 });
    seedSource(databaseUnderTest.db, { username: 'src_b', kind: 'channel', cursor: 9 });
    const server = new ScriptedServer()
      .on(channelUrl('src_a'), html(page([{ id: 10, text: CROSS_POST }])))
      .on(channelUrl('src_a', 10), html(EMPTY_PAGE))
      .on(channelUrl('src_b'), html(page([{ id: 10, text: CROSS_POST }])))
      .on(channelUrl('src_b', 10), html(EMPTY_PAGE));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });
    await runTick({ config, store: databaseUnderTest.store, client: testClient(server), now: () => NOW });

    const sources = databaseUnderTest.store.sources.listEnabled();
    const first = databaseUnderTest.store.listings.find(sources[0]?.id ?? 0, 10) as Listing;
    const second = databaseUnderTest.store.listings.find(sources[1]?.id ?? 0, 10) as Listing;
    const clusterId = first.clusterId as number;

    assert.equal(markListingDeleted(databaseUnderTest.store, first), true);
    let cluster = databaseUnderTest.store.clusters.getCluster(clusterId);
    assert.equal(cluster?.availableListingCount, 1);
    assert.equal(cluster?.hidden, false);
    assert.equal(cluster?.listingCount, 2);

    assert.equal(markListingDeleted(databaseUnderTest.store, second), true);
    cluster = databaseUnderTest.store.clusters.getCluster(clusterId);
    assert.equal(cluster?.availableListingCount, 0);
    assert.equal(cluster?.hidden, true);

    const deletedSecond = databaseUnderTest.store.listings.find(second.sourceId, second.messageId);
    assert.ok(deletedSecond !== null);
    assert.equal(markListingDeleted(databaseUnderTest.store, deletedSecond), false, 'already deleted');
  });

  it('records a run per source and keeps going when one source fails', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-runs-');
    const broken = seedSource(databaseUnderTest.db, { username: 'src_broken', kind: 'channel', cursor: 9 });
    const healthy = seedSource(databaseUnderTest.db, { username: 'src_ok', kind: 'channel', cursor: 9 });
    const server = new ScriptedServer()
      .on(channelUrl('src_broken'), statusOnly(500))
      .on(
        channelUrl('src_ok'),
        html(page([{ id: 10, text: 'Продам лодку в Баре, 2 500 €, с мотором и прицепом, торг' }])),
      )
      .on(channelUrl('src_ok', 10), html(EMPTY_PAGE));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });

    const result = await runTick({
      config,
      store: databaseUnderTest.store,
      client: testClient(server),
      now: () => NOW,
    });

    assert.equal(result.runs.length, 2);
    assert.equal(result.runs[0]?.status, 'failed');
    assert.equal(result.runs[1]?.status, 'ok');
    assert.equal(result.runs[1]?.counts.inserted, 1);
    assert.equal(runRowCount(databaseUnderTest), 2);

    const brokenRun = databaseUnderTest.store.ingestRuns.lastForSource(broken);
    assert.equal(brokenRun?.status, 'failed');
    assert.equal(brokenRun?.cursorBefore, 9);
    assert.equal(brokenRun?.cursorAfter, 9);

    const healthyRun = databaseUnderTest.store.ingestRuns.lastForSource(healthy);
    assert.equal(healthyRun?.status, 'ok');
    assert.equal(healthyRun?.inserted, 1);
    assert.equal(healthyRun?.cursorBefore, 9);
    assert.equal(healthyRun?.cursorAfter, 10);
    assert.equal(databaseUnderTest.store.sources.getById(broken)?.consecutiveFailures, 1);
    assert.equal(databaseUnderTest.store.sources.getById(healthy)?.consecutiveFailures, 0);
  });

  it('does no work when another tick holds the lock', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-lock-');
    seedSource(databaseUnderTest.db, { username: 'src_ok', kind: 'channel', cursor: 9 });
    const server = new ScriptedServer()
      .on(channelUrl('src_ok'), html(page([{ id: 10, text: 'Продам гараж в Никшиче, 4 000 €, сухой' }])))
      .on(channelUrl('src_ok', 10), html(EMPTY_PAGE));
    const config = testConfig(databaseUnderTest.path, { tickRequestBudget: 5 });
    const client = testClient(server);
    const store = databaseUnderTest.store;

    const first = runTick({ config, store, client, now: () => NOW });
    const second = await runTick({ config, store, client, now: () => NOW });
    await first;

    assert.equal(second.skippedByLock, true);
    assert.deepEqual(second.runs, []);
    assert.equal(runRowCount(databaseUnderTest), 1, 'the overlapping tick writes no run row');

    const third = await runTick({ config, store, client, now: () => NOW });
    assert.equal(third.skippedByLock, false, 'the lock is released after the first tick');
    assert.equal(runRowCount(databaseUnderTest), 2);
  });

  it('skips unbackfilled sources and stops everything when ingestion is disabled', async () => {
    const databaseUnderTest = await database('tele-lenta-tick-disabled-');
    seedSource(databaseUnderTest.db, { username: 'src_null', kind: 'channel', cursor: null });
    const server = new ScriptedServer();
    const client = testClient(server);
    const config = testConfig(databaseUnderTest.path);

    const backfillPending = await runTick({
      config,
      store: databaseUnderTest.store,
      client,
      now: () => NOW,
    });
    assert.deepEqual(backfillPending.runs, []);
    assert.equal(runRowCount(databaseUnderTest), 0);
    assert.equal(server.calls.length, 0);

    seedSource(databaseUnderTest.db, { username: 'src_ok', kind: 'channel', cursor: 9 });
    databaseUnderTest.store.appState.set(INGEST_ENABLED_KEY, 'false');
    const disabled = await runTick({
      config,
      store: databaseUnderTest.store,
      client,
      now: () => NOW,
    });
    assert.equal(disabled.ingestionDisabled, true);
    assert.deepEqual(disabled.runs, []);
    assert.equal(server.calls.length, 0);
    assert.equal(runRowCount(databaseUnderTest), 0);
  });
});
