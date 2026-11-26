/**
 * Retention as one pass (ticket #18, layer A): recompute every cluster that
 * loses a member, then delete the old rows, then sweep clusters left without
 * listings, then prune parser failures.
 *
 * The pass runs on a real temporary SQLite through the store, with an injected
 * clock. Alerts and the tick wiring belong to layer B and are not exercised
 * here.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  RETENTION_MS,
  runRetention,
} from '../src/retention/index.js';
import { PARSER_FAILURE_RETENTION_MS } from '../src/store/index.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';
import { seedCluster, seedSource, type SeedMemberOptions } from './helpers/seed.js';

const DAY = 24 * 60 * 60 * 1000;
const T0_MS = Date.parse('2026-11-01T08:00:00.000Z');
const T0 = new Date(T0_MS).toISOString();
const ago = (ms: number): string => new Date(T0_MS - ms).toISOString();
const now = (): number => T0_MS;

const USER = 7001;

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

function member(
  overrides: Partial<SeedMemberOptions> &
    Pick<SeedMemberOptions, 'sourceId' | 'messageId' | 'publishedAt'>,
): SeedMemberOptions {
  return { ...overrides };
}

/** One saved search of the fixture user plus a match row for `clusterId`. */
function addMatch(database: TestDatabase, clusterId: number): number {
  const { db, store } = database;
  store.users.allow(USER, { at: T0 });
  const search = store.savedSearches.create(USER, { name: 'Квартира' }, T0);
  assert.ok(search);
  store.digests.recordCheck(search.id, [{ clusterId }], T0);
  assert.equal(matchCount(db, clusterId), 1);
  return search.id;
}

function matchCount(db: TestDatabase['db'], clusterId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM saved_search_matches WHERE cluster_id = ?')
    .get(clusterId) as { n: number };
  return row.n;
}

/** A cluster row with no listings, as a crash between deletion and cleanup leaves it. */
function insertOrphanCluster(db: TestDatabase['db']): number {
  const result = db
    .prepare(
      `INSERT INTO clusters
         (cluster_key, section, category, demand, earliest_published_at,
          first_seen_at, listing_count, source_count, available_listing_count, hidden)
       VALUES ('orphan', 'classifieds', 'other', 'offer', ?, ?, 0, 0, 0, 0)`,
    )
    .run(ago(DAY), ago(DAY));
  return Number(result.lastInsertRowid);
}

