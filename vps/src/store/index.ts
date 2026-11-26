/**
 * The store layer: typed operations over `better-sqlite3` with all SQL kept in
 * this directory. The collector tick and the API call these functions; they
 * never build SQL of their own.
 */

import type { Db } from '../db.js';

import { createAppStateStore, type AppStateStore } from './app-state.js';
import { createClusterStore, type ClusterStore } from './clusters.js';
import { createDigestStore, type DigestStore } from './digests.js';
import { createFeedStore, type FeedStore } from './feed.js';
import { createIngestRunStore, type IngestRunStore } from './ingest-runs.js';
import { createListingStore, type ListingStore } from './listings.js';
import { createNegativeCacheStore, type NegativeCacheStore } from './negative-cache.js';
import { createParserFailureStore, type ParserFailureStore } from './parser-failures.js';
import {
  createSavedSearchStore,
  type SavedSearchStore,
} from './saved-searches.js';
import { createSourceStore, type SourceStore } from './sources.js';
import { createUserStore, type UserStore } from './users.js';

export interface Store {
  sources: SourceStore;
  listings: ListingStore;
  clusters: ClusterStore;
  /** Read-only feed, card detail, and freshness queries. */
  feed: FeedStore;
  ingestRuns: IngestRunStore;
  negativeCache: NegativeCacheStore;
  parserFailures: ParserFailureStore;
  appState: AppStateStore;
  /** Allowlist and session settings; the source of truth for access. */
  users: UserStore;
  /** The reader's stored queries; the digest worker reads them (#16). */
  savedSearches: SavedSearchStore;
  /** Due searches, match ledger, and digest delivery bookkeeping. */
  digests: DigestStore;
}

export function createStore(db: Db): Store {
  return {
    sources: createSourceStore(db),
    listings: createListingStore(db),
    clusters: createClusterStore(db),
    feed: createFeedStore(db),
    ingestRuns: createIngestRunStore(db),
    negativeCache: createNegativeCacheStore(db),
    parserFailures: createParserFailureStore(db),
    appState: createAppStateStore(db),
    users: createUserStore(db),
    savedSearches: createSavedSearchStore(db),
    digests: createDigestStore(db),
  };
}

export { createAppStateStore, type AppStateStore } from './app-state.js';
export { createClusterStore, type ClusterStore } from './clusters.js';
export {
  createDigestStore,
  type DigestCandidate,
  type DigestStore,
  type DueSearch,
  type UnsentMatch,
} from './digests.js';
export {
  createFeedStore,
  type ClusterDetail,
  type ClusterMember,
  type ClusterSource,
  type FeedCardRow,
  type FeedCursor,
  type FeedFilters,
  type FeedPage,
  type FeedQuery,
  type FeedStore,
} from './feed.js';
export { createIngestRunStore, type IngestRunStore } from './ingest-runs.js';
export {
  createListingStore,
  type HotWindowQuery,
  type ListingStore,
} from './listings.js';
export {
  createNegativeCacheStore,
  NEGATIVE_CACHE_TTL_MS,
  type NegativeCacheStore,
} from './negative-cache.js';
export {
  createParserFailureStore,
  PARSER_FAILURE_RETENTION_MS,
  parserFailureCutoff,
  type ParserFailureStore,
} from './parser-failures.js';
export {
  createSavedSearchStore,
  MAX_SAVED_SEARCHES,
  type SavedSearchStore,
} from './saved-searches.js';
export { createSourceStore, type SourceStore } from './sources.js';
export { createUserStore, type UserStore } from './users.js';
export type * from './types.js';
