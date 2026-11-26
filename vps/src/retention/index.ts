/**
 * Retention as one pass (spec «Retention», ticket #18).
 *
 * The order is the point: every cluster that is about to lose a member is
 * recomputed over its survivors **before** any listing row is purged, so the
 * `clusters` row never references a listing that no longer exists. Only then
 * are the old listings deleted (their photo rows cascade and their digest
 * matches cascade with a dissolved cluster), then clusters left with no
 * listings at all are swept, then parser failures are pruned.
 *
 * A crash between the recompute and the purge is safe: the recompute is
 * idempotent over the surviving members, so the next pass recomputes again
 * from the same rows. Per cluster the recompute commits in one transaction;
 * the purge and the empty-cluster sweep are one statement each. Wiring this
 * into the tick, and the operator alerts, belong to layer B.
 */

import { removeMembers } from '../cluster/cluster.js';
import { parserFailureCutoff } from '../store/parser-failures.js';
import type { Store } from '../store/index.js';

/** Listings older than this are purged by retention. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Re-exported so callers reach both retention windows through this module. */
export { PARSER_FAILURE_RETENTION_MS } from '../store/parser-failures.js';

export interface RetentionResult {
  listingsDeleted: number;
  clustersRecomputed: number;
  clustersDeleted: number;
  parserFailuresPruned: number;
}

export interface RunRetentionOptions {
  store: Store;
  /** Epoch ms; defaults to `Date.now`, injectable for deterministic tests. */
  now?: () => number;
}

/**
 * Runs one retention pass and returns the counters.
 *
 * 1. For every cluster holding a member published before the cutoff, recompute
 *    the bookkeeping over the survivors and persist it; a cluster with no
 *    survivor is dissolved (and its digest matches cascade with it).
 * 2. Delete the listings older than the cutoff. Photo rows cascade.
 * 3. Delete clusters that no listing references any more — orphans left by
 *    this purge or by an earlier interrupted run.
 * 4. Prune parser failures older than seven days.
 */
export function runRetention(options: RunRetentionOptions): RetentionResult {
  const { store } = options;
  const nowMs = (options.now ?? Date.now)();
  const cutoff = new Date(nowMs - RETENTION_MS).toISOString();

  let clustersRecomputed = 0;
  let clustersDeleted = 0;

  for (const clusterId of store.clusters.listWithMembersBefore(cutoff)) {
    const state = store.clusters.getState(clusterId);
    if (state === null) continue; // dissolved by an earlier iteration or a concurrent writer

    const oldIds = state.members
      .filter((member) => Date.parse(member.publishedAt) < Date.parse(cutoff))
      .map((member) => member.id);
    if (oldIds.length === 0) continue;

    // Recompute first: the purge below must never leave a cluster pointing at
    // a missing member. `applyRemoval` persists or deletes in one transaction.
    const removal = removeMembers(state, oldIds);
    store.clusters.applyRemoval(removal);
    clustersRecomputed += 1;
    if (removal.dissolved) clustersDeleted += 1;
  }

  const listingsDeleted = store.listings.deleteOlderThan(cutoff);
  clustersDeleted += store.clusters.deleteEmptyClusters();

  const parserFailuresPruned = store.parserFailures.pruneOlderThan(
    parserFailureCutoff(new Date(nowMs).toISOString()),
  );

  return { listingsDeleted, clustersRecomputed, clustersDeleted, parserFailuresPruned };
}
