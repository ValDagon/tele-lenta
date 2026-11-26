/**
 * Raw SQLite rows and their conversion into the camelCase types the store
 * exposes. All SQL lives in this directory; the rest of the app sees typed
 * functions only.
 */

import type { ClusterableListing } from '../cluster/cluster.js';

import type {
  AccessStatus,
  Cluster,
  IngestRun,
  Listing,
  ListingPhoto,
  MessageStatus,
  ParserFailure,
  SavedSearch,
  Section,
  Source,
  SourceKind,
  User,
  UserSettings,
} from './types.js';

export interface SourceRow {
  id: number;
  username: string;
  title: string | null;
  kind: SourceKind;
  region: string;
  section_hint: Section;
  category_hint: string | null;
  enabled: number;
  is_spam_source: number;
  interval_seconds: number;
  cursor_message_id: number | null;
  last_success_at: string | null;
  last_error_at: string | null;
  consecutive_failures: number;
  access_status: AccessStatus;
  created_at: string;
}

export interface ListingRow {
  id: number;
  source_id: number;
  message_id: number;
  url: string;
  published_at: string;
  edited_at: string | null;
  fetched_at: string;
  text_raw: string;
  text_normalized: string;
  search_text: string;
  content_hash: string;
  title: string | null;
  section: Section;
  category: string;
  demand: string;
  city: string | null;
  price_raw: string | null;
  price_value: number | null;
  price_currency: string | null;
  price_period: string | null;
  salary_raw: string | null;
  event_starts_at: string | null;
  has_photos: number;
  photo_count: number;
  has_video: number;
  is_ad: number;
  is_spam: number;
  cluster_id: number | null;
  message_status: MessageStatus;
  parser_version: string;
}

export interface ListingPhotoRow {
  listing_id: number;
  position: number;
  url: string;
  width: number | null;
  height: number | null;
}

export interface ClusterRow {
  id: number;
  cluster_key: string;
  section: string;
  category: string;
  demand: string;
  earliest_published_at: string;
  first_seen_at: string;
  listing_count: number;
  source_count: number;
  available_listing_count: number;
  hidden: number;
}

export interface IngestRunRow {
  id: number;
  source_id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  cursor_before: number | null;
  cursor_after: number | null;
  error_sample: string | null;
}

export interface ParserFailureRow {
  id: number;
  source_id: number;
  message_id: number | null;
  url: string;
  error: string;
  html_excerpt: string | null;
  created_at: string;
}

export interface UserRow {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  allowed: number;
  digest_enabled: number;
  quiet_start: string;
  quiet_end: string;
  spam_filter: number;
  ad_filter: number;
  digest_undeliverable_at: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export const USER_COLUMNS = `telegram_user_id, username, first_name, allowed, digest_enabled,
  quiet_start, quiet_end, spam_filter, ad_filter, digest_undeliverable_at, created_at,
  last_seen_at`;

export interface SavedSearchRow {
  id: number;
  user_id: number;
  name: string;
  query: string;
  section: Section | null;
  categories_json: string;
  demand: 'offer' | 'wanted' | null;
  sources_json: string;
  enabled: number;
  last_checked_at: string | null;
  last_sent_at: string | null;
  created_at: string;
}

export const SAVED_SEARCH_COLUMNS = `id, user_id, name, query, section, categories_json,
  demand, sources_json, enabled, last_checked_at, last_sent_at, created_at`;

export const SOURCE_COLUMNS = `id, username, title, kind, region, section_hint, category_hint,
  enabled, is_spam_source, interval_seconds, cursor_message_id, last_success_at,
  last_error_at, consecutive_failures, access_status, created_at`;

export const LISTING_COLUMNS = `id, source_id, message_id, url, published_at, edited_at,
  fetched_at, text_raw, text_normalized, search_text, content_hash, title, section,
  category, demand, city, price_raw, price_value, price_currency, price_period,
  salary_raw, event_starts_at, has_photos, photo_count, has_video, is_ad, is_spam,
  cluster_id, message_status, parser_version`;

export const CLUSTER_COLUMNS = `id, cluster_key, section, category, demand,
  earliest_published_at, first_seen_at, listing_count, source_count,
  available_listing_count, hidden`;

export const INGEST_RUN_COLUMNS = `id, source_id, started_at, finished_at, status,
  fetched, inserted, updated, skipped, errors, cursor_before, cursor_after, error_sample`;

export const PARSER_FAILURE_COLUMNS = `id, source_id, message_id, url, error,
  html_excerpt, created_at`;

const bool = (value: number): boolean => value === 1;

export function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    username: row.username,
    title: row.title,
    kind: row.kind,
    region: row.region,
    sectionHint: row.section_hint,
    categoryHint: row.category_hint,
    enabled: bool(row.enabled),
    isSpamSource: bool(row.is_spam_source),
    intervalSeconds: row.interval_seconds,
    cursorMessageId: row.cursor_message_id,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    consecutiveFailures: row.consecutive_failures,
    accessStatus: row.access_status,
    createdAt: row.created_at,
  };
}

