/**
 * The Дайджест ledger (spec «Data model (VPS SQLite)», «Bot and digest»).
 *
 * This module owns the persisted half of the digest worker: which saved
 * searches are due, which clusters a search matches, the repeat-suppression
 * ledger in `saved_search_matches`, and the delivery bookkeeping on
 * `saved_searches` and `users`. Sending is not here; the worker composes a
 * message from `unsentForUser` and records success with `markSent`.
 *
 * `matchSearch` must return exactly the clusters `GET /v1/feed` would return
 * for the same filters. The predicate below mirrors `feed.ts` deliberately —
 * same representative join, same section/category/demand/source conditions,
 * same `search_text` substring rule, same ordering — and a parity test keeps
 * the two from drifting. The only extra clause is the time window.
 *
 * The match rows and the `last_checked_at` advance commit in one transaction,
 * so a tick that dies mid-check re-runs the same query without losing or
 * double-writing a match.
 */

import type { Db } from '../db.js';

import { normalizeSearchQuery } from '../ingest/text.js';

import type { Section } from './types.js';

/** A saved search that a digest run should check now, with its user settings. */
export interface DueSearch {
  id: number;
  userId: number;
  name: string;
  query: string;
  section: Section | null;
  categories: string[];
  demand: 'offer' | 'wanted' | null;
  sources: number[];
  lastCheckedAt: string;
  digestEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  digestUndeliverableAt: string | null;
}

/** One matching cluster plus the representative listing's display fields. */
export interface DigestCandidate {
  clusterId: number;
  earliestPublishedAt: string;
  section: Section;
  category: string;
  demand: string;
  title: string;
  city: string | null;
  priceRaw: string | null;
  salaryRaw: string | null;
  eventStartsAt: string | null;
}

/** A written match that has not been delivered yet. */
export interface UnsentMatch extends DigestCandidate {
  searchId: number;
  searchName: string;
  matchedAt: string;
}

export interface DigestStore {
  /** Due searches for one run, ordered by user then search id. */
  listDue(nowIso: string, intervalMs: number): DueSearch[];
  /**
   * Visible clusters matching the search whose `earliest_published_at` falls
   * in `(sinceIso, nowIso]`, newest first.
   */
  matchSearch(search: DueSearch, sinceIso: string, nowIso: string): DigestCandidate[];
  /** Writes the matches and advances `last_checked_at` in one transaction. */
  recordCheck(
    searchId: number,
    matches: readonly { clusterId: number }[],
    checkedAt: string,
  ): void;
  /** Undelivered, still-visible matches of one user. */
  unsentForUser(userId: number): UnsentMatch[];
  /** Stamps the delivered matches and refreshes `last_sent_at` on the searches. */
  markSent(
    userId: number,
    searchIds: readonly number[],
    clusterIds: readonly number[],
    atIso: string,
  ): void;
  /** Remembers that the bot cannot deliver to this user. */
  markUndeliverable(userId: number, atIso: string): void;
}

/** Mirrors `REPRESENTATIVE_JOIN` in `feed.ts`; see the module note. */
const REPRESENTATIVE_JOIN = `
  JOIN listings rep ON rep.id = (
    SELECT l.id FROM listings l
    WHERE l.cluster_id = c.id AND l.message_status = 'available'
    ORDER BY l.published_at, l.id
    LIMIT 1
  )
`;

const CANDIDATE_COLUMNS = `
  c.id AS cluster_id, c.earliest_published_at, c.section, c.category, c.demand,
  rep.title, rep.city, rep.price_raw, rep.salary_raw, rep.event_starts_at
`;

interface DueRow {
  id: number;
  user_id: number;
  name: string;
  query: string;
  section: Section | null;
  categories_json: string;
  demand: 'offer' | 'wanted' | null;
  sources_json: string;
  last_checked_at: string;
  digest_enabled: number;
  quiet_start: string;
  quiet_end: string;
  digest_undeliverable_at: string | null;
}

interface CandidateRow {
  cluster_id: number;
  earliest_published_at: string;
  section: Section;
  category: string;
  demand: string;
  title: string | null;
  city: string | null;
  price_raw: string | null;
  salary_raw: string | null;
  event_starts_at: string | null;
}

interface UnsentRow extends CandidateRow {
  saved_search_id: number;
  search_name: string;
  matched_at: string;
}

function stringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function numberArray(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item))
      : [];
  } catch {
    return [];
  }
}

