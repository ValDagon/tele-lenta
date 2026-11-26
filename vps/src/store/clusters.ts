/**
 * The clusters table is bookkeeping only and the clusterer is its sole writer.
 * This module loads cluster state in the shape `vps/src/cluster/cluster.ts`
 * expects and persists the reducer's output verbatim; it never decides an
 * assignment or recomputes a count on its own.
 */

import type {
  ClusterBookkeeping,
  ClusterRemoval,
  ClusterState,
  ReclusterResult,
} from '../cluster/cluster.js';
import type { Db } from '../db.js';

import {
  CLUSTER_COLUMNS,
  LISTING_COLUMNS,
  nowIso,
  toCluster,
  toClusterableListing,
  type ClusterRow,
  type ListingRow,
} from './rows.js';
import type { Cluster } from './types.js';

export interface ClusterStore {
  getCluster(id: number): Cluster | null;
  /** A cluster row plus its member listings, ready for the clusterer. */
  getState(id: number): ClusterState | null;
  /**
   * Candidate clusters for a changed listing: every cluster sharing its key,
   * plus its current cluster when it has one. The clusterer applies the 72-hour
   * window and specificity guard; the store does not filter.
   */
  loadCandidates(clusterKey: string, currentClusterId: number | null): ClusterState[];
  /** Id to allocate for a new cluster, as `reclusterListing` requires. */
  nextId(): number;
  /**
   * Writes one reducer result atomically: the listing's new membership, every
   * bookkeeping row (insert or update), then the dissolved clusters.
   */
  applyRecluster(result: ReclusterResult): void;
  /** Persists a bookkeeping recompute (retention and status flips). */
  applyBookkeeping(id: number, bookkeeping: ClusterBookkeeping, firstSeenAt?: string): void;
  /** Retention: recompute the survivors, or delete the emptied cluster. */
  applyRemoval(removal: ClusterRemoval): void;
  deleteCluster(id: number): void;
  /**
   * Ids of clusters holding at least one member published strictly before
   * `cutoff`. Retention recomputes these before it purges the rows.
   */
  listWithMembersBefore(cutoff: string): number[];
  /**
   * Deletes clusters no listing references any more, as a crash between a
   * purge and its cleanup or an interrupted dissolve can leave them. Returns
   * the number of deleted rows.
   */
  deleteEmptyClusters(): number;
}

