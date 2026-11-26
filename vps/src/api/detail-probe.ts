/**
 * The card detail's live not-found probe (spec «Ingestion → Edits and deletions»).
 *
 * Group messages older than the collector's 48-hour hot window are never
 * re-checked by the tick, so a source row can keep an `available` link that
 * 404s for up to 28 days. Opening the card probes exactly one row — the
 * representative (the available member with the lowest `published_at`, then the
 * lowest `id`), which is also the «Открыть в Telegram» target — and marks it
 * `deleted` only on an explicit not-found:
 *
 * - HTTP 404, or a 2xx body whose widget says «Post not found» → deleted;
 * - timeout, 5xx, network error, or a parse error → status unchanged.
 *
 * The request is one transport attempt: a per-request budget of 1 means a retry
 * cannot reach the network, and the caller's client is built without retries.
 * It uses the polite client's per-source pacing and a short timeout, and it
 * never throws: whatever happens to the probe, the card keeps answering.
 *
 * ## Cross-process rate limit
 *
 * The API and the tick are separate processes, so the in-memory
 * `PolitenessLimiter` cannot see the tick's last request. Before probing, the
 * source's most recent `ingest_runs.started_at` is checked: a run that started
 * less than one second ago means the source was just polled and the probe is
 * skipped. That is an approximation, not a shared lock — it reads the tick's
 * audit trail and never writes to it — but it keeps the API from firing at a
 * source the tick is already working. See `vps/README.md`.
 */

import { HOT_WINDOW_MS } from '../tick/group.js';
import { INGEST_ENABLED_KEY } from '../tick/tick.js';
import { markListingDeleted } from '../tick/write.js';
import {
  createRequestBudget,
  type PoliteClient,
  type PoliteResult,
} from '../net/polite-client.js';
import { messageEmbedUrl } from '../net/urls.js';
import { parseTelegramHtml } from '../parser/telegram-html.js';
import type { ClusterDetail } from '../store/feed.js';
import type { Store } from '../store/index.js';

/**
 * How recently a tick run disqualifies the probe. The spec's per-source pace is
 * one request per second, so a run that started within this window is the tick
 * still owning the source.
 */
export const PROBE_TICK_WINDOW_MS = 1_000;

/** One live check per card open. */
const PROBE_BUDGET = 1;

export interface DetailProbeOptions {
  /** Polite client shared with the process; tests inject a scripted transport. */
  client: PoliteClient;
  /** `TL_DETAIL_PROBE_TIMEOUT_MS`, default 2000. */
  timeoutMs: number;
  /** Injected clock in milliseconds. */
  now: () => number;
}

export interface DetailProbe {
  /**
   * Checks the representative source of one visible cluster. Returns true only
   * when the probe saw an explicit not-found and the listing flipped to
   * `deleted`; the caller re-reads the detail then.
   */
  probe(detail: ClusterDetail): Promise<boolean>;
}

/** True when the response is Telegram's explicit "post does not exist". */
function isNotFound(result: PoliteResult): boolean {
  if (!result.ok) {
    return result.outcome === 'http_error' && result.status === 404;
  }
  return parseTelegramHtml(result.html).kind === 'not_found';
}

/**
 * The durable half of the per-source rate limit: a tick run that started less
 * than a second ago means the source is being polled right now. A missing or
 * unparsable run row never blocks the probe.
 */
function recentlyPolled(store: Store, sourceId: number, now: number): boolean {
  const run = store.ingestRuns.lastForSource(sourceId);
  if (run === null) return false;
  const startedAt = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  return now - startedAt < PROBE_TICK_WINDOW_MS;
}

export function createDetailProbe(store: Store, options: DetailProbeOptions): DetailProbe {
  return {
    async probe(detail: ClusterDetail): Promise<boolean> {
      try {
        const publishedAt = Date.parse(detail.publishedAt);
        if (!Number.isFinite(publishedAt)) return false;
        // The hot window is covered by the tick's hourly re-checks.
        if (options.now() - publishedAt <= HOT_WINDOW_MS) return false;

        const listing = store.listings.getById(detail.listingId);
        if (listing === null || listing.messageStatus !== 'available') return false;

        const source = store.sources.getById(listing.sourceId);
        if (source === null || !source.enabled) return false;

        if (recentlyPolled(store, source.id, options.now())) return false;

        const result = await options.client.request(
          messageEmbedUrl(source.username, listing.messageId),
          {
            sourceId: source.id,
            sourceEnabled: source.enabled,
            ingestEnabled: store.appState.get(INGEST_ENABLED_KEY) !== 'false',
            budget: createRequestBudget(PROBE_BUDGET),
            timeoutMs: options.timeoutMs,
          },
        );

        if (!isNotFound(result)) return false;
        return markListingDeleted(store, listing);
      } catch {
        // A probe is best-effort by contract: a dead link must never become a
        // dead card.
        return false;
      }
    },
  };
}
