/**
 * Wire shapes of the BFF responses, mirrored from `vps/src/api/types.ts`.
 * The BFF returns the VPS JSON unchanged, so these names are the contract.
 */

export type Section = "classifieds" | "jobs" | "events";
export type SourceKind = "group" | "channel";
export type AccessStatus = "public" | "invite" | "closed";
export type MessageStatus = "available" | "deleted";

export interface MoneySlot {
  raw: string;
  value: number | null;
  currency: string | null;
  period: string | null;
}

export interface EventSlot {
  starts_at: string;
}

export interface PhotoSlot {
  url: string;
  count: number;
}

export interface CardSourceSummary {
  id: number;
  username: string;
  name: string;
  monogram: string;
}

export interface CardPhoto {
  url: string;
  width: number | null;
  height: number | null;
}

export interface DetailSourceRow {
  listing_id: number;
  source_id: number;
  username: string;
  name: string;
  monogram: string;
  message_url: string;
  access: AccessStatus;
  message_status: MessageStatus;
  is_first: boolean;
  published_at: string;
}

interface CardBase {
  id: number;
  section: Section;
  category: string;
  demand: string;
  title: string;
  city?: string;
  earliest_published_at: string;
  price?: MoneySlot;
  salary?: MoneySlot;
  event?: EventSlot;
  photo?: PhotoSlot;
}

export interface Card extends CardBase {
  sources: CardSourceSummary[];
  source_count: number;
}

export interface CardDetail extends CardBase {
  body: string;
  photos: CardPhoto[];
  hashtags: string[];
  sources: DetailSourceRow[];
  source_count: number;
}

export interface FeedResponse {
  cards: Card[];
  next_cursor: string | null;
  total: number;
  updated_at: string | null;
}

export interface SourceListItem {
  id: number;
  username: string;
  name: string;
  monogram: string;
  kind: SourceKind;
  section: Section;
}

export interface SourcesResponse {
  sources: SourceListItem[];
}

export interface UserSettings {
  digest_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  spam_filter: boolean;
  ad_filter: boolean;
}

export interface SessionResponse {
  allowed: boolean;
  settings: UserSettings;
  enabled_source_count: number;
  retention_days: number;
  digest_interval_seconds: number;
}

export interface SavedSearch {
  id: number;
  name: string;
  query: string | null;
  section: Section | null;
  categories: string[];
  demand: string | null;
  sources: number[];
  enabled: boolean;
  last_checked_at: string | null;
  last_sent_at: string | null;
  created_at: string;
}

export interface SavedSearchInput {
  name?: string;
  query?: string | null;
  section?: Section | null;
  categories?: string[];
  demand?: string | null;
  sources?: number[];
  enabled?: boolean;
}

export type SavedSearchAction = "list" | "create" | "update" | "delete";
export type MeAction = "get" | "update";

export interface DeleteSavedSearchResponse {
  deleted: boolean;
}

export interface MeResponse extends UserSettings {
  telegram_user_id?: number;
  username?: string | null;
  first_name?: string | null;
  allowed?: boolean;
}

export interface FeedInput {
  section?: Section;
  category?: string;
  demand?: string;
  sources?: number[];
  q?: string;
  cursor?: string;
  limit?: number;
}
