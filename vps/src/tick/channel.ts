/**
 * The channel scan: `t.me/s/<channel>` paginated backwards with `?before=`.
 *
 * One page carries up to twenty messages. The scan walks back until it reaches
 * the source cursor, runs out of messages, or spends its request budget, then
 * writes the whole batch once. Fetching before writing is deliberate: a page
 * that fails to parse must fail the run without leaving half a batch behind,
 * and an album split across a page boundary still collapses.
 *
 * The fetched pages also double as the free edit/deletion detector for their
 * messages: stored listings inside the contiguous fetched id range are marked
 * deleted when their id no longer appears. Nothing outside that range is
 * inferred, so a page boundary is never mistaken for a deletion.
 */

import { parseTelegramHtml, type ParsedMessage } from '../parser/telegram-html.js';
import { channelPageUrl } from '../net/urls.js';
import type { PoliteClient, RequestBudget } from '../net/polite-client.js';
import type { Store } from '../store/index.js';
import type { Source } from '../store/types.js';

import { describeFailure, emptyScanCounts, type ScanCounts, type ScanResult } from './types.js';
import { ingestBatch, markListingDeleted } from './write.js';

export interface ChannelScanOptions {
  store: Store;
  client: PoliteClient;
  source: Source;
  /** Per-source budget for this tick, shared with no other source. */
  budget: RequestBudget;
  ingestEnabled: boolean;
  /** Observation time for inserted/updated rows, ISO 8601 UTC. */
  fetchedAt: string;
}

export async function scanChannel(options: ChannelScanOptions): Promise<ScanResult> {
  const { store, client, source, budget, ingestEnabled, fetchedAt } = options;
  const cursor = source.cursorMessageId;
  const counts = emptyScanCounts();

  if (cursor === null) {
    return {
      status: 'ok',
      counts,
      cursorBefore: null,
      cursorAfter: null,
      errorSample: null,
    };
  }

  const messages: ParsedMessage[] = [];
  const seen = new Set<number>();
  let lowestSeen = Number.POSITIVE_INFINITY;
  let highestSeen = Number.NEGATIVE_INFINITY;
  let before: number | null = null;
  let firstPage = true;
  let failed = false;
  let errorSample: string | null = null;

  for (;;) {
    const response = await client.request(
      channelPageUrl(source.username, before === null ? {} : { before }),
      {
        sourceId: source.id,
        sourceEnabled: source.enabled,
        ingestEnabled,
        budget,
      },
    );

    if (!response.ok) {
      counts.errors += 1;
      if (response.outcome === 'budget_exhausted') {
        errorSample ??= 'budget exhausted before the next channel page';
        break;
      }
      failed = true;
      errorSample ??= describeFailure(response);
      break;
    }

    const parsed = parseTelegramHtml(response.html, { requireMessages: firstPage });
    firstPage = false;

    if (parsed.kind === 'parse_error') {
      failed = true;
      counts.errors += 1;
      errorSample = `parse_error: ${parsed.error}`;
      break;
    }
    if (parsed.kind === 'not_found') {
      failed = true;
      counts.errors += 1;
      errorSample = 'channel page answered not_found';
      break;
    }
    if (parsed.messages.length === 0) {
      break;
    }

    let pageLowest = Number.POSITIVE_INFINITY;
    let pageHighest = Number.NEGATIVE_INFINITY;
    for (const message of parsed.messages) {
      if (!seen.has(message.id)) {
        seen.add(message.id);
        messages.push(message);
      }
      pageLowest = Math.min(pageLowest, message.id);
      pageHighest = Math.max(pageHighest, message.id);
    }
    lowestSeen = Math.min(lowestSeen, pageLowest);
    highestSeen = Math.max(highestSeen, pageHighest);

    if (pageLowest <= cursor) {
      break;
    }
    if (budget.used >= budget.limit) {
      counts.errors += 1;
      errorSample ??= 'budget exhausted before the next channel page';
      break;
    }
    before = pageLowest;
  }

  counts.requests = budget.used;

  if (failed) {
    return { status: 'failed', counts, cursorBefore: cursor, cursorAfter: cursor, errorSample };
  }

  counts.fetched = messages.length;
  const batch = ingestBatch(messages, { store, source, fetchedAt });
  counts.inserted += batch.inserted;
  counts.updated += batch.updated;
  counts.skipped += batch.skipped;

  if (lowestSeen !== Number.POSITIVE_INFINITY) {
    markGoneListings(store, source, seen, lowestSeen, highestSeen, counts);
  }

  const cursorAfter =
    highestSeen === Number.NEGATIVE_INFINITY ? cursor : Math.max(cursor, highestSeen);

  return { status: 'ok', counts, cursorBefore: cursor, cursorAfter, errorSample };
}

/**
 * A stored, available listing of this source whose id falls inside the
 * contiguous fetched range but was not on any fetched page is gone. Only ids
 * inside the range are considered: a page that was never fetched proves
 * nothing.
 */
function markGoneListings(
  store: Store,
  source: Source,
  seen: ReadonlySet<number>,
  lowest: number,
  highest: number,
  counts: ScanCounts,
): void {
  for (let id = lowest; id <= highest; id += 1) {
    if (seen.has(id)) continue;
    const stored = store.listings.find(source.id, id);
    if (stored === null || stored.messageStatus !== 'available') continue;
    if (markListingDeleted(store, stored)) {
      counts.skipped += 1;
    }
  }
}
