/**
 * The group scan: one embed request per message id
 * (`t.me/<group>/<id>?embed=1`), forward from `cursor_message_id + 1`.
 *
 * ## Window
 *
 * A group has no page listing, so the scan has to guess how far ahead to look.
 * The window is derived from the traffic the last run actually saw:
 *
 *     lastScanned = cursor_after - cursor_before + 1   (0 when there was no run)
 *     window      = clamp(2 * max(lastScanned, 20), 20, 200)
 *
 * so a quiet chat gets 40 ids of headroom and a busy one grows, capped at 200.
 * The per-source request budget caps it again, minus a small reserve
 * (`min(10, budget / 4)`) so the hot-window re-checks always get budget. The
 * cursor always advances to the highest id *scanned*, hit or miss, because a
 * miss is a real answer and refetching the same ids every minute would only add
 * load.
 *
 * ## Misses and errors
 *
 * Only an explicit not-found (a 404, or a 2xx body with Telegram's "Post not
 * found" widget) is a miss: it enters the 24-hour negative cache and marks a
 * stored listing deleted. A 5xx, timeout, or network error marks nothing and is
 * retried on the next run.
 *
 * ## Albums
 *
 * The whole window is fetched before anything is written, then collapsed once.
 * An album whose members arrive on separate ids therefore becomes one listing.
 *
 * ## Re-checks
 *
 * After the forward pass, known available listings from the last 48 hours whose
 * `fetched_at` is older than an hour are checked live, within the remaining
 * budget. The negative cache is deliberately not consulted here. An explicit
 * not-found marks the listing deleted; any HTTP error leaves the status alone.
 */

import { parseTelegramHtml, type ParsedMessage } from '../parser/telegram-html.js';
import { messageEmbedUrl } from '../net/urls.js';
import type { PoliteClient, RequestBudget } from '../net/polite-client.js';
import type { Store } from '../store/index.js';
import type { Source } from '../store/types.js';

import { describeFailure, emptyScanCounts, type ScanResult } from './types.js';
import { ingestBatch, markListingDeleted } from './write.js';

export const HOT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RECHECK_AFTER_MS = 60 * 60 * 1000;

export const GROUP_WINDOW_FACTOR = 2;
export const GROUP_WINDOW_MIN = 20;
export const GROUP_WINDOW_MAX = 200;

export const NO_TRAFFIC_WINDOW = 20;

/** At most this many requests in a tick are held back from the forward window. */
export const RECHECK_BUDGET_RESERVE = 10;

/** `clamp(2 * max(lastScanned, 20), 20, 200)`; exported so the formula is testable. */
export function deriveGroupWindow(lastScanned: number): number {
  const floor = Math.max(Number.isFinite(lastScanned) ? lastScanned : 0, NO_TRAFFIC_WINDOW);
  return Math.min(Math.max(GROUP_WINDOW_FACTOR * floor, GROUP_WINDOW_MIN), GROUP_WINDOW_MAX);
}

export interface GroupScanOptions {
  store: Store;
  client: PoliteClient;
  source: Source;
  budget: RequestBudget;
  ingestEnabled: boolean;
  fetchedAt: string;
  /** Epoch ms, injected by the tick so re-check cutoffs are deterministic. */
  now: number;
}

const HTML_EXCERPT_LIMIT = 500;

