/**
 * `ingest_runs` is the tick's audit trail (spec «Health»): one row per source
 * poll, started before the fetch and finished with counts and the cursor move.
 * A source is degraded after three consecutive zero-yield or failed runs.
 */

import type { Db } from '../db.js';

import {
  INGEST_RUN_COLUMNS,
  nowIso,
  toIngestRun,
  type IngestRunRow,
} from './rows.js';
import type { FinishRunInput, IngestRun } from './types.js';

export interface IngestRunStore {
  /** Opens a run in `running` state before the source is fetched. */
  start(sourceId: number, startedAt?: string): number;
  /** Closes a run with its counts and cursor before/after. */
  finish(id: number, input: FinishRunInput): void;
  getById(id: number): IngestRun | null;
  lastForSource(sourceId: number): IngestRun | null;
  /** One newest run per source, ordered by source id; for diagnostics. */
  listLastPerSource(): IngestRun[];
  /**
   * Enabled sources whose newest `streak` runs are all failed or zero-yield.
   * A source with fewer than `streak` runs is not degraded; one `ok` run that
   * fetched at least one message inside the window clears the condition.
   */
  degradedSourceIds(streak: number): number[];
}

export function createIngestRunStore(db: Db): IngestRunStore {
  const insertRun = db.prepare(
    "INSERT INTO ingest_runs (source_id, started_at, status) VALUES (?, ?, 'running')",
  );
  const finishRun = db.prepare(`
    UPDATE ingest_runs SET
      finished_at = @finished_at,
      status = @status,
      fetched = @fetched,
      inserted = @inserted,
      updated = @updated,
      skipped = @skipped,
      errors = @errors,
      cursor_before = @cursor_before,
      cursor_after = @cursor_after,
      error_sample = @error_sample
    WHERE id = @id
  `);
  const selectById = db.prepare(`SELECT ${INGEST_RUN_COLUMNS} FROM ingest_runs WHERE id = ?`);
  const selectLastForSource = db.prepare(
    `SELECT ${INGEST_RUN_COLUMNS} FROM ingest_runs
     WHERE source_id = ?
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
  );
  const selectLastPerSource = db.prepare(`
    SELECT ${INGEST_RUN_COLUMNS} FROM ingest_runs AS run
    WHERE run.id = (
      SELECT newest.id FROM ingest_runs AS newest
      WHERE newest.source_id = run.source_id
      ORDER BY newest.started_at DESC, newest.id DESC
      LIMIT 1
    )
    ORDER BY run.source_id
  `);
  const selectDegraded = db.prepare(`
    WITH ranked AS (
      SELECT source_id, status, fetched,
             ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY id DESC) AS rn
      FROM ingest_runs
      WHERE source_id IN (SELECT id FROM sources WHERE enabled = 1)
    )
    SELECT source_id
    FROM ranked
    WHERE rn <= @streak
    GROUP BY source_id
    HAVING COUNT(*) = @streak
       AND SUM(CASE WHEN status = 'ok' AND fetched > 0 THEN 1 ELSE 0 END) = 0
    ORDER BY source_id
  `);

  return {
    start(sourceId: number, startedAt: string = nowIso()): number {
      return Number(insertRun.run(sourceId, startedAt).lastInsertRowid);
    },
    finish(id: number, input: FinishRunInput): void {
      finishRun.run({
        id,
        finished_at: input.finishedAt ?? nowIso(),
        status: input.status,
        fetched: input.fetched,
        inserted: input.inserted,
        updated: input.updated,
        skipped: input.skipped,
        errors: input.errors,
        cursor_before: input.cursorBefore,
        cursor_after: input.cursorAfter,
        error_sample: input.errorSample ?? null,
      });
    },
    getById(id: number): IngestRun | null {
      const row = selectById.get(id) as IngestRunRow | undefined;
      return row === undefined ? null : toIngestRun(row);
    },
    lastForSource(sourceId: number): IngestRun | null {
      const row = selectLastForSource.get(sourceId) as IngestRunRow | undefined;
      return row === undefined ? null : toIngestRun(row);
    },
    listLastPerSource(): IngestRun[] {
      return (selectLastPerSource.all() as IngestRunRow[]).map(toIngestRun);
    },
    degradedSourceIds(streak: number): number[] {
      if (!Number.isSafeInteger(streak) || streak < 1) return [];
      return (selectDegraded.all({ streak }) as Array<{ source_id: number }>).map(
        (row) => row.source_id,
      );
    },
  };
}