function danglingClusterReferences(db: TestDatabase['db']): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM listings l
       LEFT JOIN clusters c ON c.id = l.cluster_id
       WHERE l.cluster_id IS NOT NULL AND c.id IS NULL`,
    )
    .get() as { n: number };
  return row.n;
}

describe('retention', () => {
  it('deletes an old listing with its photos, cluster, and digest matches', async () => {
    const fixture = await database('tele-lenta-retention-listing-');
    const { db, store } = fixture;
    const source = seedSource(db, { username: 'retention_one' });

    const clusterId = seedCluster(db, store, [
      member({
        sourceId: source,
        messageId: 1,
        publishedAt: ago(31 * DAY),
        photos: [
          { url: 'https://cdn4.telesco.pe/file/a.jpg' },
          { url: 'https://cdn4.telesco.pe/file/b.jpg' },
        ],
      }),
    ]);
    const listingId = store.listings.getById(1)?.id;
    assert.ok(listingId !== undefined);
    addMatch(fixture, clusterId);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 1,
      clustersRecomputed: 1,
      clustersDeleted: 1,
      parserFailuresPruned: 0,
    });
    assert.equal(store.listings.getById(listingId), null);
    assert.deepEqual(store.listings.listPhotos(listingId), [], 'photo rows cascade');
    assert.equal(store.clusters.getCluster(clusterId), null);
    assert.equal(matchCount(db, clusterId), 0, 'matches cascade with the cluster');
  });

  it('recomputes the survivors before removing an old member', async () => {
    const fixture = await database('tele-lenta-retention-survive-');
    const { db, store } = fixture;
    const first = seedSource(db, { username: 'retention_survive_a' });
    const second = seedSource(db, { username: 'retention_survive_b' });

    const clusterId = seedCluster(db, store, [
      member({ sourceId: first, messageId: 1, publishedAt: ago(31 * DAY) }),
      member({ sourceId: second, messageId: 2, publishedAt: ago(1 * DAY) }),
    ]);
    addMatch(fixture, clusterId);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 1,
      clustersRecomputed: 1,
      clustersDeleted: 0,
      parserFailuresPruned: 0,
    });

    const cluster = store.clusters.getCluster(clusterId);
    assert.ok(cluster, 'the cluster survives on its fresh member');
    assert.equal(cluster.earliestPublishedAt, ago(1 * DAY));
    assert.equal(cluster.listingCount, 1);
    assert.equal(cluster.sourceCount, 1);
    assert.equal(cluster.availableListingCount, 1);
    assert.equal(cluster.hidden, false);
    assert.equal(matchCount(db, clusterId), 1, 'a live cluster keeps its match');

    const state = store.clusters.getState(clusterId);
    assert.ok(state);
    assert.equal(state.members.length, 1);
    assert.equal(state.members[0]?.id, 2);
    assert.equal(danglingClusterReferences(db), 0, 'no listing references a purged cluster');
  });

  it('deletes a cluster whose every member is old, with its matches', async () => {
    const fixture = await database('tele-lenta-retention-all-old-');
    const { db, store } = fixture;
    const first = seedSource(db, { username: 'retention_old_a' });
    const second = seedSource(db, { username: 'retention_old_b' });

    const clusterId = seedCluster(db, store, [
      member({ sourceId: first, messageId: 1, publishedAt: ago(40 * DAY) }),
      member({ sourceId: second, messageId: 2, publishedAt: ago(31 * DAY) }),
    ]);
    addMatch(fixture, clusterId);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 2,
      clustersRecomputed: 1,
      clustersDeleted: 1,
      parserFailuresPruned: 0,
    });
    assert.equal(store.clusters.getCluster(clusterId), null);
    assert.equal(matchCount(db, clusterId), 0);
    assert.equal(store.clusters.getState(clusterId), null);
  });

  it('keeps a listing exactly on the 30-day boundary and purges just past it', async () => {
    const fixture = await database('tele-lenta-retention-boundary-');
    const { db, store } = fixture;
    const source = seedSource(db, { username: 'retention_boundary' });

    // Strictly older than the cutoff: the store deletes `published_at < cutoff`.
    const justOld = seedCluster(db, store, [
      member({ sourceId: source, messageId: 1, publishedAt: ago(RETENTION_MS + 1) }),
    ]);
    // Exactly at the cutoff stays, matching the store's strict `<` comparison.
    const boundary = seedCluster(db, store, [
      member({ sourceId: source, messageId: 2, publishedAt: ago(RETENTION_MS) }),
    ]);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 1,
      clustersRecomputed: 1,
      clustersDeleted: 1,
      parserFailuresPruned: 0,
    });
    assert.equal(store.clusters.getCluster(justOld), null);
    assert.ok(store.clusters.getCluster(boundary), 'the boundary listing is not older than 30 days');
    assert.equal(store.clusters.getCluster(boundary)?.listingCount, 1);
  });

  it('leaves a listing younger than 30 days untouched', async () => {
    const fixture = await database('tele-lenta-retention-fresh-');
    const { db, store } = fixture;
    const source = seedSource(db, { username: 'retention_fresh' });
    const clusterId = seedCluster(db, store, [
      member({ sourceId: source, messageId: 1, publishedAt: ago(29 * DAY) }),
    ]);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 0,
      clustersRecomputed: 0,
      clustersDeleted: 0,
      parserFailuresPruned: 0,
    });
    assert.equal(store.clusters.getCluster(clusterId)?.listingCount, 1);
    assert.ok(store.listings.getById(1));
  });

  it('prunes parser failures older than seven days and keeps fresh ones', async () => {
    const fixture = await database('tele-lenta-retention-failures-');
    const { store } = fixture;
    const source = seedSource(fixture.db, { username: 'retention_failures' });

    const oldId = store.parserFailures.add({
      sourceId: source,
      url: 'https://t.me/retention_failures/1',
      error: 'old failure',
      createdAt: new Date(T0_MS - PARSER_FAILURE_RETENTION_MS - 1).toISOString(),
    });
    const freshId = store.parserFailures.add({
      sourceId: source,
      url: 'https://t.me/retention_failures/2',
      error: 'fresh failure',
      createdAt: new Date(T0_MS - PARSER_FAILURE_RETENTION_MS).toISOString(),
    });

    const result = runRetention({ store, now });

    assert.equal(result.parserFailuresPruned, 1);
    assert.deepEqual(
      store.parserFailures.list().map((failure) => failure.id),
      [freshId],
    );
    assert.ok(!store.parserFailures.list().some((failure) => failure.id === oldId));
  });

  it('deletes an orphan cluster with no listings', async () => {
    const fixture = await database('tele-lenta-retention-orphan-');
    const { db, store } = fixture;
    const orphanId = insertOrphanCluster(db);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 0,
      clustersRecomputed: 0,
      clustersDeleted: 1,
      parserFailuresPruned: 0,
    });
    assert.equal(store.clusters.getCluster(orphanId), null);
  });

  it('is idempotent: a second pass reports zeros', async () => {
    const fixture = await database('tele-lenta-retention-idempotent-');
    const { db, store } = fixture;
    const source = seedSource(db, { username: 'retention_idempotent' });
    const clusterId = seedCluster(db, store, [
      member({ sourceId: source, messageId: 1, publishedAt: ago(45 * DAY) }),
    ]);
    insertOrphanCluster(db);
    store.parserFailures.add({
      sourceId: source,
      url: 'https://t.me/retention_idempotent/1',
      error: 'old failure',
      createdAt: ago(10 * DAY),
    });

    const first = runRetention({ store, now });
    assert.equal(first.listingsDeleted, 1);
    assert.equal(first.clustersDeleted, 2);
    assert.equal(first.parserFailuresPruned, 1);

    const second = runRetention({ store, now });
    assert.deepEqual(second, {
      listingsDeleted: 0,
      clustersRecomputed: 0,
      clustersDeleted: 0,
      parserFailuresPruned: 0,
    });
    assert.equal(store.clusters.getCluster(clusterId), null);
  });

  it('recomputes over deleted members too, as removeMembers does', async () => {
    const fixture = await database('tele-lenta-retention-deleted-');
    const { db, store } = fixture;
    const first = seedSource(db, { username: 'retention_deleted_a' });
    const second = seedSource(db, { username: 'retention_deleted_b' });

    // An old deleted member anchors the cluster's age but is purged all the same.
    const mixed = seedCluster(db, store, [
      member({
        sourceId: first,
        messageId: 1,
        publishedAt: ago(31 * DAY),
        messageStatus: 'deleted',
      }),
      member({ sourceId: second, messageId: 2, publishedAt: ago(2 * DAY) }),
    ]);
    // A fresh deleted member survives the purge and keeps the cluster hidden.
    const hidden = seedCluster(db, store, [
      member({
        sourceId: first,
        messageId: 3,
        publishedAt: ago(31 * DAY),
        messageStatus: 'deleted',
      }),
      member({
        sourceId: second,
        messageId: 4,
        publishedAt: ago(1 * DAY),
        messageStatus: 'deleted',
      }),
    ]);

    const result = runRetention({ store, now });

    assert.deepEqual(result, {
      listingsDeleted: 2,
      clustersRecomputed: 2,
      clustersDeleted: 0,
      parserFailuresPruned: 0,
    });

    const mixedCluster = store.clusters.getCluster(mixed);
    assert.ok(mixedCluster);
    assert.equal(mixedCluster.earliestPublishedAt, ago(2 * DAY));
    assert.equal(mixedCluster.listingCount, 1);
    assert.equal(mixedCluster.availableListingCount, 1);
    assert.equal(mixedCluster.hidden, false);

    const hiddenCluster = store.clusters.getCluster(hidden);
    assert.ok(hiddenCluster);
    assert.equal(hiddenCluster.listingCount, 1);
    assert.equal(hiddenCluster.availableListingCount, 0, 'deleted members still count');
    assert.equal(hiddenCluster.hidden, true);
    assert.equal(danglingClusterReferences(db), 0);
  });
});
