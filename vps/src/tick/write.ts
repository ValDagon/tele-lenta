/**
 * The single write path shared by the channel and group scans.
 *
 * Given the parsed messages of one source batch, it collapses albums, classifies
 * every surviving message, writes new listings, applies edits, records
 * unparsable event posts in `parser_failures`, and hands the clusterer the
 * changed listing. It never fetches: the scans own HTTP and the tick owns the
 * run rows.
 *
 * Deleting a listing is a bookkeeping recompute, not a re-cluster: the cluster
 * key cannot change when a message disappears, so the cluster's own stored key
 * is used. Edit passes carry fresh facets from the classifier and go through
 * `reclusterListing` normally.
 */

import { classifyMessage, type ClassifiedListing } from '../ingest/classify.js';
import { collapseAlbums } from '../ingest/albums.js';
import { matchCity } from '../ingest/city.js';
import type { ParsedMessage } from '../parser/telegram-html.js';
import {
  buildBookkeeping,
  clusterKey,
  reclusterListing,
  type ClusterableListing,
} from '../cluster/cluster.js';
import type { Store } from '../store/index.js';
import type { Listing, ListingRecheck, MessageStatus, Source } from '../store/types.js';

export interface BatchCounts {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface IngestBatchOptions {
  store: Store;
  source: Source;
  /** Observation time for every row written in this batch, ISO 8601 UTC. */
  fetchedAt: string;
}

/** The public message URL; the same form works for channels and groups. */
export function messageUrl(username: string, messageId: number): string {
  return `https://t.me/${username}/${messageId}`;
}

/**
 * Collapses albums, then writes each surviving message once. Ids already stored
 * are compared by `content_hash`: an unchanged message is a skip, a changed one
 * is an edit that re-runs classification and clustering. Absorbed album ids are
 * counted as skipped and never stored.
 */
export function ingestBatch(
  messages: readonly ParsedMessage[],
  options: IngestBatchOptions,
): BatchCounts {
  const counts: BatchCounts = { inserted: 0, updated: 0, skipped: 0 };

  for (const group of collapseAlbums(messages)) {
    counts.skipped += group.collapsedIds.length;

    const message = group.survivor;
    const existing = options.store.listings.find(options.source.id, message.id);
    const result = classifyMessage(message, options.source, {
      sourceId: options.source.id,
      url: messageUrl(options.source.username, message.id),
      fetchedAt: options.fetchedAt,
    });

    if (result.kind === 'dropped') {
      counts.skipped += 1;
      continue;
    }

    if (result.kind === 'event_unparseable') {
      options.store.parserFailures.add({
        sourceId: options.source.id,
        messageId: result.messageId,
        url: result.url,
        error: result.error,
      });
      counts.skipped += 1;
      continue;
    }

    if (existing === null) {
      writeNewListing(options, result);
      counts.inserted += 1;
      continue;
    }

    if (existing.contentHash === result.listing.contentHash) {
      counts.skipped += 1;
      continue;
    }

    writeEditedListing(options, existing, result);
    counts.updated += 1;
  }

  return counts;
}

/**
 * Marks one stored listing deleted and recomputes its cluster immediately
 * (`available_listing_count`, `hidden`). Returns false when it was already
 * deleted or has no cluster.
 */
export function markListingDeleted(store: Store, listing: Listing): boolean {
  if (listing.messageStatus === 'deleted') {
    return false;
  }

  store.listings.setMessageStatus(listing.id, 'deleted');
  if (listing.clusterId === null) {
    return true;
  }

  const state = store.clusters.getState(listing.clusterId);
  if (state === null) {
    return true;
  }

  const members = state.members.map((member) =>
    member.id === listing.id ? { ...member, messageStatus: 'deleted' as MessageStatus } : member,
  );
  store.clusters.applyBookkeeping(state.id, buildBookkeeping(state.clusterKey, members));
  return true;
}

function writeNewListing(options: IngestBatchOptions, result: ClassifiedListing): void {
  const listingId = options.store.listings.insert(result.listing);
  applyCluster(options, {
    listingId,
    publishedAt: result.listing.publishedAt,
    facets: result.facets,
    currentClusterId: null,
  });
}

function writeEditedListing(
  options: IngestBatchOptions,
  existing: Listing,
  result: ClassifiedListing,
): void {
  const listing = result.listing;
  const recheck: ListingRecheck = {
    textRaw: listing.textRaw ?? '',
    textNormalized: listing.textNormalized ?? '',
    searchText: listing.searchText ?? '',
    contentHash: listing.contentHash,
    editedAt: options.fetchedAt,
    title: listing.title ?? null,
    section: listing.section,
    category: listing.category,
    demand: listing.demand,
    city: listing.city ?? null,
    priceRaw: listing.priceRaw ?? null,
    priceValue: listing.priceValue ?? null,
    priceCurrency: listing.priceCurrency ?? null,
    pricePeriod: listing.pricePeriod ?? null,
    salaryRaw: listing.salaryRaw ?? null,
    eventStartsAt: listing.eventStartsAt ?? null,
    hasPhotos: listing.hasPhotos ?? false,
    hasVideo: listing.hasVideo ?? false,
    isAd: listing.isAd ?? false,
    isSpam: listing.isSpam ?? false,
    fetchedAt: options.fetchedAt,
    photos: listing.photos ?? [],
  };
  options.store.listings.updateFromRecheck(existing.id, recheck);

  // A message that reappears after a not-found re-check is live again.
  if (existing.messageStatus !== 'available') {
    options.store.listings.setMessageStatus(existing.id, 'available');
  }

  applyCluster(options, {
    listingId: existing.id,
    publishedAt: listing.publishedAt,
    facets: result.facets,
    currentClusterId: existing.clusterId,
  });
}

interface ClusterWrite {
  listingId: number;
  publishedAt: string;
  facets: ClassifiedListing['facets'];
  currentClusterId: number | null;
}

function applyCluster(options: IngestBatchOptions, write: ClusterWrite): void {
  const { store, source } = options;
  const listing: ClusterableListing = {
    id: write.listingId,
    sourceId: source.id,
    publishedAt: write.publishedAt,
    textNormalized: write.facets.textNormalized,
    priceKey: write.facets.priceKey,
    cityKey: write.facets.cityKey,
    section: write.facets.section,
    category: write.facets.category,
    demand: write.facets.demand,
    messageStatus: 'available',
  };

  const key = clusterKey(listing);
  const candidates = store.clusters.loadCandidates(key, write.currentClusterId);
  const result = reclusterListing({
    listing,
    currentClusterId: write.currentClusterId,
    candidates,
    newClusterId: store.clusters.nextId(),
  });
  store.clusters.applyRecluster(result);
}

/**
 * A listing row as the clusterer sees it when only its status changes. The
 * cluster's own key is used by the caller, so the reconstructed keys below are
 * only for other consumers (retention, future re-checks).
 */
export function clusterableFromListing(listing: Listing): ClusterableListing {
  return {
    id: listing.id,
    sourceId: listing.sourceId,
    publishedAt: listing.publishedAt,
    textNormalized: listing.textNormalized,
    priceKey: storedPriceKey(listing),
    cityKey: storedCityKey(listing),
    section: listing.section,
    category: listing.category,
    demand: listing.demand,
    messageStatus: listing.messageStatus,
  };
}

/** Mirrors `src/ingest/price.ts`: `eur:650` or `eur:650/month`. */
function storedPriceKey(listing: Listing): string | null {
  if (listing.priceValue === null || listing.priceCurrency === null) {
    return listing.priceRaw === null ? null : listing.priceRaw.trim().toLowerCase();
  }
  const suffix = listing.pricePeriod === null ? '' : `/${listing.pricePeriod}`;
  return `${listing.priceCurrency}:${listing.priceValue}${suffix}`;
}

/** The display city maps back onto its own dictionary key. */
function storedCityKey(listing: Listing): string | null {
  if (listing.city === null) return null;
  return matchCity(listing.city)?.key ?? listing.city.trim().toLowerCase();
}
