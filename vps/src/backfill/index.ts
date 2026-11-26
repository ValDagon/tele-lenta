/**
 * The manual backfill: the second of the two steps that add a Источник.
 *
 * A source is inserted disabled with a null cursor. This command discovers the
 * latest message id, binary-searches the id at the 7-day cut-off, enumerates
 * forward under the normal per-source politeness and request budget, writes the
 * batch through the same `ingestBatch` the tick uses, then sets the cursor and
 * enables the source. The minute tick skips a null-cursor source, so nothing is
 * polled before this succeeds.
 *
 * ## Discovery
 *
 * - **Channel** (`t.me/s/<channel>`): the first page is newest-first, so the
 *   highest parsed id is the latest message.
 * - **Group** (no page listing): ids are probed one at a time with
 *   `t.me/<group>/<id>?embed=1`. Exponential search doubles 1, 2, 4, 8 … until
 *   a probe is an explicit not-found after at least one valid id was seen, then
 *   a binary search narrows the boundary between the highest valid and the
 *   first invalid id. A parsed message is valid and an explicit not-found is
 *   the end, but a not-found may also be a deleted post: the search scans a
 *   bounded distance upward before accepting it as the boundary. An
 *   HTTP/network error is a failed probe and aborts the run without writing
 *   anything.
 *
 * ## The 7-day cut-off
 *
 * The cut-off is the lowest id whose parsed embed timestamp is at or after
 * `now - 7 days`. Ids are monotonic in time, so this is a binary search over
 * `[1, latest]`. Message ids can be missing (deleted posts): when a probe is an
 * explicit not-found, the search steps outward from the midpoint (mid, mid-1,
 * mid+1, mid-2, mid+2 … up to `BOUNDARY_NEIGHBOR_RADIUS`) and uses the first
 * message it finds. That candidate is a real id, so it is a sound bound.
 * If no message exists within the radius, the run aborts rather than guessing.
 * A 5xx, timeout, or network error aborts immediately, before any write.
 *
 * Ids below the cut-off are not enumerated, so an active source that posted
 * more than one channel page in seven days is still covered: the lower bound of
 * the search is id 1, not the oldest id on the first page.
 *
 * ## Commit or nothing
 *
 * Nothing is written until the whole enumeration succeeds: not listings, not
 * the negative cache, not the cursor, not an `ingest_runs` row. A budget
 * exhaustion, HTTP failure, timeout, or parse error leaves the source disabled
 * and the cursor null. Running the same command again restarts the same
 * deterministic boundary search; because the first attempt wrote nothing, no
 * listing is duplicated by the retry.
 */

import type { PoliteClient, RequestBudget } from '../net/polite-client.js';
import { channelPageUrl, messageEmbedUrl, normalizeSourceUsername } from '../net/urls.js';
import { parseTelegramHtml, type ParsedMessage } from '../parser/telegram-html.js';
import type { Store } from '../store/index.js';
import type { Source } from '../store/types.js';
import { describeFailure, emptyScanCounts, type ScanCounts } from '../tick/types.js';
import { ingestBatch } from '../tick/write.js';

/** The backfill window from the spec: seven days of posts. */
export const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far a boundary probe may step from its midpoint looking for a live
 * message when the midpoint id itself was deleted. Large enough for a normal
 * deleted run, small enough that an unexpected hole cannot turn the binary
 * search into a linear scan.
 */
export const BOUNDARY_NEIGHBOR_RADIUS = 16;

/**
 * In the top-id search a not-found can be a deleted post rather than the end
 * of the chat. After a not-found the search scans this many ids upward before
 * accepting the not-found as the boundary. A deleted run longer than this can
 * make the discovered latest id conservative; the minute tick then continues
 * forward from that cursor, so no post is lost.
 */
export const LATEST_HOLE_SCAN = 64;

/**
 * Sanity cap for the exponential group search. Telegram message ids are far
 * below this today; hitting it means the source has no readable message and the
 * run should stop rather than double forever.
 */
export const MAX_MESSAGE_ID = 2_000_000_000;

