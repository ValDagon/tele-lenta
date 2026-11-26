/**
 * The Источник registry is data: every operation the tick and the owner need is
 * a row update here. A source is enabled only after its manual backfill has set
 * a cursor; the tick skips rows whose cursor is null.
 */

import type { Db } from '../db.js';

import { SOURCE_COLUMNS, nowIso, toSource, type SourceRow } from './rows.js';
import type { AccessStatus, Source } from './types.js';

export interface SourceStore {
  /** Enabled rows for the tick and the Mini App's filter sheet. */
  listEnabled(): Source[];
  listAll(): Source[];
  getById(id: number): Source | null;
  getByUsername(username: string): Source | null;
  /** Forward-only scan position: the highest message id scanned, hit or miss. */
  setCursor(id: number, cursorMessageId: number | null): void;
  /** A successful poll: freshness advances and the failure streak resets. */
  recordSuccess(id: number, at?: string): void;
  /** A failed poll: the error time advances and the streak grows. */
  recordFailure(id: number, at?: string): void;
  /** Per-source kill switch. */
  setEnabled(id: number, enabled: boolean): void;
  setAccessStatus(id: number, accessStatus: AccessStatus): void;
}

export function createSourceStore(db: Db): SourceStore {
  const selectById = db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`);
  const selectByUsername = db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE username = ?`);
  const selectEnabled = db.prepare(
    `SELECT ${SOURCE_COLUMNS} FROM sources WHERE enabled = 1 ORDER BY id`,
  );
  const selectAll = db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY id`);

  const updateCursor = db.prepare('UPDATE sources SET cursor_message_id = ? WHERE id = ?');
  const updateSuccess = db.prepare(
    'UPDATE sources SET last_success_at = ?, consecutive_failures = 0 WHERE id = ?',
  );
  const updateFailure = db.prepare(
    'UPDATE sources SET last_error_at = ?, consecutive_failures = consecutive_failures + 1 WHERE id = ?',
  );
  const updateEnabled = db.prepare('UPDATE sources SET enabled = ? WHERE id = ?');
  const updateAccess = db.prepare('UPDATE sources SET access_status = ? WHERE id = ?');

  const getById = (id: number): Source | null => {
    const row = selectById.get(id) as SourceRow | undefined;
    return row === undefined ? null : toSource(row);
  };

  return {
    listEnabled(): Source[] {
      return (selectEnabled.all() as SourceRow[]).map(toSource);
    },
    listAll(): Source[] {
      return (selectAll.all() as SourceRow[]).map(toSource);
    },
    getById,
    getByUsername(username: string): Source | null {
      const row = selectByUsername.get(username) as SourceRow | undefined;
      return row === undefined ? null : toSource(row);
    },
    setCursor(id: number, cursorMessageId: number | null): void {
      updateCursor.run(cursorMessageId, id);
    },
    recordSuccess(id: number, at: string = nowIso()): void {
      updateSuccess.run(at, id);
    },
    recordFailure(id: number, at: string = nowIso()): void {
      updateFailure.run(at, id);
    },
    setEnabled(id: number, enabled: boolean): void {
      updateEnabled.run(enabled ? 1 : 0, id);
    },
    setAccessStatus(id: number, accessStatus: AccessStatus): void {
      updateAccess.run(accessStatus, id);
    },
  };
}
