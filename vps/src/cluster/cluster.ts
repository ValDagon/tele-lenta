/**
 * Pure clustering for the feed (ADR-0001, spec «Clustering»).
 *
 * A Кластер groups listings that describe the same offer. Identity is a hash
 * over normalized text, the price key, and the city key. The first photo is
 * deliberately not part of the key: a cross-post may re-upload its photo, so
 * requiring equality would suppress the merges the product exists to make.
 *
 * This module owns only clustering: it never parses price or city, never
 * normalizes text, never touches SQLite, HTTP, or the filesystem. Ingestion
 * supplies the derived fields, including albums already collapsed onto their
 * lowest message id.
 *
 * Joining an existing cluster requires all three:
 *
 * 1. the key matches,
 * 2. the publication falls within {@link CLUSTER_WINDOW_MS} of the cluster's
 *    `earliest_published_at` — the window is anchored on the earliest member,
 *    so a chain of reposts cannot stretch it indefinitely,
 * 3. the key is specific enough: a price, a city, or at least
 *    {@link MIN_SPECIFIC_TEXT_LENGTH} characters of normalized text. Short
 *    generic lines stay singletons.
 *
 * Everything is a pure in/out transformation: inputs are never mutated, and
 * re-running the reducer over the same state yields the same assignment.
 */

import { createHash } from 'node:crypto';

/** A repost joins only inside this window, anchored on the cluster's earliest publication. */
export const CLUSTER_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Normalized text shorter than this is generic unless a price or city is present. */
export const MIN_SPECIFIC_TEXT_LENGTH = 60;

/**
 * Facet values are opaque here. Ingestion owns the vocabulary of section,
 * category, and demand; the clusterer only copies them from the representative.
 */
export type FacetValue = string;

export type MessageStatus = 'available' | 'deleted';

/** A listing as ingestion hands it to the clusterer: derived fields only. */
export interface ClusterableListing {
  /** `listings.id`; unique across the store. */
  id: number;
  /** `listings.source_id`; drives `source_count`. */
  sourceId: number;
  /** Publication time as ISO 8601 UTC, from the Telegram widget. */
  publishedAt: string;
  /** Text after ingestion normalization; the clusterer never re-normalizes it. */
  textNormalized: string;
  /** Derived price key, normalized by ingestion, or null when the post has no price. */
  priceKey: string | null;
  /** Derived city key, normalized by ingestion, or null when no city matched. */
  cityKey: string | null;
  section: FacetValue;
  category: FacetValue;
  demand: FacetValue;
  messageStatus: MessageStatus;
}

/** The parts of a listing that define its key. */
export interface ClusterKeyInput {
  textNormalized: string;
  priceKey: string | null;
  cityKey: string | null;
}

/**
 * A cluster as read back from the database, with its members. The members are
 * required because every bookkeeping column is recomputed from them and must
 * count deleted rows too.
 */
export interface ClusterState {
  id: number;
  clusterKey: string;
  members: readonly ClusterableListing[];
}

/** Bookkeeping persisted on the `clusters` row. Nothing display-related lives here. */
export interface ClusterBookkeeping {
  clusterKey: string;
  /** Minimum publication over all members, deleted ones included. */
  earliestPublishedAt: string;
  /** All members, deleted ones included. */
  listingCount: number;
  /** Distinct sources over all members, deleted ones included. */
  sourceCount: number;
  /** Members whose `messageStatus` is `available`. */
  availableListingCount: number;
  /** True when no member is available; a hidden cluster never renders. */
  hidden: boolean;
  /** Copied from the representative (or the earliest member when all are deleted). */
  section: FacetValue;
  category: FacetValue;
  demand: FacetValue;
  /** Available member with the lowest `publishedAt`, then the lowest `id`; null when none is available. */
  representativeId: number | null;
}

/**
 * - `created` — the listing opened a new cluster (a first post, or an edit
 *   whose new key matches no open cluster).
 * - `joined` — the listing joined a different existing cluster.
 * - `kept` — the listing stayed in its current cluster; only bookkeeping moved.
 */
export type ClusterOutcome = 'created' | 'joined' | 'kept';

