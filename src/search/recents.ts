import { readString, removeKey, writeString } from "../lib/storage";
import { isSearchable, normalizeQuery } from "./model";

/**
 * The last five searches, newest first. They are a local convenience, so they
 * live in `localStorage` next to the feed cache and never reach the server.
 * One-character queries are dropped: they cannot be searched anyway.
 */
export const SEARCH_RECENTS_KEY = "tele_lenta.search_recents";
export const SEARCH_RECENTS_LIMIT = 5;

/**
 * Puts a query at the top, removes an older entry that differs only by case or
 * whitespace, and caps the list. A query that cannot be searched is ignored.
 */
export function mergeRecent(
  list: readonly string[],
  rawQuery: string,
  limit: number = SEARCH_RECENTS_LIMIT,
): string[] {
  const query = normalizeQuery(rawQuery);
  if (!isSearchable(query)) return [...list];

  const key = query.toLocaleLowerCase();
  const rest = list.filter(
    (item) => normalizeQuery(item).toLocaleLowerCase() !== key,
  );

  return [query, ...rest].slice(0, limit);
}

export function parseRecents(raw: string | null): string[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  // Stored order is already newest first; reading only sanitizes and dedupes,
  // it must not reorder the list the way a new query would.
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== "string") continue;

    const query = normalizeQuery(item);
    if (!isSearchable(query)) continue;

    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(query);
    if (result.length >= SEARCH_RECENTS_LIMIT) break;
  }

  return result;
}

export function readRecents(): string[] {
  return parseRecents(readString(SEARCH_RECENTS_KEY));
}

export function writeRecents(list: readonly string[]): void {
  writeString(SEARCH_RECENTS_KEY, JSON.stringify(list));
}

/** Records a submitted or opened search; returns the new list. */
export function rememberQuery(rawQuery: string): string[] {
  const next = mergeRecent(readRecents(), rawQuery);
  writeRecents(next);
  return next;
}

export function clearRecents(): void {
  removeKey(SEARCH_RECENTS_KEY);
}
