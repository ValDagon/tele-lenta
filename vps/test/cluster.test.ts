import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLUSTER_WINDOW_MS,
  MIN_SPECIFIC_TEXT_LENGTH,
  buildBookkeeping,
  clusterKey,
  findClusterOf,
  isSpecificEnough,
  reclusterListing,
  removeMembers,
  type ClusterableListing,
  type ClusterBookkeeping,
  type ClusterState,
  type ReclusterResult,
} from '../src/cluster/cluster.js';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T08:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

const APARTMENT_TEXT =
  'Продам двухкомнатную квартиру в Подгорице, 60 м2, центр, с мебелью, торг';
const OFFICE_TEXT = 'Сдаю офис в Будве, 40 м2, рядом с морем, долгосрочно';
const GENERIC_TEXT = 'Продам гараж';

function listing(overrides: Partial<ClusterableListing> & { id: number }): ClusterableListing {
  return {
    sourceId: 1,
    publishedAt: iso(T0),
    textNormalized: APARTMENT_TEXT,
    priceKey: 'eur:650',
    cityKey: 'podgorica',
    section: 'classifieds',
    category: 'real_estate',
    demand: 'offer',
    messageStatus: 'available',
    ...overrides,
  };
}

function generic(overrides: Partial<ClusterableListing> & { id: number }): ClusterableListing {
  return listing({ textNormalized: GENERIC_TEXT, priceKey: null, cityKey: null, ...overrides });
}

interface MutableCluster {
  id: number;
  clusterKey: string;
  members: ClusterableListing[];
}

/**
 * The test stand-in for the collector: it owns the id allocation and keeps the
 * in-memory cluster rows in step with the reducer's in/out contract.
 */
class World {
  clusters: MutableCluster[] = [];
  private nextClusterId = 1;

  apply(listingToApply: ClusterableListing): ReclusterResult {
    const current = findClusterOf(this.clusters, listingToApply.id);
    const candidates: ClusterState[] = this.clusters.map((cluster) => ({
      id: cluster.id,
      clusterKey: cluster.clusterKey,
      members: cluster.members.map((member) => ({ ...member })),
    }));

    const result = reclusterListing({
      listing: { ...listingToApply },
      currentClusterId: current?.id ?? null,
      candidates,
      newClusterId: this.nextClusterId,
    });

    this.persist(result, listingToApply);
    return result;
  }

  private persist(result: ReclusterResult, listingToApply: ClusterableListing): void {
    const dissolved = new Set(result.dissolved);

    for (const cluster of this.clusters) {
      cluster.members = cluster.members.filter((member) => member.id !== listingToApply.id);
    }
    this.clusters = this.clusters.filter((cluster) => !dissolved.has(cluster.id));

    for (const upsert of result.upserts) {
      let cluster = this.clusters.find((candidate) => candidate.id === upsert.id);
      if (cluster === undefined) {
        cluster = { id: upsert.id, clusterKey: upsert.bookkeeping.clusterKey, members: [] };
        this.clusters.push(cluster);
      }
      if (upsert.id === result.assignment.clusterId) {
        cluster.members.push(listingToApply);
      }
      assert.deepEqual(
        buildBookkeeping(cluster.clusterKey, cluster.members),
        upsert.bookkeeping,
        `bookkeeping for upserted cluster ${upsert.id}`,
      );
    }

    if (result.assignment.outcome === 'created') {
      this.nextClusterId = Math.max(this.nextClusterId, result.assignment.clusterId + 1);
    }
  }
}

interface ClusterSummary {
  memberIds: number[];
  earliestPublishedAt: string;
  sourceCount: number;
  availableListingCount: number;
  hidden: boolean;
  representativeId: number | null;
}

function summary(
  memberIds: number[],
  earliest: number,
  fields: Partial<Omit<ClusterSummary, 'memberIds' | 'earliestPublishedAt'>> = {},
): ClusterSummary {
  return {
    memberIds: [...memberIds].sort((a, b) => a - b),
    earliestPublishedAt: iso(earliest),
    sourceCount: 1,
    availableListingCount: memberIds.length,
    hidden: false,
    representativeId: memberIds[0] ?? null,
    ...fields,
  };
}