/** Same escaping as `feed.ts`: a `%` in a query is a literal percent. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

function toCandidate(row: CandidateRow): DigestCandidate {
  return {
    clusterId: row.cluster_id,
    earliestPublishedAt: row.earliest_published_at,
    section: row.section,
    category: row.category,
    demand: row.demand,
    title: row.title ?? '',
    city: row.city,
    priceRaw: row.price_raw,
    salaryRaw: row.salary_raw,
    eventStartsAt: row.event_starts_at,
  };
}

export function createDigestStore(db: Db): DigestStore {
  const selectDue = db.prepare(`
    SELECT s.id, s.user_id, s.name, s.query, s.section, s.categories_json,
           s.demand, s.sources_json, s.last_checked_at,
           u.digest_enabled, u.quiet_start, u.quiet_end, u.digest_undeliverable_at
    FROM saved_searches s
    JOIN users u ON u.telegram_user_id = s.user_id
    WHERE s.enabled = 1
      AND u.allowed = 1
      AND u.digest_enabled = 1
      AND u.digest_undeliverable_at IS NULL
      AND s.last_checked_at IS NOT NULL
      AND s.last_checked_at <= ?
    ORDER BY s.user_id, s.id
  `);

  const insertMatch = db.prepare(`
    INSERT OR IGNORE INTO saved_search_matches
      (saved_search_id, cluster_id, matched_at, sent_at)
    VALUES (?, ?, ?, NULL)
  `);
  const advanceCheck = db.prepare(
    'UPDATE saved_searches SET last_checked_at = ? WHERE id = ?',
  );
  const recordCheckTx = db.transaction(
    (searchId: number, matches: readonly { clusterId: number }[], checkedAt: string) => {
      for (const match of matches) {
        insertMatch.run(searchId, match.clusterId, checkedAt);
      }
      advanceCheck.run(checkedAt, searchId);
    },
  );

  const markUndeliverableRow = db.prepare(
    'UPDATE users SET digest_undeliverable_at = ? WHERE telegram_user_id = ?',
  );

  const markSentTx = db.transaction(
    (
      userId: number,
      searchIds: readonly number[],
      clusterIds: readonly number[],
      atIso: string,
    ) => {
      if (clusterIds.length > 0) {
        // Scope by the user, not by the due-search list: an unsent backlog row
        // can belong to a search that is not due again yet, and it was part of
        // this message all the same. Leaving it unmarked would send it twice.
        db.prepare(
          `UPDATE saved_search_matches SET sent_at = ?
           WHERE sent_at IS NULL
             AND cluster_id IN (${placeholders(clusterIds.length)})
             AND saved_search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)`,
        ).run(atIso, ...clusterIds, userId);
      }

      if (searchIds.length > 0) {
        db.prepare(
          `UPDATE saved_searches SET last_sent_at = ?
           WHERE user_id = ? AND id IN (${placeholders(searchIds.length)})`,
        ).run(atIso, userId, ...searchIds);
      }
    },
  );

  return {
    listDue(nowIso: string, intervalMs: number): DueSearch[] {
      const cutoff = new Date(Date.parse(nowIso) - intervalMs).toISOString();
      const rows = selectDue.all(cutoff) as DueRow[];
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        query: row.query,
        section: row.section,
        categories: stringArray(row.categories_json),
        demand: row.demand,
        sources: numberArray(row.sources_json),
        lastCheckedAt: row.last_checked_at,
        digestEnabled: row.digest_enabled === 1,
        quietStart: row.quiet_start,
        quietEnd: row.quiet_end,
        digestUndeliverableAt: row.digest_undeliverable_at,
      }));
    },

    matchSearch(
      search: DueSearch,
      sinceIso: string,
      nowIso: string,
    ): DigestCandidate[] {
      const conditions = [
        'c.hidden = 0',
        'c.earliest_published_at > ?',
        'c.earliest_published_at <= ?',
      ];
      const params: Array<string | number> = [sinceIso, nowIso];

      if (search.section !== null) {
        conditions.push('c.section = ?');
        params.push(search.section);
      }
      if (search.categories.length > 0) {
        conditions.push(`c.category IN (${placeholders(search.categories.length)})`);
        params.push(...search.categories);
      }
      if (search.demand !== null) {
        conditions.push('c.demand = ?');
        params.push(search.demand);
      }
      if (search.sources.length > 0) {
        conditions.push(
          `EXISTS (SELECT 1 FROM listings filter_member
                   WHERE filter_member.cluster_id = c.id
                     AND filter_member.source_id IN (${placeholders(search.sources.length)}))`,
        );
        params.push(...search.sources);
      }

      const normalized = normalizeSearchQuery(search.query);
      if (normalized !== '') {
        conditions.push("rep.search_text LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(normalized)}%`);
      }

      const rows = db
        .prepare(
          `SELECT ${CANDIDATE_COLUMNS}
           FROM clusters c
           ${REPRESENTATIVE_JOIN}
           WHERE ${conditions.join(' AND ')}
           ORDER BY c.earliest_published_at DESC, c.id DESC`,
        )
        .all(...params) as CandidateRow[];

      return rows.map(toCandidate);
    },

    recordCheck(
      searchId: number,
      matches: readonly { clusterId: number }[],
      checkedAt: string,
    ): void {
      recordCheckTx(searchId, matches, checkedAt);
    },

    unsentForUser(userId: number): UnsentMatch[] {
      const rows = db
        .prepare(
          `SELECT m.saved_search_id, s.name AS search_name, m.matched_at,
                  ${CANDIDATE_COLUMNS}
           FROM saved_search_matches m
           JOIN saved_searches s ON s.id = m.saved_search_id
           JOIN clusters c ON c.id = m.cluster_id
           ${REPRESENTATIVE_JOIN}
           WHERE s.user_id = ? AND m.sent_at IS NULL AND c.hidden = 0
           ORDER BY m.saved_search_id, c.earliest_published_at DESC, c.id DESC`,
        )
        .all(userId) as UnsentRow[];

      return rows.map((row) => ({
        ...toCandidate(row),
        searchId: row.saved_search_id,
        searchName: row.search_name,
        matchedAt: row.matched_at,
      }));
    },

    markSent(
      userId: number,
      searchIds: readonly number[],
      clusterIds: readonly number[],
      atIso: string,
    ): void {
      markSentTx(userId, searchIds, clusterIds, atIso);
    },

    markUndeliverable(userId: number, atIso: string): void {
      markUndeliverableRow.run(atIso, userId);
    },
  };
}
