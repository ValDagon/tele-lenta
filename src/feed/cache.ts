import type { Card, Section } from "../api/types";
import { readString, writeString } from "../lib/storage";

/**
 * One localStorage key holds the last viewed section: its most recent 50 cards
 * and the feed's `updated_at`. The payload is versioned so a shape change
 * discards the old cache instead of rendering garbage.
 */
export const FEED_CACHE_KEY = "tele_lenta.feed";
export const FEED_CACHE_VERSION = 1;
export const FEED_CACHE_LIMIT = 50;
export const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

export interface FeedCache {
  version: typeof FEED_CACHE_VERSION;
  section: Section;
  cards: Card[];
  updated_at: string | null;
  saved_at: string;
}

const SECTIONS: ReadonlyArray<Section> = ["classifieds", "jobs", "events"];

function isSection(value: unknown): value is Section {
  return typeof value === "string" && SECTIONS.includes(value as Section);
}

function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Record<string, unknown>;

  return (
    typeof card.id === "number" &&
    typeof card.section === "string" &&
    typeof card.category === "string" &&
    typeof card.demand === "string" &&
    typeof card.title === "string" &&
    typeof card.earliest_published_at === "string" &&
    Array.isArray(card.sources) &&
    typeof card.source_count === "number"
  );
}

function isFeedCache(value: unknown): value is FeedCache {
  if (typeof value !== "object" || value === null) return false;
  const cache = value as Record<string, unknown>;

  return (
    cache.version === FEED_CACHE_VERSION &&
    isSection(cache.section) &&
    Array.isArray(cache.cards) &&
    cache.cards.every(isCard) &&
    (cache.updated_at === null || typeof cache.updated_at === "string") &&
    typeof cache.saved_at === "string"
  );
}

export function readFeedCache(): FeedCache | null {
  const raw = readString(FEED_CACHE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isFeedCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFeedCache(
  section: Section,
  cards: readonly Card[],
  updatedAt: string | null,
  now: number = Date.now(),
): FeedCache {
  const cache: FeedCache = {
    version: FEED_CACHE_VERSION,
    section,
    cards: cards.slice(0, FEED_CACHE_LIMIT),
    updated_at: updatedAt,
    saved_at: new Date(now).toISOString(),
  };

  writeString(FEED_CACHE_KEY, JSON.stringify(cache));
  return cache;
}

export function cacheAgeMs(cache: FeedCache, now: number = Date.now()): number {
  const saved = Date.parse(cache.saved_at);
  if (Number.isNaN(saved)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - saved);
}

/** Younger than five minutes: render it immediately while the network runs. */
export function isFeedCacheFresh(
  cache: FeedCache,
  now: number = Date.now(),
  ttlMs: number = FEED_CACHE_TTL_MS,
): boolean {
  return cacheAgeMs(cache, now) < ttlMs;
}