function summaries(world: World): ClusterSummary[] {
  return world.clusters
    .map((cluster): ClusterSummary => {
      const bookkeeping = buildBookkeeping(cluster.clusterKey, cluster.members);
      return {
        memberIds: cluster.members.map((member) => member.id).sort((a, b) => a - b),
        earliestPublishedAt: bookkeeping.earliestPublishedAt,
        sourceCount: bookkeeping.sourceCount,
        availableListingCount: bookkeeping.availableListingCount,
        hidden: bookkeeping.hidden,
        representativeId: bookkeeping.representativeId,
      };
    })
    .sort((a, b) => {
      if (a.earliestPublishedAt !== b.earliestPublishedAt) {
        return a.earliestPublishedAt < b.earliestPublishedAt ? -1 : 1;
      }
      return (a.memberIds[0] ?? 0) - (b.memberIds[0] ?? 0);
    });
}

function snapshot(world: World): unknown {
  return world.clusters
    .map((cluster) => ({
      id: cluster.id,
      clusterKey: cluster.clusterKey,
      memberIds: cluster.members.map((member) => member.id).sort((a, b) => a - b),
      bookkeeping: buildBookkeeping(cluster.clusterKey, cluster.members),
    }))
    .sort((a, b) => a.id - b.id);
}

/** Re-runs the clusterer over every stored listing and asserts nothing moves. */
function expectIdempotent(world: World): void {
  const before = snapshot(world);
  const assignments = new Map<number, number>();
  for (const cluster of world.clusters) {
    for (const member of cluster.members) assignments.set(member.id, cluster.id);
  }

  const stored = world.clusters
    .flatMap((cluster) => cluster.members)
    .sort((a, b) => a.id - b.id);

  for (const member of stored) {
    const result = world.apply({ ...member });
    assert.equal(
      result.assignment.clusterId,
      assignments.get(member.id),
      `listing ${member.id} must not move on a second run`,
    );
  }

  assert.deepEqual(snapshot(world), before, 'a second run must not change the clusters');
}

interface JoinCase {
  name: string;
  changes: ClusterableListing[];
  expected: ClusterSummary[];
}