export const DEFAULT_BACKFILL_BUDGET = 5_000;

export type BackfillAbortReason =
  | 'budget_exhausted'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'parse_error'
  | 'disabled'
  | 'source_unreadable'
  | 'boundary_unprobeable';

export type BackfillRefusalReason =
  | 'invalid_username'
  | 'source_not_found'
  | 'already_backfilled';

export interface BackfillSuccess {
  status: 'ok';
  sourceId: number;
  username: string;
  latestId: number;
  /** Null when the whole source is older than the window (inactive). */
  cutoffId: number | null;
  inactive: boolean;
  cursorBefore: number | null;
  cursorAfter: number;
  counts: ScanCounts;
}

export interface BackfillRefused {
  status: 'refused';
  reason: BackfillRefusalReason;
  message: string;
  sourceId?: number;
}

export interface BackfillAborted {
  status: 'aborted';
  reason: BackfillAbortReason;
  message: string;
  sourceId: number;
  counts: ScanCounts;
  cursorBefore: number | null;
  /** Set when the budget ran out during enumeration: ids not yet attempted. */
  remaining?: number;
}

export type BackfillResult = BackfillSuccess | BackfillRefused | BackfillAborted;

export interface RunBackfillOptions {
  store: Store;
  client: PoliteClient;
  /** Accepts `name` or `@name`; normalised before lookup. */
  username: string;
  budget: RequestBudget;
  /** The global `INGEST_ENABLED` switch. */
  ingestEnabled: boolean;
  /** Epoch ms, injected so the 7-day boundary is deterministic in tests. */
  now?: number;
  /** Re-run a source that already has a cursor. */
  force?: boolean;
}

/** Internal control flow: every expected failure becomes one of these. */
class BackfillAbort extends Error {
  override name = 'BackfillAbort';
  remaining: number | undefined;

  constructor(
    readonly reason: BackfillAbortReason,
    message: string,
    remaining?: number,
  ) {
    super(message);
    this.remaining = remaining;
  }
}

type FoundMessage = { kind: 'message'; id: number; message: ParsedMessage };

type ProbeOutcome = FoundMessage | { kind: 'not_found'; id: number };

interface ProbeContext {
  store: Store;
  client: PoliteClient;
  source: Source;
  budget: RequestBudget;
  ingestEnabled: boolean;
  counts: ScanCounts;
  /** Explicit not-found ids found during enumeration; cached only on success. */
  holes: number[];
}

/**
 * One embed request. A parsed message is valid, an explicit 404 / "Post not
 * found" is `not_found`, and everything else aborts. It always sends the
 * per-source kill switch as on: a source awaiting backfill is disabled by
 * design, and the global switch still applies.
 */
async function probe(ctx: ProbeContext, id: number): Promise<ProbeOutcome> {
  const result = await ctx.client.request(messageEmbedUrl(ctx.source.username, id), {
    sourceId: ctx.source.id,
    sourceEnabled: true,
    ingestEnabled: ctx.ingestEnabled,
    budget: ctx.budget,
  });

  if (!result.ok) {
    switch (result.outcome) {
      case 'budget_exhausted':
        throw new BackfillAbort('budget_exhausted', 'request budget exhausted');
      case 'disabled':
        throw new BackfillAbort('disabled', `fetching is disabled (${describeFailure(result)})`);
      case 'http_error':
        if (result.status === 404) return { kind: 'not_found', id };
        throw new BackfillAbort(
          'http_error',
          `probe ${id} failed: ${describeFailure(result)}`,
        );
      case 'timeout':
        throw new BackfillAbort('timeout', `probe ${id} timed out`);
      case 'network_error':
        throw new BackfillAbort('network_error', `probe ${id} failed: network_error`);
    }
  }

  const parsed = parseTelegramHtml(result.html);
  if (parsed.kind === 'not_found') return { kind: 'not_found', id };
  if (parsed.kind === 'parse_error') {
    throw new BackfillAbort('parse_error', `probe ${id}: ${parsed.error}`);
  }
  if (parsed.messages.length === 0) {
    throw new BackfillAbort('parse_error', `probe ${id}: no message widgets`);
  }

  const message = parsed.messages.find((candidate) => candidate.id === id) ?? parsed.messages[0];
  return { kind: 'message', id, message: message as ParsedMessage };
}