export async function scanGroup(options: GroupScanOptions): Promise<ScanResult> {
  const { store, client, source, budget, ingestEnabled, fetchedAt, now } = options;
  const cursor = source.cursorMessageId;
  const counts = emptyScanCounts();

  if (cursor === null) {
    return { status: 'ok', counts, cursorBefore: null, cursorAfter: null, errorSample: null };
  }

  const lastRun = store.ingestRuns.lastForSource(source.id);
  const lastScanned =
    lastRun !== null && lastRun.cursorBefore !== null && lastRun.cursorAfter !== null
      ? lastRun.cursorAfter - lastRun.cursorBefore + 1
      : 0;
  // Leave part of the budget for the hot-window re-checks; without a reserve a
  // full forward window would spend the whole budget and re-checks would never
  // run. Small budgets reserve nothing, so they are spent forward.
  const recheckReserve = Math.min(RECHECK_BUDGET_RESERVE, Math.floor(budget.limit / 4));
  const forwardAllowance = Math.max(1, budget.limit - recheckReserve);
  const window = Math.min(deriveGroupWindow(lastScanned), forwardAllowance);

  const messages: ParsedMessage[] = [];
  const seenIds = new Set<number>();
  let highestScanned = cursor;
  let failed = false;
  let errorSample: string | null = null;

  for (let id = cursor + 1; id <= cursor + window; id += 1) {
    if (budget.used >= budget.limit) {
      counts.errors += 1;
      errorSample ??= 'budget exhausted during the forward scan';
      break;
    }

    // The tick's clock, not the wall clock: the cache decision must be
    // reproducible, and a test that injects `now` must see it here too.
    if (store.negativeCache.has(source.id, id, new Date(now).toISOString())) {
      counts.skipped += 1;
      highestScanned = id;
      continue;
    }

    const url = messageEmbedUrl(source.username, id);
    const response = await client.request(url, {
      sourceId: source.id,
      sourceEnabled: source.enabled,
      ingestEnabled,
      budget,
    });

    if (!response.ok) {
      if (response.outcome === 'budget_exhausted') {
        counts.errors += 1;
        errorSample ??= 'budget exhausted during the forward scan';
        break;
      }
      if (response.outcome === 'disabled') {
        failed = true;
        counts.errors += 1;
        errorSample ??= describeFailure(response);
        break;
      }
      if (response.outcome === 'http_error' && response.status === 404) {
        markNotFound(store, source, id, counts);
        highestScanned = id;
        continue;
      }
      counts.errors += 1;
      errorSample ??= describeFailure(response);
      highestScanned = id;
      continue;
    }

    const parsed = parseTelegramHtml(response.html);
    if (parsed.kind === 'not_found') {
      markNotFound(store, source, id, counts);
      highestScanned = id;
      continue;
    }
    if (parsed.kind === 'parse_error') {
      counts.errors += 1;
      errorSample ??= `parse_error at ${id}: ${parsed.error}`;
      store.parserFailures.add({
        sourceId: source.id,
        messageId: id,
        url,
        error: parsed.error,
        htmlExcerpt: response.html.slice(0, HTML_EXCERPT_LIMIT),
        createdAt: fetchedAt,
      });
      highestScanned = id;
      continue;
    }

    for (const message of parsed.messages) {
      if (!seenIds.has(message.id)) {
        seenIds.add(message.id);
        messages.push(message);
      }
    }
    highestScanned = id;
  }

  if (!failed) {
    counts.fetched = messages.length;
    const batch = ingestBatch(messages, { store, source, fetchedAt });
    counts.inserted += batch.inserted;
    counts.updated += batch.updated;
    counts.skipped += batch.skipped;

    errorSample = await recheckHotWindow({
      store,
      client,
      source,
      budget,
      ingestEnabled,
      fetchedAt,
      now,
      seenIds,
      counts,
      errorSample,
    });
  }

  counts.requests = budget.used;
  const nothingHappened =
    counts.fetched === 0 &&
    counts.inserted === 0 &&
    counts.updated === 0 &&
    counts.skipped === 0 &&
    counts.errors > 0;
  const status = failed || nothingHappened ? 'failed' : 'ok';

  return {
    status,
    counts,
    cursorBefore: cursor,
    cursorAfter: Math.max(cursor, highestScanned),
    errorSample,
  };
}

function markNotFound(
  store: Store,
  source: Source,
  messageId: number,
  counts: ReturnType<typeof emptyScanCounts>,
): void {
  store.negativeCache.add(source.id, messageId);
  const stored = store.listings.find(source.id, messageId);
  if (stored !== null) {
    markListingDeleted(store, stored);
  }
  counts.skipped += 1;
}

interface RecheckOptions {
  store: Store;
  client: PoliteClient;
  source: Source;
  budget: RequestBudget;
  ingestEnabled: boolean;
  fetchedAt: string;
  now: number;
  seenIds: ReadonlySet<number>;
  counts: ReturnType<typeof emptyScanCounts>;
  errorSample: string | null;
}

/** Returns the updated `errorSample`; the counts object is mutated in place. */
async function recheckHotWindow(options: RecheckOptions): Promise<string | null> {
  const { store, client, source, budget, ingestEnabled, fetchedAt, now, seenIds, counts } = options;
  let errorSample = options.errorSample;

  const since = new Date(now - HOT_WINDOW_MS).toISOString();
  const staleBefore = now - RECHECK_AFTER_MS;
  const candidates = store.listings
    .listHotWindow({ since })
    .filter(
      (listing) =>
        listing.sourceId === source.id &&
        !seenIds.has(listing.messageId) &&
        Date.parse(listing.fetchedAt) <= staleBefore,
    );

  for (const listing of candidates) {
    if (budget.used >= budget.limit) break;

    const url = messageEmbedUrl(source.username, listing.messageId);
    const response = await client.request(url, {
      sourceId: source.id,
      sourceEnabled: source.enabled,
      ingestEnabled,
      budget,
    });

    if (!response.ok) {
      if (response.outcome === 'budget_exhausted' || response.outcome === 'disabled') {
        break;
      }
      if (response.outcome === 'http_error' && response.status === 404) {
        if (markListingDeleted(store, listing)) counts.skipped += 1;
        continue;
      }
      counts.errors += 1;
      errorSample ??= `recheck ${describeFailure(response)}`;
      continue;
    }

    const parsed = parseTelegramHtml(response.html);
    if (parsed.kind === 'not_found') {
      if (markListingDeleted(store, listing)) counts.skipped += 1;
      continue;
    }
    if (parsed.kind === 'parse_error') {
      counts.errors += 1;
      errorSample ??= `recheck parse_error: ${parsed.error}`;
      continue;
    }

    // A live edit pass: unchanged hashes are skipped inside `ingestBatch`.
    const batch = ingestBatch([...parsed.messages], { store, source, fetchedAt });
    counts.inserted += batch.inserted;
    counts.updated += batch.updated;
    counts.skipped += batch.skipped;
  }

  return errorSample;
}