const JOIN_CASES: JoinCase[] = [
  {
    name: 'an identical cross-post from another source joins the cluster',
    changes: [listing({ id: 1 }), listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 2 * HOUR) })],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: 'the same text with a different price opens its own cluster',
    changes: [
      listing({ id: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 2 * HOUR), priceKey: 'eur:700' }),
    ],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + 2 * HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'the same text in a different city opens its own cluster',
    changes: [
      listing({ id: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 2 * HOUR), cityKey: 'budva' }),
    ],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + 2 * HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'a repost inside the 72-hour window joins',
    changes: [listing({ id: 1 }), listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 71 * HOUR) })],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: 'a repost outside the 72-hour window opens its own cluster',
    changes: [listing({ id: 1 }), listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 73 * HOUR) })],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + 73 * HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'the window boundary itself is inclusive: exactly 72 hours joins',
    changes: [listing({ id: 1 }), listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + CLUSTER_WINDOW_MS) })],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: 'one millisecond past the boundary does not join',
    changes: [
      listing({ id: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + CLUSTER_WINDOW_MS + 1) }),
    ],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + CLUSTER_WINDOW_MS + 1, { representativeId: 2 }),
    ],
  },
  {
    name: 'a late repost past the window opens its own cluster',
    changes: [listing({ id: 1 }), listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 96 * HOUR) })],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + 96 * HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'a cross-post of the same generic short line stays a singleton',
    changes: [
      generic({ id: 1, sourceId: 1 }),
      generic({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR) }),
    ],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'a same-source bump with a specific key collapses into the cluster',
    changes: [listing({ id: 1, sourceId: 1 }), listing({ id: 2, sourceId: 1, publishedAt: iso(T0 + HOUR) })],
    expected: [summary([1, 2], T0, { representativeId: 1 })],
  },
  {
    name: 'two short generic same-source posts stay apart',
    changes: [
      generic({ id: 1, sourceId: 1 }),
      generic({ id: 2, sourceId: 1, publishedAt: iso(T0 + HOUR) }),
    ],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'an earlier cross-post discovered later joins and becomes the earliest publication',
    changes: [
      listing({ id: 1, sourceId: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 - 2 * HOUR) }),
    ],
    expected: [summary([1, 2], T0 - 2 * HOUR, { sourceCount: 2, representativeId: 2 })],
  },
  {
    name: 'the window is anchored on the earliest publication, so clusters cannot chain',
    changes: [
      listing({ id: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + 71 * HOUR) }),
      // 70 hours after the newest member, but 140 hours after the anchor.
      listing({ id: 3, sourceId: 3, publishedAt: iso(T0 + 140 * HOUR) }),
    ],
    expected: [
      summary([1, 2], T0, { sourceCount: 2, representativeId: 1 }),
      summary([3], T0 + 140 * HOUR, { representativeId: 3 }),
    ],
  },
  {
    name: '60 characters of normalized text is specific enough to join',
    changes: [
      listing({ id: 1, textNormalized: 'а'.repeat(MIN_SPECIFIC_TEXT_LENGTH), priceKey: null, cityKey: null }),
      listing({
        id: 2,
        sourceId: 2,
        publishedAt: iso(T0 + HOUR),
        textNormalized: 'а'.repeat(MIN_SPECIFIC_TEXT_LENGTH),
        priceKey: null,
        cityKey: null,
      }),
    ],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: '59 characters with no price and no city stays a singleton',
    changes: [
      listing({ id: 1, textNormalized: 'а'.repeat(MIN_SPECIFIC_TEXT_LENGTH - 1), priceKey: null, cityKey: null }),
      listing({
        id: 2,
        sourceId: 2,
        publishedAt: iso(T0 + HOUR),
        textNormalized: 'а'.repeat(MIN_SPECIFIC_TEXT_LENGTH - 1),
        priceKey: null,
        cityKey: null,
      }),
    ],
    expected: [
      summary([1], T0, { representativeId: 1 }),
      summary([2], T0 + HOUR, { representativeId: 2 }),
    ],
  },
  {
    name: 'a short generic line with a price is specific enough to join',
    changes: [
      generic({ id: 1, priceKey: 'eur:5000' }),
      generic({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR), priceKey: 'eur:5000' }),
    ],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: 'a short generic line with a city is specific enough to join',
    changes: [
      generic({ id: 1, cityKey: 'podgorica' }),
      generic({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR), cityKey: 'podgorica' }),
    ],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: 'an edit moves a listing between clusters and dissolves the emptied old one',
    changes: [
      listing({ id: 1 }),
      listing({
        id: 2,
        sourceId: 2,
        publishedAt: iso(T0 + 2 * HOUR),
        textNormalized: OFFICE_TEXT,
        priceKey: 'eur:900',
        cityKey: 'budva',
      }),
      listing({
        id: 1,
        sourceId: 1,
        publishedAt: iso(T0),
        textNormalized: OFFICE_TEXT,
        priceKey: 'eur:900',
        cityKey: 'budva',
      }),
    ],
    expected: [summary([1, 2], T0, { sourceCount: 2, representativeId: 1 })],
  },
  {
    name: 'a message_status flip to deleted recomputes available count and representative',
    changes: [
      listing({ id: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR) }),
      listing({ id: 1, messageStatus: 'deleted' }),
    ],
    expected: [
      summary([1, 2], T0, {
        sourceCount: 2,
        availableListingCount: 1,
        representativeId: 2,
      }),
    ],
  },
  {
    name: 'a deletion flip hides a singleton so it leaves the feed',
    changes: [listing({ id: 1 }), listing({ id: 1, messageStatus: 'deleted' })],
    expected: [
      summary([1], T0, { availableListingCount: 0, hidden: true, representativeId: null }),
    ],
  },
  {
    name: 'deleting every member hides the cluster and clears the representative',
    changes: [
      listing({ id: 1 }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR) }),
      listing({ id: 1, messageStatus: 'deleted' }),
      listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR), messageStatus: 'deleted' }),
    ],
    expected: [
      summary([1, 2], T0, {
        sourceCount: 2,
        availableListingCount: 0,
        hidden: true,
        representativeId: null,
      }),
    ],
  },
];

describe('clustering joins and bookkeeping', () => {
  for (const testCase of JOIN_CASES) {
    it(testCase.name, () => {
      const world = new World();
      for (const change of testCase.changes) world.apply(change);

      assert.deepEqual(summaries(world), testCase.expected);
      expectIdempotent(world);
    });
  }
});

