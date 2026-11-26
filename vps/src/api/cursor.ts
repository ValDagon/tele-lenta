/**
 * The feed cursor is opaque to clients: base64url of the JSON pair
 * `[earliest_published_at, cluster_id]`, the last row of the previous page.
 *
 * The pair plus the `(earliest_published_at DESC, id DESC)` sort means a page
 * never repeats a card under an unchanged corpus. A cluster whose
 * `earliest_published_at` moves during pagination can cross the cursor once;
 * the spec accepts that one-off reorder.
 */

import type { FeedCursor } from '../store/feed.js';

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.earliestPublishedAt, cursor.clusterId]),
    'utf8',
  ).toString('base64url');
}

/** Returns null for anything that is not a valid cursor; the route answers 400. */
export function decodeCursor(raw: string): FeedCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [publishedAt, clusterId] = parsed;
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) return null;
  if (typeof clusterId !== 'number' || !Number.isSafeInteger(clusterId) || clusterId < 0) {
    return null;
  }

  return { earliestPublishedAt: publishedAt, clusterId };
}