/**
 * Probes `id`, then steps outward inside `[min, max]` while ids are missing.
 * Returns the first real message, or null when the whole neighbourhood is gone.
 */
async function probeNear(
  ctx: ProbeContext,
  id: number,
  min: number,
  max: number,
): Promise<FoundMessage | null> {
  const candidates: number[] = [];
  if (id >= min && id <= max) candidates.push(id);
  for (let offset = 1; offset <= BOUNDARY_NEIGHBOR_RADIUS; offset += 1) {
    if (id - offset >= min) candidates.push(id - offset);
    if (id + offset <= max) candidates.push(id + offset);
  }

  for (const candidate of candidates) {
    const outcome = await probe(ctx, candidate);
    if (outcome.kind === 'message') return outcome;
  }
  return null;
}

interface Discovery {
  latest: ParsedMessage;
}

async function discoverChannel(ctx: ProbeContext): Promise<Discovery> {
  const result = await ctx.client.request(channelPageUrl(ctx.source.username), {
    sourceId: ctx.source.id,
    sourceEnabled: true,
    ingestEnabled: ctx.ingestEnabled,
    budget: ctx.budget,
  });

  if (!result.ok) {
    if (result.outcome === 'budget_exhausted') {
      throw new BackfillAbort('budget_exhausted', 'request budget exhausted on the first page');
    }
    if (result.outcome === 'disabled') {
      throw new BackfillAbort('disabled', `fetching is disabled (${describeFailure(result)})`);
    }
    throw new BackfillAbort(
      result.outcome === 'http_error' ? 'http_error' : result.outcome,
      `channel page failed: ${describeFailure(result)}`,
    );
  }

  const parsed = parseTelegramHtml(result.html);
  if (parsed.kind === 'not_found') {
    throw new BackfillAbort('source_unreadable', 'channel page answered not_found');
  }
  if (parsed.kind === 'parse_error') {
    throw new BackfillAbort('parse_error', `channel page: ${parsed.error}`);
  }
  if (parsed.messages.length === 0) {
    throw new BackfillAbort('source_unreadable', 'channel page contains no messages');
  }

  let latest = parsed.messages[0] as ParsedMessage;
  for (const message of parsed.messages) {
    if (message.id > latest.id) latest = message;
  }
  return { latest };
}

/**
 * The first real message in `[from, min(to, from + LATEST_HOLE_SCAN - 1)]`.
 * Used only after a not-found, to distinguish a deleted post from the end of
 * the chat without turning the whole search linear.
 */
async function probeUpward(
  ctx: ProbeContext,
  from: number,
  to: number,
): Promise<FoundMessage | null> {
  const end = Math.min(to, from + LATEST_HOLE_SCAN - 1);
  for (let id = from; id <= end; id += 1) {
    const outcome = await probe(ctx, id);
    if (outcome.kind === 'message') return outcome;
  }
  return null;
}