export interface ReclusterInput {
  /** The listing after the change: a new post, an edit, or a status flip. */
  listing: ClusterableListing;
  /** The cluster currently holding the listing, or null for a new listing. */
  currentClusterId: number | null;
  /**
   * Candidate clusters with their current members. Include the current cluster
   * when there is one; include clusters sharing the listing's key. Passing all
   * clusters is safe — the reducer only joins clusters whose key matches.
   */
  candidates: readonly ClusterState[];
  /** Id the caller has allocated for a new cluster; used only when `outcome` is `created`. */
  newClusterId: number;
}

export interface ClusterUpsert {
  id: number;
  bookkeeping: ClusterBookkeeping;
}

export interface ReclusterResult {
  assignment: {
    listingId: number;
    /** The cluster the listing belongs to after the change. */
    clusterId: number;
    clusterKey: string;
    outcome: ClusterOutcome;
  };
  /**
   * Clusters whose bookkeeping changed, target first, old cluster second.
   * Persist each one; an `id` equal to `newClusterId` means insert.
   */
  upserts: readonly ClusterUpsert[];
  /** Clusters left with no members; delete them after moving their listings. */
  dissolved: readonly number[];
}

export interface ClusterRemoval {
  clusterId: number;
  /** True when no member survives; the cluster and its digest matches must be deleted. */
  dissolved: boolean;
  /** Bookkeeping over the surviving members, or null when `dissolved`. */
  bookkeeping: ClusterBookkeeping | null;
}

