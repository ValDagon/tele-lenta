/**
 * Saved searches (spec «Data model (VPS SQLite)», «Saved searches and digest»).
 *
 * A row is the reader's stored query plus filters; the digest worker (#16)
 * advances `last_checked_at` and `last_sent_at`. Creating a row seeds
 * `last_checked_at` from `created_at`, so the first digest contains only what
 * appeared after saving.
 *
 * The cap is enforced here, not by a trigger: `create` returns `null` when the
 * user already has ten searches, and the route turns that into
 * `invalid_request`. The transaction makes the check and the insert atomic, so
 * two concurrent creates cannot both pass the check.
 */

import type { Db } from '../db.js';

import {
  SAVED_SEARCH_COLUMNS,
  nowIso,
  toSavedSearch,
  type SavedSearchRow,
} from './rows.js';
import type { SavedSearch, SavedSearchInput, SavedSearchPatch } from './types.js';

/** The v1 limit from the spec: ten saved searches per user. */
export const MAX_SAVED_SEARCHES = 10;

export interface SavedSearchStore {
  /** Newest first: `created_at DESC, id DESC`. */
  list(userId: number): SavedSearch[];
  /** Strictly scoped to the user; another user's id reads as `null`. */
  get(userId: number, id: number): SavedSearch | null;
  count(userId: number): number;
  /**
   * Inserts a search, or returns `null` when the user is at the ten-search cap.
   * `at` is the injected clock; it seeds both `created_at` and
   * `last_checked_at`.
   */
  create(userId: number, input: SavedSearchInput, at?: string): SavedSearch | null;
  /**
   * Partial update of the editable fields only. Bookkeeping columns
   * (`last_checked_at`, `last_sent_at`, `created_at`) are never touched. A
   * missing or foreign id returns `null`.
   */
  update(
    userId: number,
    id: number,
    patch: SavedSearchPatch,
    at?: string,
  ): SavedSearch | null;
  /** `false` when no row of this user had that id. */
  delete(userId: number, id: number): boolean;
}

export function createSavedSearchStore(db: Db): SavedSearchStore {
  const selectByUser = db.prepare(
    `SELECT ${SAVED_SEARCH_COLUMNS} FROM saved_searches
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC`,
  );
  const selectOne = db.prepare(
    `SELECT ${SAVED_SEARCH_COLUMNS} FROM saved_searches WHERE user_id = ? AND id = ?`,
  );
  const selectCount = db.prepare(
    'SELECT COUNT(*) AS count FROM saved_searches WHERE user_id = ?',
  );
  const insert = db.prepare(`
    INSERT INTO saved_searches
      (user_id, name, query, section, categories_json, demand, sources_json,
       enabled, last_checked_at, last_sent_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  const remove = db.prepare('DELETE FROM saved_searches WHERE user_id = ? AND id = ?');

  const count = (userId: number): number =>
    (selectCount.get(userId) as { count: number }).count;

  const get = (userId: number, id: number): SavedSearch | null => {
    const row = selectOne.get(userId, id) as SavedSearchRow | undefined;
    return row === undefined ? null : toSavedSearch(row);
  };

  const insertIfRoom = db.transaction(
    (userId: number, input: SavedSearchInput, at: string): number | null => {
      if (count(userId) >= MAX_SAVED_SEARCHES) return null;
      const result = insert.run(
        userId,
        input.name,
        input.query ?? '',
        input.section ?? null,
        JSON.stringify(input.categories ?? []),
        input.demand ?? null,
        JSON.stringify(input.sources ?? []),
        (input.enabled ?? true) ? 1 : 0,
        at,
        at,
      );
      return Number(result.lastInsertRowid);
    },
  );

  return {
    list(userId: number): SavedSearch[] {
      return (selectByUser.all(userId) as SavedSearchRow[]).map(toSavedSearch);
    },
    get,
    count,
    create(userId: number, input: SavedSearchInput, at?: string): SavedSearch | null {
      const id = insertIfRoom(userId, input, at ?? nowIso());
      return id === null ? null : get(userId, id);
    },
    update(
      userId: number,
      id: number,
      patch: SavedSearchPatch,
      at?: string,
    ): SavedSearch | null {
      void at; // The clock is part of the signature; edits do not stamp a column.
      const assignments: string[] = [];
      const values: unknown[] = [];

      if (patch.name !== undefined) {
        assignments.push('name = ?');
        values.push(patch.name);
      }
      if (patch.query !== undefined) {
        assignments.push('query = ?');
        values.push(patch.query);
      }
      if (patch.section !== undefined) {
        assignments.push('section = ?');
        values.push(patch.section);
      }
      if (patch.categories !== undefined) {
        assignments.push('categories_json = ?');
        values.push(JSON.stringify(patch.categories));
      }
      if (patch.demand !== undefined) {
        assignments.push('demand = ?');
        values.push(patch.demand);
      }
      if (patch.sources !== undefined) {
        assignments.push('sources_json = ?');
        values.push(JSON.stringify(patch.sources));
      }
      if (patch.enabled !== undefined) {
        assignments.push('enabled = ?');
        values.push(patch.enabled ? 1 : 0);
      }

      if (assignments.length > 0) {
        const result = db
          .prepare(
            `UPDATE saved_searches SET ${assignments.join(', ')} WHERE user_id = ? AND id = ?`,
          )
          .run(...values, userId, id);
        if (result.changes === 0) return null;
      }

      return get(userId, id);
    },
    delete(userId: number, id: number): boolean {
      return remove.run(userId, id).changes > 0;
    },
  };
}