describe('cluster key and specificity', () => {
  it('is deterministic and changes with text, price, or city', () => {
    const base = { textNormalized: APARTMENT_TEXT, priceKey: 'eur:650', cityKey: 'podgorica' };

    assert.equal(clusterKey(base), clusterKey({ ...base }));
    assert.notEqual(clusterKey(base), clusterKey({ ...base, textNormalized: OFFICE_TEXT }));
    assert.notEqual(clusterKey(base), clusterKey({ ...base, priceKey: 'eur:700' }));
    assert.notEqual(clusterKey(base), clusterKey({ ...base, cityKey: 'budva' }));
    assert.notEqual(
      clusterKey({ ...base, priceKey: null }),
      clusterKey({ ...base, cityKey: null }),
      'missing price and missing city must not collapse to the same canonical key',
    );
  });

  it('treats a price or a city as specific regardless of text length', () => {
    assert.equal(isSpecificEnough({ textNormalized: '', priceKey: 'eur:1', cityKey: null }), true);
    assert.equal(isSpecificEnough({ textNormalized: '', priceKey: null, cityKey: 'budva' }), true);
    assert.equal(isSpecificEnough({ textNormalized: 'Гараж', priceKey: null, cityKey: null }), false);
  });

  it('counts characters, not UTF-16 units, for the length guard', () => {
    const sixtyEmoji = '😀'.repeat(MIN_SPECIFIC_TEXT_LENGTH);
    assert.ok(sixtyEmoji.length > MIN_SPECIFIC_TEXT_LENGTH);
    assert.equal(isSpecificEnough({ textNormalized: sixtyEmoji, priceKey: null, cityKey: null }), true);
    assert.equal(
      isSpecificEnough({
        textNormalized: '😀'.repeat(MIN_SPECIFIC_TEXT_LENGTH - 1),
        priceKey: null,
        cityKey: null,
      }),
      false,
    );
  });
});

describe('representative and bookkeeping recomputation', () => {
  it('picks the available member with the lowest publishedAt, then the lowest id', () => {
    const clusterKeyValue = 'key';
    const members: ClusterableListing[] = [
      listing({ id: 5, sourceId: 1, publishedAt: iso(T0), messageStatus: 'deleted', section: 'jobs' }),
      listing({
        id: 7,
        sourceId: 2,
        publishedAt: iso(T0 + HOUR),
        section: 'events',
        category: 'events',
        demand: 'none',
      }),
      listing({
        id: 3,
        sourceId: 3,
        publishedAt: iso(T0 + HOUR),
        section: 'classifieds',
        category: 'real_estate',
        demand: 'offer',
      }),
    ];

    const bookkeeping = buildBookkeeping(clusterKeyValue, members);

    assert.equal(bookkeeping.earliestPublishedAt, iso(T0), 'deleted members still anchor the date');
    assert.equal(bookkeeping.listingCount, 3);
    assert.equal(bookkeeping.sourceCount, 3);
    assert.equal(bookkeeping.availableListingCount, 2);
    assert.equal(bookkeeping.hidden, false);
    assert.equal(bookkeeping.representativeId, 3, 'tie on publishedAt goes to the lowest id');
    assert.equal(bookkeeping.section, 'classifieds');
    assert.equal(bookkeeping.category, 'real_estate');
    assert.equal(bookkeeping.demand, 'offer');
  });

  it('falls back to the earliest member for facets when every member is deleted', () => {
    const bookkeeping = buildBookkeeping('key', [
      listing({
        id: 9,
        publishedAt: iso(T0),
        messageStatus: 'deleted',
        section: 'jobs',
        category: 'jobs',
        demand: 'wanted',
      }),
      listing({
        id: 4,
        sourceId: 2,
        publishedAt: iso(T0 + HOUR),
        messageStatus: 'deleted',
        section: 'classifieds',
      }),
    ]);

    assert.equal(bookkeeping.hidden, true);
    assert.equal(bookkeeping.availableListingCount, 0);
    assert.equal(bookkeeping.representativeId, null);
    assert.equal(bookkeeping.earliestPublishedAt, iso(T0));
    assert.equal(bookkeeping.section, 'jobs', 'facets come from the earliest member');
    assert.equal(bookkeeping.category, 'jobs');
    assert.equal(bookkeeping.demand, 'wanted');
  });
});

