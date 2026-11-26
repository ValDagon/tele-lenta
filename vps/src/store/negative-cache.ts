/**
 * The 24-hour negative cache for explicit not-found responses (spec
 * «Ingestion»). Only the group path's forward scan consults it; a re-check of a
 * known listing always issues a live request, so a cached miss never hides a
 * deletion.
 *
 * The spec requires the cache but does not name a table; `negative_cache` in
 * migration 0002 is its storage.
 */

import type { Db } from '../db.js';

import { nowIso } from './rows.js';

export const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface NegativeCacheStore {
  /** True while the entry has not expired. */
  has(sourceId: number, messageId: number, now?: string): boolean;
  /** Records a miss for 24 hours from `now`; a repeated miss refreshes the entry. */
  add(sourceId: number, messageId: number, now?: string): void;
  /** Removes expired entries; returns how many rows went away. */
  pruneExpired(now?: string): number;
}

export function createNegativeCacheStore(db: Db): NegativeCacheStore {
  const selectHit = db.prepare(
    'SELECT 1 AS hit FROM negative_cache WHERE source_id = ? AND message_id = ? AND expires_at > ?',
  );
  const upsertMiss = db.prepare(`
    INSERT INTO negative_cache (source_id, message_id, expires_at) VALUES (?, ?, ?)
    ON CONFLICT (source_id, message_id) DO UPDATE SET expires_at = excluded.expires_at
  `);
  const deleteExpired = db.prepare('DELETE FROM negative_cache WHERE expires_at <= ?');

  return {
    has(sourceId: number, messageId: number, now: string = nowIso()): boolean {
      return selectHit.get(sourceId, messageId, now) !== undefined;
    },
    add(sourceId: number, messageId: number, now: string = nowIso()): void {
      const expiresAt = new Date(Date.parse(now) + NEGATIVE_CACHE_TTL_MS).toISOString();
      upsertMiss.run(sourceId, messageId, expiresAt);
    },
    pruneExpired(now: string = nowIso()): number {
      return deleteExpired.run(now).changes;
    },
  };
}
