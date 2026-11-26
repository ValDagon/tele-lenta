/**
 * Row and input types for the SQLite store.
 *
 * Timestamps are ISO-8601 UTC strings, booleans are persisted as INTEGER 0/1
 * and exposed as `boolean`, and every column name in the migrations maps to a
 * camelCase field here. Display strings and derived feed fields stay out of the
 * clusters table; see `vps/src/cluster/cluster.ts`.
 */

export type SourceKind = 'group' | 'channel';

/** Top-level feed division: Объявления, Вакансии, Мероприятия. */
export type Section = 'classifieds' | 'jobs' | 'events';

/** How a source chat can be read; carried onto the detail source rows. */
export type AccessStatus = 'public' | 'invite' | 'closed';

export type MessageStatus = 'available' | 'deleted';

/** A row of `sources`. */
export interface Source {
  id: number;
  username: string;
  title: string | null;
  kind: SourceKind;
  region: string;
  sectionHint: Section;
  categoryHint: string | null;
  enabled: boolean;
  isSpamSource: boolean;
  intervalSeconds: number;
  cursorMessageId: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  accessStatus: AccessStatus;
  createdAt: string;
}

/** A row of `listings`. */
export interface Listing {
  id: number;
  sourceId: number;
  messageId: number;
  url: string;
  publishedAt: string;
  editedAt: string | null;
  fetchedAt: string;
  textRaw: string;
  textNormalized: string;
  searchText: string;
  contentHash: string;
  title: string | null;
  section: Section;
  category: string;
  demand: string;
  city: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  priceCurrency: string | null;
  pricePeriod: string | null;
  salaryRaw: string | null;
  eventStartsAt: string | null;
  hasPhotos: boolean;
  photoCount: number;
  hasVideo: boolean;
  isAd: boolean;
  isSpam: boolean;
  clusterId: number | null;
  messageStatus: MessageStatus;
  parserVersion: string;
}

export interface ListingPhoto {
  listingId: number;
  position: number;
  url: string;
  width: number | null;
  height: number | null;
}

/** A photo as ingestion hands it to the store; `position` is assigned by insertion order. */
export interface ListingPhotoInput {
  url: string;
  width?: number | null;
  height?: number | null;
}

/** Everything needed to insert a freshly parsed listing. */
export interface NewListing {
  sourceId: number;
  messageId: number;
  url: string;
  publishedAt: string;
  editedAt?: string | null;
  fetchedAt: string;
  textRaw?: string;
  textNormalized?: string;
  searchText?: string;
  contentHash: string;
  title?: string | null;
  section: Section;
  category: string;
  demand: string;
  city?: string | null;
  priceRaw?: string | null;
  priceValue?: number | null;
  priceCurrency?: string | null;
  pricePeriod?: string | null;
  salaryRaw?: string | null;
  eventStartsAt?: string | null;
  hasPhotos?: boolean;
  hasVideo?: boolean;
  isAd?: boolean;
  isSpam?: boolean;
  clusterId?: number | null;
  messageStatus?: MessageStatus;
  parserVersion: string;
  photos?: readonly ListingPhotoInput[];
}

/**
 * The fields an edit re-check may change. `photos` is replaced only when
 * provided; omitting it leaves the stored photo rows untouched.
 */
export interface ListingRecheck {
  textRaw: string;
  textNormalized: string;
  searchText: string;
  contentHash: string;
  editedAt: string | null;
  title: string | null;
  section: Section;
  category: string;
  demand: string;
  city: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  priceCurrency: string | null;
  pricePeriod: string | null;
  salaryRaw: string | null;
  eventStartsAt: string | null;
  hasPhotos: boolean;
  hasVideo: boolean;
  isAd: boolean;
  isSpam: boolean;
  fetchedAt: string;
  photos?: readonly ListingPhotoInput[];
}

/** A row of `clusters`, bookkeeping only. */
export interface Cluster {
  id: number;
  clusterKey: string;
  section: string;
  category: string;
  demand: string;
  earliestPublishedAt: string;
  firstSeenAt: string;
  listingCount: number;
  sourceCount: number;
  availableListingCount: number;
  hidden: boolean;
}

export type IngestRunStatus = 'running' | 'ok' | 'failed' | 'skipped';

/** A row of `ingest_runs`. */
export interface IngestRun {
  id: number;
  sourceId: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  cursorBefore: number | null;
  cursorAfter: number | null;
  errorSample: string | null;
}

export interface FinishRunInput {
  status: Exclude<IngestRunStatus, 'running'>;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  cursorBefore: number | null;
  cursorAfter: number | null;
  errorSample?: string | null;
  finishedAt?: string;
}

/** A row of `parser_failures`. */
export interface ParserFailure {
  id: number;
  sourceId: number;
  messageId: number | null;
  url: string;
  error: string;
  htmlExcerpt: string | null;
  createdAt: string;
}

export interface ParserFailureInput {
  sourceId: number;
  messageId?: number | null;
  url: string;
  error: string;
  htmlExcerpt?: string | null;
  createdAt?: string;
}

/**
 * A row of `users`. `allowed` is the allowlist bit; the remaining fields are
 * the session settings the Mini App shows and the digest worker reads.
 */
export interface User {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  allowed: boolean;
  digestEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  spamFilter: boolean;
  adFilter: boolean;
  digestUndeliverableAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

/**
 * The verified Telegram profile the BFF forwards on `POST /v1/session`. The id
 * always comes from the signed request header; the body only supplies these
 * display fields, and `at` is the injected clock.
 */
export interface UserProfileInput {
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  at: string;
}

/** The digest and filter settings on a `users` row, without identity. */
export interface UserSettings {
  digestEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  spamFilter: boolean;
  adFilter: boolean;
}

/** A row of `saved_searches`, with JSON columns decoded. */
export interface SavedSearch {
  id: number;
  userId: number;
  name: string;
  /** Empty string means "no text query". */
  query: string;
  section: Section | null;
  categories: string[];
  demand: 'offer' | 'wanted' | null;
  sources: number[];
  enabled: boolean;
  lastCheckedAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
}

/** Everything a new saved search may carry; the route fills the defaults. */
export interface SavedSearchInput {
  name: string;
  query?: string;
  section?: Section | null;
  categories?: string[];
  demand?: 'offer' | 'wanted' | null;
  sources?: number[];
  enabled?: boolean;
}

/** A partial edit; omitted keys keep their stored value. */
export type SavedSearchPatch = Partial<SavedSearchInput>;