export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    sourceId: row.source_id,
    messageId: row.message_id,
    url: row.url,
    publishedAt: row.published_at,
    editedAt: row.edited_at,
    fetchedAt: row.fetched_at,
    textRaw: row.text_raw,
    textNormalized: row.text_normalized,
    searchText: row.search_text,
    contentHash: row.content_hash,
    title: row.title,
    section: row.section,
    category: row.category,
    demand: row.demand,
    city: row.city,
    priceRaw: row.price_raw,
    priceValue: row.price_value,
    priceCurrency: row.price_currency,
    pricePeriod: row.price_period,
    salaryRaw: row.salary_raw,
    eventStartsAt: row.event_starts_at,
    hasPhotos: bool(row.has_photos),
    photoCount: row.photo_count,
    hasVideo: bool(row.has_video),
    isAd: bool(row.is_ad),
    isSpam: bool(row.is_spam),
    clusterId: row.cluster_id,
    messageStatus: row.message_status,
    parserVersion: row.parser_version,
  };
}

export function toPhoto(row: ListingPhotoRow): ListingPhoto {
  return {
    listingId: row.listing_id,
    position: row.position,
    url: row.url,
    width: row.width,
    height: row.height,
  };
}

export function toCluster(row: ClusterRow): Cluster {
  return {
    id: row.id,
    clusterKey: row.cluster_key,
    section: row.section,
    category: row.category,
    demand: row.demand,
    earliestPublishedAt: row.earliest_published_at,
    firstSeenAt: row.first_seen_at,
    listingCount: row.listing_count,
    sourceCount: row.source_count,
    availableListingCount: row.available_listing_count,
    hidden: bool(row.hidden),
  };
}

export function toIngestRun(row: IngestRunRow): IngestRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    fetched: row.fetched,
    inserted: row.inserted,
    updated: row.updated,
    skipped: row.skipped,
    errors: row.errors,
    cursorBefore: row.cursor_before,
    cursorAfter: row.cursor_after,
    errorSample: row.error_sample,
  };
}

export function toParserFailure(row: ParserFailureRow): ParserFailure {
  return {
    id: row.id,
    sourceId: row.source_id,
    messageId: row.message_id,
    url: row.url,
    error: row.error,
    htmlExcerpt: row.html_excerpt,
    createdAt: row.created_at,
  };
}

export function toUser(row: UserRow): User {
  return {
    telegramUserId: row.telegram_user_id,
    username: row.username,
    firstName: row.first_name,
    allowed: row.allowed === 1,
    digestEnabled: row.digest_enabled === 1,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    spamFilter: row.spam_filter === 1,
    adFilter: row.ad_filter === 1,
    digestUndeliverableAt: row.digest_undeliverable_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** The settings half of a `users` row, shared by `GET /v1/session` and `/v1/me`. */
export function toUserSettings(row: UserRow): UserSettings {
  return {
    digestEnabled: row.digest_enabled === 1,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    spamFilter: row.spam_filter === 1,
    adFilter: row.ad_filter === 1,
  };
}

/**
 * Decodes a JSON array column. A corrupted value (or one that is not an
 * array) reads as `[]`: the reader must never lose the whole list because one
 * row was written badly.
 */
function parseJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringArray(value: string): string[] {
  return parseJsonArray(value).filter((item): item is string => typeof item === 'string');
}

function numberArray(value: string): number[] {
  return parseJsonArray(value).filter(
    (item): item is number => typeof item === 'number' && Number.isSafeInteger(item),
  );
}

export function toSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    query: row.query,
    section: row.section,
    categories: stringArray(row.categories_json),
    demand: row.demand,
    sources: numberArray(row.sources_json),
    enabled: row.enabled === 1,
    lastCheckedAt: row.last_checked_at,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

const toInt = (value: number): number => (value === 1 ? 1 : 0);

/**
 * A stored listing as the clusterer's member view.
 *
 * The clusterer requires `priceKey` and `cityKey` on members, but the spec's
 * `listings` table stores `price_value`/`price_currency` and `city` rather than
 * those derived keys. Bookkeeping never reads them, so they are reconstructed
 * here for type compatibility only. The changed listing handed to
 * `reclusterListing` always carries the keys computed by ingestion.
 */
export function toClusterableListing(row: ListingRow): ClusterableListing {
  return {
    id: row.id,
    sourceId: row.source_id,
    publishedAt: row.published_at,
    textNormalized: row.text_normalized,
    priceKey: storedPriceKey(row),
    cityKey: storedCityKey(row),
    section: row.section,
    category: row.category,
    demand: row.demand,
    messageStatus: row.message_status,
  };
}

function storedPriceKey(row: ListingRow): string | null {
  if (row.price_currency === null && row.price_value === null) {
    // A raw-only price ("договорная") has no numeric key; keep it as the key.
    return row.price_raw === null ? null : row.price_raw.trim().toLowerCase();
  }
  return `${row.price_currency ?? ''}:${row.price_value ?? ''}`;
}

function storedCityKey(row: ListingRow): string | null {
  return row.city === null ? null : row.city.trim().toLowerCase();
}
