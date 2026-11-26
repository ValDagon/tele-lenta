/**
 * Operator alerts (spec «Health», ticket #18).
 *
 * Two conditions page the owner through the Bot API, each throttled to one
 * message per hour and each silenced by the global `INGEST_ENABLED` kill
 * switch:
 *
 * - a Источник is degraded after `DEGRADED_STREAK` consecutive failed or
 *   zero-yield runs (the SQL lives in `store/ingest-runs.ts`);
 * - the global feed is stale when no **enabled** source has succeeded for
 *   more than `STALE_FEED_MS`.
 *
 * Retention is deliberately not part of this module: it runs whether or not
 * alerts are configured, because housekeeping is not an operator notification.
 *
 * The pass never throws. A failed send leaves its throttle key untouched, so
 * the next tick retries the same condition; a successful send stamps the key
 * in `app_state`. Logs carry the source id and the outcome, never the message
 * text or a token.
 */

import type { BotSender } from '../bot/index.js';
import type { Store } from '../store/index.js';

/** One alert per condition per hour. */
export const ALERT_THROTTLE_MS = 60 * 60 * 1000;

/** Consecutive failed or zero-yield runs that make a source degraded. */
export const DEGRADED_STREAK = 3;

/** No successful poll for this long makes the global feed stale. */
export const STALE_FEED_MS = 30 * 60 * 1000;

export const FEED_STALE_ALERT_KEY = 'alert:feed_stale';

/** The `app_state` throttle key of one source's degraded alert. */
export function sourceAlertKey(sourceId: number): string {
  return `alert:source:${sourceId}`;
}

export interface AlertResult {
  /** `null` when the pass ran; otherwise why it did nothing at all. */
  skipped: 'unconfigured' | 'ingestion_disabled' | null;
  sent: number;
  throttled: number;
  failed: number;
  /** Every source id that met the degraded condition, before throttling. */
  degraded: number[];
  /** True when the feed met the stale condition, throttled or not. */
  stale: boolean;
}

export interface AlertLogger {
  warn(message: string): void;
}

export interface RunAlertsOptions {
  store: Store;
  sender: BotSender | null;
  ownerId: number | null;
  /** Epoch ms; defaults to `Date.now`, injectable for deterministic tests. */
  now?: () => number;
  logger?: AlertLogger;
}

const silentLogger: AlertLogger = { warn: () => {} };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** True when this key was stamped less than one throttle window ago. */
function isThrottled(store: Store, key: string, nowMs: number): boolean {
  const raw = store.appState.get(key);
  if (raw === null) return false;
  const last = Date.parse(raw);
  if (!Number.isFinite(last)) return false;
  return nowMs - last < ALERT_THROTTLE_MS;
}

/**
 * Sends one alert and reports whether it landed. A throw from the sender is a
 * failed send, not a failed pass.
 */
async function deliver(
  sender: BotSender,
  ownerId: number,
  html: string,
  logger: AlertLogger,
  label: string,
): Promise<boolean> {
  try {
    const result = await sender.sendMessage(ownerId, html);
    if (result.status === 'sent') return true;
    logger.warn(`alert ${label} send=${result.status}`);
  } catch (error) {
    logger.warn(
      `alert ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return false;
}

function sourceMessage(store: Store, sourceId: number): string | null {
  const source = store.sources.getById(sourceId);
  if (source === null) return null;

  const handle = `@${escapeHtml(source.username)}`;
  const who = source.title === null ? handle : `${escapeHtml(source.title)} (${handle})`;
  return `Источник ${who} не отдаёт объявления три тика подряд. Проверьте доступ и парсер.`;
}

/** «1 минуту», «3 минуты», «31 минуту», «12 минут» — the alert is read by a person. */
export function minutesWord(minutes: number): string {
  const lastTwo = minutes % 100;
  const last = minutes % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'минут';
  if (last === 1) return 'минуту';
  if (last >= 2 && last <= 4) return 'минуты';
  return 'минут';
}

function feedStaleMessage(minutes: number): string {
  return `Лента не обновлялась ${minutes} ${minutesWord(minutes)}. Проверьте тик и источники.`;
}

/**
 * Runs one alert pass. Returns counters for the tick result and the CLI line;
 * it never throws.
 */
export async function runAlerts(options: RunAlertsOptions): Promise<AlertResult> {
  const result: AlertResult = {
    skipped: null,
    sent: 0,
    throttled: 0,
    failed: 0,
    degraded: [],
    stale: false,
  };

  const { store, sender, ownerId } = options;
  if (sender === null || ownerId === null) {
    result.skipped = 'unconfigured';
    return result;
  }

  // The global kill switch means "do not touch the outside world"; the
  // per-source switch is honoured inside the degraded query and by
  // `feed.updatedAt`, both of which read enabled sources only.
  if (store.appState.get('INGEST_ENABLED') === 'false') {
    result.skipped = 'ingestion_disabled';
    return result;
  }

  const nowMs = (options.now ?? Date.now)();
  const nowIso = new Date(nowMs).toISOString();
  const logger = options.logger ?? silentLogger;

  try {
    result.degraded = store.ingestRuns.degradedSourceIds(DEGRADED_STREAK);
  } catch (error) {
    logger.warn(
      `alert degraded query failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    result.degraded = [];
  }

  for (const sourceId of result.degraded) {
    const key = sourceAlertKey(sourceId);
    if (isThrottled(store, key, nowMs)) {
      result.throttled += 1;
      continue;
    }

    const message = sourceMessage(store, sourceId);
    if (message === null) continue;

    if (await deliver(sender, ownerId, message, logger, `source=${sourceId}`)) {
      store.appState.set(key, nowIso);
      result.sent += 1;
    } else {
      result.failed += 1;
    }
  }

  try {
    const lastSuccessAt = store.feed.updatedAt();
    const lastMs = lastSuccessAt === null ? Number.NaN : Date.parse(lastSuccessAt);
    if (Number.isFinite(lastMs) && nowMs - lastMs > STALE_FEED_MS) {
      result.stale = true;

      if (isThrottled(store, FEED_STALE_ALERT_KEY, nowMs)) {
        result.throttled += 1;
      } else {
        const minutes = Math.floor((nowMs - lastMs) / 60_000);
        if (
          await deliver(
            sender,
            ownerId,
            feedStaleMessage(minutes),
            logger,
            'feed_stale',
          )
        ) {
          store.appState.set(FEED_STALE_ALERT_KEY, nowIso);
          result.sent += 1;
        } else {
          result.failed += 1;
        }
      }
    }
  } catch (error) {
    logger.warn(
      `alert feed freshness failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return result;
}
