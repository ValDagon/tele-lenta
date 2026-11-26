/**
 * Parser failures are recorded, not thrown: an unparsable event post or an
 * unreadable widget lands here for diagnostics and is pruned after 7 days
 * (spec «Retention»). A short HTML excerpt is stored, never a full page.
 */

import type { Db } from '../db.js';

import { PARSER_FAILURE_COLUMNS, nowIso, toParserFailure, type ParserFailureRow } from './rows.js';
import type { ParserFailure, ParserFailureInput } from './types.js';

export const PARSER_FAILURE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ParserFailureStore {
  add(input: ParserFailureInput): number;
  list(sourceId?: number): ParserFailure[];
  /** Prunes rows created strictly before the cutoff; returns the row count. */
  pruneOlderThan(cutoff: string): number;
}

export function createParserFailureStore(db: Db): ParserFailureStore {
  const insert = db.prepare(`
    INSERT INTO parser_failures (source_id, message_id, url, error, html_excerpt, created_at)
    VALUES (@source_id, @message_id, @url, @error, @html_excerpt, @created_at)
  `);
  const selectAll = db.prepare(`SELECT ${PARSER_FAILURE_COLUMNS} FROM parser_failures ORDER BY id`);
  const selectBySource = db.prepare(
    `SELECT ${PARSER_FAILURE_COLUMNS} FROM parser_failures WHERE source_id = ? ORDER BY id`,
  );
  const deleteOlder = db.prepare('DELETE FROM parser_failures WHERE created_at < ?');

  return {
    add(input: ParserFailureInput): number {
      return Number(
        insert.run({
          source_id: input.sourceId,
          message_id: input.messageId ?? null,
          url: input.url,
          error: input.error,
          html_excerpt: input.htmlExcerpt ?? null,
          created_at: input.createdAt ?? nowIso(),
        }).lastInsertRowid,
      );
    },
    list(sourceId?: number): ParserFailure[] {
      const rows =
        sourceId === undefined
          ? (selectAll.all() as ParserFailureRow[])
          : (selectBySource.all(sourceId) as ParserFailureRow[]);
      return rows.map(toParserFailure);
    },
    pruneOlderThan(cutoff: string): number {
      return deleteOlder.run(cutoff).changes;
    },
  };
}

/** The prune cutoff for `now`, i.e. the oldest failure to keep. */
export function parserFailureCutoff(now: string = nowIso()): string {
  return new Date(Date.parse(now) - PARSER_FAILURE_RETENTION_MS).toISOString();
}