async function discoverGroup(ctx: ProbeContext): Promise<Discovery> {
  let probeId = 1;
  let highestValid: { id: number; message: ParsedMessage } | null = null;
  let firstInvalid: number | null = null;

  while (probeId <= MAX_MESSAGE_ID) {
    const outcome = await probe(ctx, probeId);
    if (outcome.kind === 'message') {
      highestValid = { id: outcome.id, message: outcome.message };
      probeId *= 2;
      continue;
    }

    // A not-found can be a deleted post rather than the end of the chat. Scan
    // upward a bounded distance for a live id before calling it the boundary.
    const above = await probeUpward(ctx, probeId + 1, Math.min(probeId * 2 - 1, MAX_MESSAGE_ID));
    if (above !== null) {
      if (highestValid === null || above.id > highestValid.id) {
        highestValid = { id: above.id, message: above.message };
      }
      probeId *= 2;
      continue;
    }

    // Before any message is seen, every probe so far was a hole. Keep doubling
    // rather than declaring an empty chat.
    if (highestValid === null) {
      probeId *= 2;
      continue;
    }
    firstInvalid = probeId;
    break;
  }

  if (highestValid === null) {
    throw new BackfillAbort(
      'source_unreadable',
      `no readable message found up to id ${MAX_MESSAGE_ID}`,
    );
  }
  if (firstInvalid === null) {
    throw new BackfillAbort(
      'source_unreadable',
      `could not find an invalid id above ${highestValid.id}`,
    );
  }

  let lo = highestValid.id;
  let hi = firstInvalid;
  let latest = highestValid;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const outcome = await probe(ctx, mid);
    if (outcome.kind === 'message') {
      lo = mid;
      latest = { id: outcome.id, message: outcome.message };
      continue;
    }

    // The midpoint is deleted, but a live id may sit above it. Scan a bounded
    // distance upward before shrinking the upper bound.
    const above = await probeUpward(ctx, mid + 1, hi - 1);
    if (above !== null) {
      lo = above.id;
      latest = { id: above.id, message: above.message };
      continue;
    }
    hi = mid;
  }

  return { latest: latest.message };
}

/**
 * The lowest id whose message is at or after `cutoffMs`, by binary search on
 * embed timestamps. `latest` is known to be at or after the cut-off.
 */
async function findCutoff(
  ctx: ProbeContext,
  latestId: number,
  cutoffMs: number,
): Promise<number> {
  let lo = 0;
  let hi = latestId;

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const outcome = await probeNear(ctx, mid, lo + 1, hi - 1);
    if (outcome === null) {
      throw new BackfillAbort(
        'boundary_unprobeable',
        `no readable message between ids ${lo + 1} and ${hi - 1}; widen the probe or backfill a narrower range`,
      );
    }

    const at = Date.parse(outcome.message.datetime);
    if (Number.isNaN(at)) {
      throw new BackfillAbort('parse_error', `probe ${outcome.id}: invalid datetime`);
    }
    if (at >= cutoffMs) {
      hi = outcome.id;
    } else {
      lo = outcome.id;
    }
  }

  return hi;
}

/**
 * Probes every id from the cut-off through the latest, politely, collecting the
 * parsed message of each id that exists. Missing ids are remembered as holes to
 * cache on success; they never mark a listing deleted, because a backfill is not
 * a re-check. Any HTTP/network/parse failure aborts the whole run.
 */
async function enumerate(
  ctx: ProbeContext,
  cutoffId: number,
  latestId: number,
): Promise<ParsedMessage[]> {
  const messages: ParsedMessage[] = [];
  const seen = new Set<number>();

  for (let id = cutoffId; id <= latestId; id += 1) {
    if (ctx.budget.used >= ctx.budget.limit) {
      throw new BackfillAbort(
        'budget_exhausted',
        `request budget ${ctx.budget.limit} exhausted during enumeration`,
        latestId - id + 1,
      );
    }

    if (ctx.store.negativeCache.has(ctx.source.id, id)) {
      ctx.counts.skipped += 1;
      continue;
    }

    let outcome: ProbeOutcome;
    try {
      outcome = await probe(ctx, id);
    } catch (error) {
      if (error instanceof BackfillAbort && error.reason === 'budget_exhausted') {
        error.remaining = latestId - id + 1;
      }
      throw error;
    }

    if (outcome.kind === 'not_found') {
      ctx.holes.push(id);
      ctx.counts.skipped += 1;
      continue;
    }

    if (!seen.has(outcome.message.id)) {
      seen.add(outcome.message.id);
      messages.push(outcome.message);
    }
  }

  return messages;
}

/**
 * Writes the successful run: listings, holes, cursor, enable bit, freshness,
 * and the one `ingest_runs` row. Called only after enumeration finished.
 */
