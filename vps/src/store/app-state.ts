/**
 * `app_state` holds the flags that are not per-source rows: the global
 * `INGEST_ENABLED` kill switch, the last global ingest time, and alert
 * throttling. Values are strings; callers own the encoding.
 */

import type { Db } from '../db.js';

export interface AppStateStore {
  get(key: string): string | null;
  getAll(): Record<string, string>;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export function createAppStateStore(db: Db): AppStateStore {
  const selectOne = db.prepare('SELECT value FROM app_state WHERE key = ?');
  const selectAll = db.prepare('SELECT key, value FROM app_state ORDER BY key');
  const upsert = db.prepare(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `);
  const remove = db.prepare('DELETE FROM app_state WHERE key = ?');

  return {
    get(key: string): string | null {
      const row = selectOne.get(key) as { value: string } | undefined;
      return row === undefined ? null : row.value;
    },
    getAll(): Record<string, string> {
      const entries = (selectAll.all() as Array<{ key: string; value: string }>).map(
        (row) => [row.key, row.value] as const,
      );
      return Object.fromEntries(entries);
    },
    set(key: string, value: string): void {
      upsert.run(key, value);
    },
    delete(key: string): void {
      remove.run(key);
    },
  };
}