describe('edits that leave a cluster behind', () => {
  it('recomputes the old cluster when it keeps another member', () => {
    const world = new World();
    world.apply(listing({ id: 1 }));
    world.apply(listing({ id: 3, publishedAt: iso(T0 + HOUR) }));
    world.apply(
      listing({
        id: 2,
        sourceId: 2,
        publishedAt: iso(T0 + 2 * HOUR),
        textNormalized: OFFICE_TEXT,
        priceKey: 'eur:900',
        cityKey: 'budva',
      }),
    );

    const result = world.apply(
      listing({
        id: 1,
        textNormalized: OFFICE_TEXT,
        priceKey: 'eur:900',
        cityKey: 'budva',
      }),
    );

    assert.equal(result.assignment.outcome, 'joined');
    assert.deepEqual(result.dissolved, []);
    assert.equal(result.upserts.length, 2);
    assert.deepEqual(result.upserts.map((upsert) => upsert.id), [2, 1]);

    const oldCluster = result.upserts[1]?.bookkeeping;
    assert.ok(oldCluster !== undefined);
    assert.equal(oldCluster.earliestPublishedAt, iso(T0 + HOUR), 'earliest moves to the survivor');
    assert.equal(oldCluster.listingCount, 1);

    assert.deepEqual(summaries(world), [
      summary([1, 2], T0, { sourceCount: 2, representativeId: 1 }),
      summary([3], T0 + HOUR, { representativeId: 3 }),
    ]);
    expectIdempotent(world);
  });

  it('does not mutate the listing or the candidate clusters', () => {
    const changed = listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR) });
    const existing = listing({ id: 1 });
    const listingBefore = structuredClone(changed);
    const candidatesBefore = [{ id: 7, clusterKey: clusterKey(existing), members: [existing] }];
    const candidatesCopy = structuredClone(candidatesBefore);

    const result = reclusterListing({
      listing: changed,
      currentClusterId: null,
      candidates: candidatesBefore,
      newClusterId: 8,
    });

    assert.equal(result.assignment.clusterId, 7);
    assert.deepEqual(changed, listingBefore);
    assert.deepEqual(candidatesBefore, candidatesCopy);
  });
});

describe('albums', () => {
  it('clusters an album already collapsed onto its lowest id as one member', () => {
    const world = new World();
    const album = listing({ id: 1109995, sourceId: 1 });
    world.apply(album);

    assert.deepEqual(summaries(world), [summary([1109995], T0, { representativeId: 1109995 })]);

    world.apply(listing({ id: 1200000, sourceId: 2, publishedAt: iso(T0 + HOUR) }));

    const memberIds = world.clusters.flatMap((cluster) => cluster.members.map((member) => member.id));
    assert.deepEqual(memberIds.sort((a, b) => a - b), [1109995, 1200000]);
    assert.ok(!memberIds.includes(1109996), 'uncollapsed album ids must never reach the clusterer');
    assert.ok(!memberIds.includes(1109997));
    expectIdempotent(world);
  });
});

describe('retention', () => {
  function threeMemberCluster(): ClusterState {
    return {
      id: 7,
      clusterKey: 'key',
      members: [
        listing({ id: 1, publishedAt: iso(T0), messageStatus: 'deleted' }),
        listing({ id: 2, sourceId: 2, publishedAt: iso(T0 + HOUR) }),
        listing({ id: 3, sourceId: 3, publishedAt: iso(T0 + 2 * HOUR) }),
      ],
    };
  }

  it('recomputes earliest publication and counts over the survivors before the purge', () => {
    const removal = removeMembers(threeMemberCluster(), [1]);

    assert.equal(removal.dissolved, false);
    assert.ok(removal.bookkeeping !== null);
    assert.equal(removal.bookkeeping.earliestPublishedAt, iso(T0 + HOUR));
    assert.equal(removal.bookkeeping.listingCount, 2);
    assert.equal(removal.bookkeeping.sourceCount, 2);
    assert.equal(removal.bookkeeping.availableListingCount, 2);
    assert.equal(removal.bookkeeping.representativeId, 2);
  });

  it('dissolves a cluster when retention removes its last member', () => {
    const removal = removeMembers(threeMemberCluster(), [1, 2, 3]);

    assert.equal(removal.dissolved, true);
    assert.equal(removal.bookkeeping, null);
  });

  it('is a no-op for a member the cluster does not contain', () => {
    const removal = removeMembers(threeMemberCluster(), [99]);

    assert.equal(removal.dissolved, false);
    assert.ok(removal.bookkeeping !== null);
    assert.equal(removal.bookkeeping.listingCount, 3);
    assert.equal(removal.bookkeeping.earliestPublishedAt, iso(T0));
  });
});

describe('types stay bookkeeping-only', () => {
  it('never copies display strings into a cluster snapshot', () => {
    const bookkeeping: ClusterBookkeeping = buildBookkeeping('key', [listing({ id: 1 })]);
    const keys = Object.keys(bookkeeping).sort();

    assert.deepEqual(keys, [
      'availableListingCount',
      'category',
      'clusterKey',
      'demand',
      'earliestPublishedAt',
      'hidden',
      'listingCount',
      'representativeId',
      'section',
      'sourceCount',
    ]);
  });
});
