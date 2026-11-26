/**
 * The minute tick: lock, read the registry, run every enabled source in
 * sequence, and record one `ingest_runs` row per source.
 *
 * Sources run sequentially rather than concurrently because the group path is
 * one request per message and the per-source pace is the point. The polite
 * client still holds the global two-in-flight cap for the process.
 *
 * A source with a null cursor has not been backfilled yet and is skipped
 * without a run row: it is not a failed poll, and writing a "skipped" row every
 * minute for every unbackfilled source would drown the audit trail. A source
 * that throws is recorded as failed and the loop continues, so one broken chat
 * never stalls the rest. The global `INGEST_ENABLED` flag stops all fetching;
 * the lock is released in `finally` in every path.
 */

import { runAlerts, type AlertResult } from '../alert/index.js';
import type { BotSender } from '../bot/index.js';
import { runDigest, type DigestRunResult } from '../digest/worker.js';
import { createRequestBudget } from '../net/polite-client.js';
import type { PoliteClient } from '../net/polite-client.js';
import type { Config } from '../config.js';
import { runRetention, type RetentionResult } from '../retention/index.js';
import type { Store } from '../store/index.js';

import { scanChannel } from './channel.js';
import { scanGroup } from './group.js';
import { acquireTickLock, tickLockPath } from './lock.js';
import { emptyScanCounts, type ScanCounts, type ScanResult, type ScanStatus } from './types.js';

export const INGEST_ENABLED_KEY = 'INGEST_ENABLED';
export const LAST_INGEST_AT_KEY = 'last_ingest_at';
export const LAST_INGEST_SOURCE_KEY = 'last_ingest_source_at';

export interface TickSourceRun {
  sourceId: number;
  username: string;
  status: ScanStatus;
  counts: ScanCounts;
  cursorBefore: number | null;
  cursorAfter: number | null;
  errorSample: string | null;
}

export interface TickResult {
  /** True when another tick held the lock: no work was done and no run row written. */
  skippedByLock: boolean;
  /** True when `INGEST_ENABLED` is stored as `false`. */
  ingestionDisabled: boolean;
  runs: TickSourceRun[];
  /** Housekeeping counters, or null when retention was off or failed to run. */
  retention: RetentionResult | null;
  /** Digest counters, or null when the digest was not configured or failed to run. */
  digest: DigestRunResult | null;
  /** Alert counters, or null when alerts were not configured or failed to run. */
  alerts: AlertResult | null;
}

export interface TickOptions {
  config: Config;
  store: Store;
  client: PoliteClient;
  /** Epoch ms; defaults to `Date.now`, injectable for deterministic tests. */
  now?: () => number;
  /**
   * Bot sender and username. Null or omitted keeps the digest off: ingestion
   * still runs. A digest failure never fails the tick.
   */
  digest?: { sender: BotSender; botUsername: string } | null;
  /**
   * Housekeeping runs by default. Tests and ad-hoc ingestion may turn it off;
   * a retention failure never fails the tick.
   */
  retention?: boolean;
  /**
   * Owner alerts. Omitted or null keeps them off; a send failure never fails
   * the tick.
   */
  alerts?: { sender: BotSender; ownerId: number } | null;
}

export async function runTick(options: TickOptions): Promise<TickResult> {
  const nowMs = options.now ?? Date.now;
  const lock = acquireTickLock({
    path: tickLockPath(options.config.databasePath),
    now: nowMs,
  });

  if (lock === null) {
    return {
      skippedByLock: true,
      ingestionDisabled: false,
      runs: [],
      retention: null,
      digest: null,
      alerts: null,
    };
  }

  const { store } = options;

  try {
    if (store.appState.get(INGEST_ENABLED_KEY) === 'false') {
      return {
        skippedByLock: false,
        ingestionDisabled: true,
        runs: [],
        retention: null,
        digest: null,
        alerts: null,
      };
    }

    const startsAt = new Date(nowMs()).toISOString();
    const runs: TickSourceRun[] = [];

    for (const source of store.sources.listEnabled()) {
      if (source.cursorMessageId === null) {
        continue;
      }

      const runId = store.ingestRuns.start(source.id, startsAt);
      const budget = createRequestBudget(options.config.tickRequestBudget);
      const fetchedAt = new Date(nowMs()).toISOString();

      let result: ScanResult;
      try {
        result =
          source.kind === 'channel'
            ? await scanChannel({
                store,
                client: options.client,
                source,
                budget,
                ingestEnabled: true,
                fetchedAt,
              })
            : await scanGroup({
                store,
                client: options.client,
                source,
                budget,
                ingestEnabled: true,
                fetchedAt,
                now: nowMs(),
              });
      } catch (error) {
        result = {
          status: 'failed',
          counts: { ...emptyScanCounts(), requests: budget.used },
          cursorBefore: source.cursorMessageId,
          cursorAfter: source.cursorMessageId,
          errorSample: error instanceof Error ? error.message : String(error),
        };
      }

      const finishedAt = new Date(nowMs()).toISOString();
      store.ingestRuns.finish(runId, {
        status: result.status,
        fetched: result.counts.fetched,
        inserted: result.counts.inserted,
        updated: result.counts.updated,
        skipped: result.counts.skipped,
        errors: result.counts.errors,
        cursorBefore: result.cursorBefore,
        cursorAfter: result.cursorAfter,
        errorSample: result.errorSample,
        finishedAt,
      });

      if (result.status === 'ok') {
        if (result.cursorAfter !== null && result.cursorAfter !== source.cursorMessageId) {
          store.sources.setCursor(source.id, result.cursorAfter);
        }
        store.sources.recordSuccess(source.id, finishedAt);
        store.appState.set(LAST_INGEST_SOURCE_KEY, finishedAt);
      } else {
        store.sources.recordFailure(source.id, finishedAt);
      }

      runs.push({
        sourceId: source.id,
        username: source.username,
        status: result.status,
        counts: result.counts,
        cursorBefore: result.cursorBefore,
        cursorAfter: result.cursorAfter,
        errorSample: result.errorSample,
      });
    }

    store.appState.set(LAST_INGEST_AT_KEY, new Date(nowMs()).toISOString());

    // Retention before the digest: a digest must never point at a cluster whose
    // members are about to be purged in the same tick.
    let retention: RetentionResult | null = null;
    if (options.retention !== false) {
      try {
        retention = runRetention({ store, now: nowMs });
      } catch (error) {
        // Housekeeping is data for the next tick, not a reason to fail the
        // collector run that already wrote its rows.
        console.warn(
          `tick retention failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    let digest: DigestRunResult | null = null;
    if (options.digest != null) {
      try {
        digest = await runDigest({
          store,
          sender: options.digest.sender,
          botUsername: options.digest.botUsername,
          now: nowMs,
        });
      } catch (error) {
        // A digest failure is data for the next tick, not a reason to fail the
        // collector run: ingestion already succeeded and its rows are written.
        console.warn(
          `tick digest failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    let alerts: AlertResult | null = null;
    if (options.alerts != null) {
      try {
        alerts = await runAlerts({
          store,
          sender: options.alerts.sender,
          ownerId: options.alerts.ownerId,
          now: nowMs,
        });
      } catch (error) {
        console.warn(
          `tick alerts failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { skippedByLock: false, ingestionDisabled: false, runs, retention, digest, alerts };
  } finally {
    lock.release();
  }
}