function commit(options: {
  store: Store;
  source: Source;
  ctx: ProbeContext;
  messages: readonly ParsedMessage[];
  latestId: number;
  fetchedAt: string;
  cursorBefore: number | null;
}): void {
  const { store, source, ctx, messages, latestId, fetchedAt, cursorBefore } = options;

  const batch = ingestBatch(messages, { store, source, fetchedAt });
  ctx.counts.fetched = messages.length;
  ctx.counts.inserted += batch.inserted;
  ctx.counts.updated += batch.updated;
  ctx.counts.skipped += batch.skipped;

  for (const id of ctx.holes) {
    store.negativeCache.add(source.id, id);
  }

  store.sources.setCursor(source.id, latestId);
  store.sources.setEnabled(source.id, true);
  store.sources.recordSuccess(source.id, fetchedAt);

  const runId = store.ingestRuns.start(source.id, fetchedAt);
  store.ingestRuns.finish(runId, {
    status: 'ok',
    fetched: ctx.counts.fetched,
    inserted: ctx.counts.inserted,
    updated: ctx.counts.updated,
    skipped: ctx.counts.skipped,
    errors: ctx.counts.errors,
    cursorBefore,
    cursorAfter: latestId,
    errorSample: null,
    finishedAt: fetchedAt,
  });
}

/**
 * Runs one backfill. Expected refusals and aborts are returned, never thrown;
 * only an unexpected programmer error escapes.
 */
export async function runBackfill(options: RunBackfillOptions): Promise<BackfillResult> {
  const { store, client } = options;
  const now = options.now ?? Date.now();
  const fetchedAt = new Date(now).toISOString();

  let username: string;
  try {
    username = normalizeSourceUsername(options.username);
  } catch {
    return {
      status: 'refused',
      reason: 'invalid_username',
      message: `"${options.username}" is not a valid Telegram username`,
    };
  }

  const source = store.sources.getByUsername(username);
  if (source === null) {
    return {
      status: 'refused',
      reason: 'source_not_found',
      message:
        `source "${username}" is not registered; insert its sources row (disabled, null cursor) first`,
    };
  }

  const cursorBefore = source.cursorMessageId;
  if (cursorBefore !== null && options.force !== true) {
    return {
      status: 'refused',
      reason: 'already_backfilled',
      message:
        `source "${username}" already has cursor ${cursorBefore}; pass --force to backfill again`,
      sourceId: source.id,
    };
  }

  const counts = emptyScanCounts();
  const ctx: ProbeContext = {
    store,
    client,
    source,
    budget: options.budget,
    ingestEnabled: options.ingestEnabled,
    counts,
    holes: [],
  };

  try {
    const discovery = source.kind === 'channel'
      ? await discoverChannel(ctx)
      : await discoverGroup(ctx);
    const latestId = discovery.latest.id;

    const cutoffMs = now - BACKFILL_WINDOW_MS;
    const latestAt = Date.parse(discovery.latest.datetime);
    if (Number.isNaN(latestAt)) {
      throw new BackfillAbort('parse_error', `latest message ${latestId} has an invalid datetime`);
    }

    if (latestAt < cutoffMs) {
      counts.requests = options.budget.used;
      commit({ store, source, ctx, messages: [], latestId, fetchedAt, cursorBefore });
      return {
        status: 'ok',
        sourceId: source.id,
        username,
        latestId,
        cutoffId: null,
        inactive: true,
        cursorBefore,
        cursorAfter: latestId,
        counts,
      };
    }

    const cutoffId = await findCutoff(ctx, latestId, cutoffMs);
    const messages = await enumerate(ctx, cutoffId, latestId);

    counts.requests = options.budget.used;
    commit({ store, source, ctx, messages, latestId, fetchedAt, cursorBefore });

    return {
      status: 'ok',
      sourceId: source.id,
      username,
      latestId,
      cutoffId,
      inactive: false,
      cursorBefore,
      cursorAfter: latestId,
      counts,
    };
  } catch (error) {
    counts.requests = options.budget.used;
    if (error instanceof BackfillAbort) {
      return {
        status: 'aborted',
        reason: error.reason,
        message: error.message,
        sourceId: source.id,
        counts,
        cursorBefore,
        ...(error.remaining === undefined ? {} : { remaining: error.remaining }),
      };
    }
    throw error;
  }
}
