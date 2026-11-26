import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  clusterKey,
  reclusterListing,
  removeMembers,
  type ClusterableListing,
  type ReclusterResult,
} from '../src/cluster/cluster.js';
import type { NewListing } from '../src/store/index.js';

import {
  closeTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from './helpers/database.js';

const T0 = '2026-11-01T08:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();
const t0 = Date.parse(T0);

const APARTMENT_TEXT = 'Продам двухкомнатную квартиру в Подгорице, 60 м2, центр, с мебелью';
const OFFICE_TEXT = 'Сдаю офис в Будве, 40 м2, рядом с морем, долгосрочно';
const PRICE_KEY = 'eur:650';
const CITY_KEY = 'podgorica';

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

function listingInput(
  sourceId: number,
  messageId: number,
  overrides: Partial<NewListing> = {},
): NewListing {
  return {
    sourceId,
    messageId,
    url: `https://t.me/source/${messageId}`,
    publishedAt: T0,
    fetchedAt: T0,
    textRaw: APARTMENT_TEXT,
    textNormalized: APARTMENT_TEXT.toLowerCase(),
    searchText: APARTMENT_TEXT.toLowerCase(),
    contentHash: `hash-${messageId}`,
    title: 'Квартира',
    section: 'classifieds',
    category: 'real_estate',
    demand: 'offer',
    city: 'Podgorica',
    priceRaw: '650 €',
    priceValue: 650,
    priceCurrency: 'EUR',
    parserVersion: 'test-1',
    ...overrides,
  };
}

function clusterable(
  store: TestDatabase['store'],
  listingId: number,
  overrides: Partial<ClusterableListing> = {},
): ClusterableListing {
  const listing = store.listings.getById(listingId);
  assert.ok(listing, `listing ${listingId} must exist`);
  return {
    id: listing.id,
    sourceId: listing.sourceId,
    publishedAt: listing.publishedAt,
    textNormalized: listing.textNormalized,
    priceKey: PRICE_KEY,
    cityKey: CITY_KEY,
    section: listing.section,
    category: listing.category,
    demand: listing.demand,
    messageStatus: listing.messageStatus,
    ...overrides,
  };
}

/** The collector's write path against the real store: load candidates, reduce, persist. */
function applyChange(
  store: TestDatabase['store'],
  listing: ClusterableListing,
  currentClusterId: number | null,
): ReclusterResult {
  const key = clusterKey(listing);
  const result = reclusterListing({
    listing,
    currentClusterId,
    candidates: store.clusters.loadCandidates(key, currentClusterId),
    newClusterId: store.clusters.nextId(),
  });
  store.clusters.applyRecluster(result);
  return result;
}

describe('cluster store', () => {
  it('loads a cluster state in the shape the clusterer expects', async () => {
    const { store } = await database('tele-lenta-store-cluster-load-');
    const channel = store.sources.getByUsername('montework');
    const group = store.sources.getByUsername('jobmonte');
    assert.ok(channel && group);

    const first = store.listings.insert(listingInput(channel.id, 1));
    const second = store.listings.insert(
      listingInput(group.id, 2, { publishedAt: iso(t0 + HOUR) }),
    );

    const created = applyChange(store, clusterable(store, first), null);
    const joined = applyChange(store, clusterable(store, second), null);

    assert.equal(created.assignment.outcome, 'created');
    assert.equal(joined.assignment.outcome, 'joined');
    assert.equal(joined.assignment.clusterId, created.assignment.clusterId);

    const clusterId = created.assignment.clusterId;
    const cluster = store.clusters.getCluster(clusterId);
    assert.ok(cluster);
    assert.equal(cluster.clusterKey, clusterKey(clusterable(store, first)));
    assert.equal(cluster.earliestPublishedAt, T0);
    assert.equal(cluster.listingCount, 2);
    assert.equal(cluster.sourceCount, 2);
    assert.equal(cluster.availableListingCount, 2);
    assert.equal(cluster.hidden, false);
    assert.equal(cluster.section, 'classifieds');
    assert.equal(cluster.category, 'real_estate');
    assert.equal(cluster.demand, 'offer');
    assert.ok(!Number.isNaN(Date.parse(cluster.firstSeenAt)));

    assert.equal(store.listings.getById(first)?.clusterId, clusterId);
    assert.equal(store.listings.getById(second)?.clusterId, clusterId);

    const state = store.clusters.getState(clusterId);
    assert.ok(state);
    assert.equal(state.id, clusterId);
    assert.equal(state.clusterKey, cluster.clusterKey);
    assert.equal(state.members.length, 2);
    assert.deepEqual(
      state.members.map((member) => member.id).sort(),
      [first, second].sort(),
    );

    const member = state.members.find((row) => row.id === second);
    assert.ok(member);
    assert.deepEqual(Object.keys(member).sort(), [
      'category',
      'cityKey',
      'demand',
      'id',
      'messageStatus',
      'priceKey',
      'publishedAt',
      'section',
      'sourceId',
      'textNormalized',
    ]);
    assert.equal(member.sourceId, group.id);
    assert.equal(member.publishedAt, iso(t0 + HOUR));

    const candidates = store.clusters.loadCandidates(cluster.clusterKey, null);
    assert.deepEqual(
      candidates.map((candidate) => candidate.id),
      [clusterId],
    );
    assert.deepEqual(
      store.clusters.loadCandidates('a-key-no-cluster-has', null),
      [],
    );
  });

  it('recomputes availability when a member flips to deleted', async () => {
    const { store } = await database('tele-lenta-store-cluster-status-');
    const channel = store.sources.getByUsername('montework');
    const group = store.sources.getByUsername('jobmonte');
    assert.ok(channel && group);

    const first = store.listings.insert(listingInput(channel.id, 1));
    const second = store.listings.insert(listingInput(group.id, 2, { publishedAt: iso(t0 + HOUR) }));
    const clusterId = applyChange(store, clusterable(store, first), null).assignment.clusterId;
    applyChange(store, clusterable(store, second), null);

    store.listings.setMessageStatus(second, 'deleted');
    applyChange(store, clusterable(store, second), clusterId);

    let cluster = store.clusters.getCluster(clusterId);
    assert.equal(cluster?.availableListingCount, 1);
    assert.equal(cluster?.listingCount, 2);
    assert.equal(cluster?.hidden, false);

    store.listings.setMessageStatus(first, 'deleted');
    applyChange(store, clusterable(store, first), clusterId);

    cluster = store.clusters.getCluster(clusterId);
    assert.equal(cluster?.availableListingCount, 0);
    assert.equal(cluster?.hidden, true);
    assert.equal(store.clusters.getState(clusterId)?.members.length, 2);
  });

  it('dissolves a cluster when an edit moves its only member', async () => {
    const { store } = await database('tele-lenta-store-cluster-dissolve-');
    const channel = store.sources.getByUsername('montework');
    assert.ok(channel);

    const listingId = store.listings.insert(listingInput(channel.id, 1));
    const oldClusterId = applyChange(store, clusterable(store, listingId), null).assignment.clusterId;
    assert.ok(store.clusters.getCluster(oldClusterId));

    const edited = clusterable(store, listingId, {
      textNormalized: OFFICE_TEXT.toLowerCase(),
      priceKey: 'eur:900',
      cityKey: 'budva',
    });
    const result = applyChange(store, edited, oldClusterId);

    assert.equal(result.assignment.clusterId, result.upserts[0]?.id);
    assert.notEqual(result.assignment.clusterId, oldClusterId);
    assert.deepEqual(result.dissolved, [oldClusterId]);
    assert.equal(store.clusters.getCluster(oldClusterId), null);
    assert.equal(store.listings.getById(listingId)?.clusterId, result.assignment.clusterId);
    assert.equal(store.clusters.getCluster(result.assignment.clusterId)?.listingCount, 1);
  });

  it('applies a retention removal without leaving a dangling cluster', async () => {
    const { store } = await database('tele-lenta-store-cluster-retention-');
    const channel = store.sources.getByUsername('montework');
    const group = store.sources.getByUsername('jobmonte');
    assert.ok(channel && group);

    const first = store.listings.insert(listingInput(channel.id, 1));
    const second = store.listings.insert(listingInput(group.id, 2, { publishedAt: iso(t0 + HOUR) }));
    const clusterId = applyChange(store, clusterable(store, first), null).assignment.clusterId;
    applyChange(store, clusterable(store, second), null);

    const state = store.clusters.getState(clusterId);
    assert.ok(state);

    const firstRemoval = removeMembers(state, [first]);
    store.clusters.applyRemoval(firstRemoval);

    let cluster = store.clusters.getCluster(clusterId);
    assert.equal(cluster?.listingCount, 1);
    assert.equal(cluster?.earliestPublishedAt, iso(t0 + HOUR), 'the earliest member moved');

    // Retention recomputes first, then removes the purged rows.
    assert.equal(store.listings.deleteOlderThan(iso(t0 + HOUR)), 1);

    const remaining = store.clusters.getState(clusterId);
    assert.ok(remaining);
    store.clusters.applyRemoval(removeMembers(remaining, [second]));
    cluster = store.clusters.getCluster(clusterId);
    assert.equal(cluster, null);
  });

  it('keeps first_seen_at stable across bookkeeping updates', async () => {
    const { store } = await database('tele-lenta-store-cluster-first-seen-');
    const channel = store.sources.getByUsername('montework');
    const group = store.sources.getByUsername('jobmonte');
    assert.ok(channel && group);

    const first = store.listings.insert(listingInput(channel.id, 1));
    const second = store.listings.insert(listingInput(group.id, 2, { publishedAt: iso(t0 + HOUR) }));
    const stateAfterFirst = applyChange(store, clusterable(store, first), null);
    const clusterId = stateAfterFirst.assignment.clusterId;
    const firstSeenAt = store.clusters.getCluster(clusterId)?.firstSeenAt;
    assert.ok(firstSeenAt);

    applyChange(store, clusterable(store, second), null);
    assert.equal(store.clusters.getCluster(clusterId)?.firstSeenAt, firstSeenAt);
  });
});