/** Stable hash of normalized text, price key, and city key. Photo is not part of it. */
export function clusterKey(input: ClusterKeyInput): string {
  // JSON escaping makes the three fields unambiguous: no separator can be
  // smuggled between text and a price or city key.
  const canonical = JSON.stringify([input.textNormalized, input.priceKey, input.cityKey]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** True when a listing carries enough signal to merge with another post. */
export function isSpecificEnough(input: ClusterKeyInput): boolean {
  if (input.priceKey !== null || input.cityKey !== null) return true;
  // Count code points, not UTF-16 units, so emoji count as one character.
  return [...input.textNormalized].length >= MIN_SPECIFIC_TEXT_LENGTH;
}

/**
 * Recomputes every bookkeeping column from the members.
 *
 * The earliest publication and both counts include deleted members, because a
 * deleted original still anchors the cluster's age and a source that removed a
 * post still belongs in its trail. The representative is the available member
 * with the lowest `publishedAt`, then the lowest `id`. When every member is
 * deleted the cluster is hidden and has no representative; section, category,
 * and demand then fall back to the earliest member so the row keeps a value
 * (nothing renders a hidden cluster).
 */
export function buildBookkeeping(
  key: string,
  members: readonly ClusterableListing[],
): ClusterBookkeeping {
  if (members.length === 0) {
    throw new TypeError('a cluster must have at least one member');
  }

  let earliest = members[0];
  if (earliest === undefined) throw new TypeError('a cluster must have at least one member');

  const sourceIds = new Set<number>();
  const available: ClusterableListing[] = [];

  for (const member of members) {
    publishedAtMs(member); // validates the timestamp before it is persisted
    if (compareMembers(member, earliest) < 0) earliest = member;
    sourceIds.add(member.sourceId);
    if (member.messageStatus === 'available') available.push(member);
  }

  let representative: ClusterableListing | undefined;
  for (const member of available) {
    if (representative === undefined || compareMembers(member, representative) < 0) {
      representative = member;
    }
  }

  const facetSource = representative ?? earliest;

  return {
    clusterKey: key,
    earliestPublishedAt: new Date(publishedAtMs(earliest)).toISOString(),
    listingCount: members.length,
    sourceCount: sourceIds.size,
    availableListingCount: available.length,
    hidden: available.length === 0,
    section: facetSource.section,
    category: facetSource.category,
    demand: facetSource.demand,
    representativeId: representative?.id ?? null,
  };
}

/**
 * The collector's write path for one changed listing: a new post, an edit, or a
 * `message_status` flip. Returns the assignment plus the bookkeeping rows to
 * persist and any cluster that must be deleted.
 *
 * An edit keeps the listing in its current cluster while the key is unchanged
 * (including a status flip), so re-running the same change is a no-op. When the
 * key changes, the listing leaves the old cluster, which is recomputed and
 * dissolved if it empties; under a single-key model a cluster never splits.
 */
export function reclusterListing(input: ReclusterInput): ReclusterResult {
  const { listing } = input;
  const key = clusterKey(listing);
  const listingMs = publishedAtMs(listing);

  const current =
    input.currentClusterId === null
      ? undefined
      : input.candidates.find((candidate) => candidate.id === input.currentClusterId);

  const keptBecauseKeyMatches = current !== undefined && current.clusterKey === key;

  let targetId: number;
  let targetMembers: ClusterableListing[];
  let outcome: ClusterOutcome;

  if (current !== undefined && keptBecauseKeyMatches) {
    targetId = current.id;
    targetMembers = [...withoutListing(current.members, listing.id), listing];
    outcome = 'kept';
  } else {
    const candidate = pickJoinableCluster(input.candidates, current?.id ?? null, key, listing, listingMs);

    if (candidate === undefined) {
      targetId = input.newClusterId;
      targetMembers = [listing];
      outcome = 'created';
    } else {
      targetId = candidate.id;
      targetMembers = [...withoutListing(candidate.members, listing.id), listing];
      outcome = 'joined';
    }
  }

  const upserts: ClusterUpsert[] = [
    {
      id: targetId,
      bookkeeping: buildBookkeeping(key, targetMembers),
    },
  ];
  const dissolved: number[] = [];

  if (current !== undefined && current.id !== targetId) {
    const remaining = withoutListing(current.members, listing.id);
    if (remaining.length === 0) {
      dissolved.push(current.id);
    } else {
      upserts.push({
        id: current.id,
        bookkeeping: buildBookkeeping(current.clusterKey, remaining),
      });
    }
  }

  return {
    assignment: {
      listingId: listing.id,
      clusterId: targetId,
      clusterKey: key,
      outcome,
    },
    upserts,
    dissolved,
  };
}

/**
 * Retention's write path: recompute a cluster over the members that survive the
 * purge, before their rows are deleted. Removing the earliest member moves
 * `earliest_published_at` forward and shrinks the counts; removing every member
 * dissolves the cluster.
 */
export function removeMembers(cluster: ClusterState, listingIds: readonly number[]): ClusterRemoval {
  const removed = new Set(listingIds);
  const survivors = cluster.members.filter((member) => !removed.has(member.id));

  if (survivors.length === 0) {
    return { clusterId: cluster.id, dissolved: true, bookkeeping: null };
  }

  return {
    clusterId: cluster.id,
    dissolved: false,
    bookkeeping: buildBookkeeping(cluster.clusterKey, survivors),
  };
}

/** The cluster a listing currently belongs to, or null. */
export function findClusterOf(
  clusters: readonly ClusterState[],
  listingId: number,
): ClusterState | null {
  return clusters.find((cluster) => cluster.members.some((member) => member.id === listingId)) ?? null;
}

function pickJoinableCluster(
  candidates: readonly ClusterState[],
  currentId: number | null,
  key: string,
  listing: ClusterableListing,
  listingMs: number,
): ClusterState | undefined {
  if (!isSpecificEnough(listing)) return undefined;

  let best: ClusterState | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.id === currentId) continue;
    if (candidate.clusterKey !== key) continue;
    if (candidate.members.length === 0) continue;

    const earliest = earliestMember(candidate.members);
    const distance = Math.abs(listingMs - publishedAtMs(earliest));
    if (distance > CLUSTER_WINDOW_MS) continue;

    // Closest earliest publication wins; the lowest id breaks a tie.
    if (distance < bestDistance || (distance === bestDistance && best !== undefined && candidate.id < best.id)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function earliestMember(members: readonly ClusterableListing[]): ClusterableListing {
  let earliest = members[0];
  if (earliest === undefined) throw new TypeError('a cluster must have at least one member');
  for (const member of members) {
    if (compareMembers(member, earliest) < 0) earliest = member;
  }
  return earliest;
}

/** Orders by publication, then by id; ids are unique so the order is total. */
function compareMembers(a: ClusterableListing, b: ClusterableListing): number {
  const difference = publishedAtMs(a) - publishedAtMs(b);
  return difference !== 0 ? difference : a.id - b.id;
}

function withoutListing(
  members: readonly ClusterableListing[],
  listingId: number,
): ClusterableListing[] {
  return members.filter((member) => member.id !== listingId);
}

function publishedAtMs(listing: Pick<ClusterableListing, 'publishedAt' | 'id'>): number {
  const ms = Date.parse(listing.publishedAt);
  if (Number.isNaN(ms)) {
    throw new TypeError(`listing ${listing.id} has an invalid publishedAt: ${listing.publishedAt}`);
  }
  return ms;
}