export function createClusterStore(db: Db): ClusterStore {
  const selectCluster = db.prepare(`SELECT ${CLUSTER_COLUMNS} FROM clusters WHERE id = ?`);
  const selectByKey = db.prepare(
    `SELECT ${CLUSTER_COLUMNS} FROM clusters WHERE cluster_key = ? ORDER BY earliest_published_at, id`,
  );
  const selectMembers = db.prepare(
    `SELECT ${LISTING_COLUMNS} FROM listings WHERE cluster_id = ? ORDER BY published_at, id`,
  );
  const selectNextId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM clusters');

  const upsertCluster = db.prepare(`
    INSERT INTO clusters (
      id, cluster_key, section, category, demand, earliest_published_at,
      first_seen_at, listing_count, source_count, available_listing_count, hidden
    ) VALUES (
      @id, @cluster_key, @section, @category, @demand, @earliest_published_at,
      @first_seen_at, @listing_count, @source_count, @available_listing_count, @hidden
    )
    ON CONFLICT (id) DO UPDATE SET
      cluster_key = excluded.cluster_key,
      section = excluded.section,
      category = excluded.category,
      demand = excluded.demand,
      earliest_published_at = excluded.earliest_published_at,
      listing_count = excluded.listing_count,
      source_count = excluded.source_count,
      available_listing_count = excluded.available_listing_count,
      hidden = excluded.hidden
  `);

  const updateListingCluster = db.prepare('UPDATE listings SET cluster_id = ? WHERE id = ?');
  const deleteClusterRow = db.prepare('DELETE FROM clusters WHERE id = ?');
  const selectWithMembersBefore = db.prepare(
    `SELECT DISTINCT cluster_id FROM listings
     WHERE cluster_id IS NOT NULL AND published_at < ?
     ORDER BY cluster_id`,
  );
  const deleteEmptyRows = db.prepare(
    `DELETE FROM clusters
     WHERE id NOT IN (SELECT cluster_id FROM listings WHERE cluster_id IS NOT NULL)`,
  );

  const stateOf = (row: ClusterRow): ClusterState => ({
    id: row.id,
    clusterKey: row.cluster_key,
    members: (selectMembers.all(row.id) as ListingRow[]).map(toClusterableListing),
  });

  function persistBookkeeping(
    id: number,
    bookkeeping: ClusterBookkeeping,
    firstSeenAt: string,
  ): void {
    upsertCluster.run({
      id,
      cluster_key: bookkeeping.clusterKey,
      section: bookkeeping.section,
      category: bookkeeping.category,
      demand: bookkeeping.demand,
      earliest_published_at: bookkeeping.earliestPublishedAt,
      first_seen_at: firstSeenAt,
      listing_count: bookkeeping.listingCount,
      source_count: bookkeeping.sourceCount,
      available_listing_count: bookkeeping.availableListingCount,
      hidden: bookkeeping.hidden ? 1 : 0,
    });
  }

  const applyReclusterTx = db.transaction((result: ReclusterResult): void => {
    // The target cluster must exist before the listing can reference it, and
    // the listing must leave a dissolved cluster before that row is deleted.
    const firstSeenAt = nowIso();
    for (const upsert of result.upserts) {
      persistBookkeeping(upsert.id, upsert.bookkeeping, firstSeenAt);
    }
    updateListingCluster.run(result.assignment.clusterId, result.assignment.listingId);
    for (const id of result.dissolved) {
      deleteClusterRow.run(id);
    }
  });

  const applyBookkeepingTx = db.transaction(
    (id: number, bookkeeping: ClusterBookkeeping, firstSeenAt: string): void => {
      persistBookkeeping(id, bookkeeping, firstSeenAt);
    },
  );

  const applyRemovalTx = db.transaction((removal: ClusterRemoval): void => {
    if (removal.dissolved || removal.bookkeeping === null) {
      deleteClusterRow.run(removal.clusterId);
      return;
    }
    persistBookkeeping(removal.clusterId, removal.bookkeeping, nowIso());
  });

  return {
    getCluster(id: number): Cluster | null {
      const row = selectCluster.get(id) as ClusterRow | undefined;
      return row === undefined ? null : toCluster(row);
    },
    getState(id: number): ClusterState | null {
      const row = selectCluster.get(id) as ClusterRow | undefined;
      return row === undefined ? null : stateOf(row);
    },
    loadCandidates(clusterKey: string, currentClusterId: number | null): ClusterState[] {
      const states = (selectByKey.all(clusterKey) as ClusterRow[]).map(stateOf);
      if (currentClusterId === null) return states;
      if (states.some((state) => state.id === currentClusterId)) return states;

      const currentRow = selectCluster.get(currentClusterId) as ClusterRow | undefined;
      if (currentRow !== undefined) states.push(stateOf(currentRow));
      return states;
    },
    nextId(): number {
      const row = selectNextId.get() as { id: number };
      return row.id;
    },
    applyRecluster(result: ReclusterResult): void {
      applyReclusterTx(result);
    },
    applyBookkeeping(id: number, bookkeeping: ClusterBookkeeping, firstSeenAt?: string): void {
      applyBookkeepingTx(id, bookkeeping, firstSeenAt ?? nowIso());
    },
    applyRemoval(removal: ClusterRemoval): void {
      applyRemovalTx(removal);
    },
    deleteCluster(id: number): void {
      deleteClusterRow.run(id);
    },
    listWithMembersBefore(cutoff: string): number[] {
      const rows = selectWithMembersBefore.all(cutoff) as Array<{ cluster_id: number }>;
      return rows.map((row) => row.cluster_id);
    },
    deleteEmptyClusters(): number {
      return deleteEmptyRows.run().changes;
    },
  };
}
