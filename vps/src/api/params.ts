/**
 * Query-string validation for the read routes. Everything here throws
 * `ApiError('invalid_request')` for a malformed value; the route handlers
 * never see a partially parsed query.
 */

import { normalizeSearchQuery } from '../ingest/text.js';
import type { FeedCursor } from '../store/feed.js';
import type { Section } from '../store/index.js';

import { decodeCursor } from './cursor.js';
import { invalidRequest } from './errors.js';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

const SECTIONS: readonly Section[] = ['classifieds', 'jobs', 'events'];

type RawQuery = Record<string, unknown>;

function firstValue(raw: RawQuery, name: string): unknown {
  const value = raw[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function optionalString(raw: RawQuery, name: string): string | null {
  const value = firstValue(raw, name);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw invalidRequest(`${name} must be a single string`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function parseSection(raw: RawQuery): Section | null {
  const value = optionalString(raw, 'section');
  if (value === null) return null;
  if (!SECTIONS.includes(value as Section)) {
    throw invalidRequest('section must be one of classifieds, jobs, events');
  }
  return value as Section;
}

export function parseLimit(raw: RawQuery): number {
  const value = firstValue(raw, 'limit');
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalidRequest('limit must be a non-negative integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidRequest('limit must be a non-negative integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

/** Repeated `sources` values; a value must be a positive source id. */
export function parseSourceIds(raw: RawQuery): number[] | null {
  const value = raw.sources;
  if (value === undefined || value === null) return null;

  const values = Array.isArray(value) ? value : [value];
  const ids: number[] = [];
  for (const item of values) {
    if (typeof item !== 'string' || !/^\d+$/.test(item)) {
      throw invalidRequest('sources must be positive integer source ids');
    }
    const id = Number(item);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw invalidRequest('sources must be positive integer source ids');
    }
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length === 0) throw invalidRequest('sources must not be empty');
  return ids;
}

/**
 * Search is a substring match over `search_text`, which is already lowercased,
 * diacritics-folded, and transliterated. The query goes through the same
 * pipeline, so «Подгорица» and `Podgorica` meet on `podgorica`.
 *
 * An absent or blank `q` means no search. A present query shorter than two
 * normalized characters is rejected rather than silently matching everything;
 * a long query is capped at 100 normalized characters.
 */
export function parseSearch(raw: RawQuery): string | null {
  const value = raw.q;
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || typeof value !== 'string') {
    throw invalidRequest('q must be a single string');
  }
  if (value.trim() === '') return null;

  const normalized = normalizeSearchQuery(value);
  if (normalized.length < MIN_QUERY_LENGTH) {
    throw invalidRequest(`q must be at least ${MIN_QUERY_LENGTH} characters`);
  }
  return normalized.slice(0, MAX_QUERY_LENGTH);
}

export function parseCursor(raw: RawQuery): FeedCursor | null {
  const value = firstValue(raw, 'cursor');
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalidRequest('cursor must be a string');

  const cursor = decodeCursor(value);
  if (cursor === null) throw invalidRequest('cursor is not a valid feed cursor');
  return cursor;
}

export function parseCategory(raw: RawQuery): string | null {
  return optionalString(raw, 'category');
}

export function parseDemand(raw: RawQuery): string | null {
  return optionalString(raw, 'demand');
}

/** `GET /v1/cards/{id}`; a non-numeric id is a malformed request, not a 404. */
export function parseClusterId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw invalidRequest('card id must be a positive integer');
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw invalidRequest('card id must be a positive integer');
  }
  return id;
}

/** A saved-search path id; malformed input is `invalid_request`, not `not_found`. */
export function parseSavedSearchId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw invalidRequest('saved search id must be a positive integer');
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw invalidRequest('saved search id must be a positive integer');
  }
  return id;
}
