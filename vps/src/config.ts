import { DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT } from './net/polite-client.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const MAX_REQUEST_TIMEOUT_MS = 300_000;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  host: string;
  port: number;
  databasePath: string;
  logLevel: LogLevel;
  /** Sent on every collector request; describes the client, never a person. */
  userAgent: string;
  /** Default HTTP timeout; a single request may override it (detail probe: 2 s). */
  requestTimeoutMs: number;
  /**
   * Timeout for the card detail's live not-found probe (`TL_DETAIL_PROBE_TIMEOUT_MS`).
   * It is deliberately short: the probe runs while the reader waits for the card.
   */
  detailProbeTimeoutMs: number;
  /**
   * Per-source request budget for one tick. The group path spends it on
   * forward-scan message fetches and hot-window re-checks; the channel path
   * spends it on pages. The user-agent's 1 request/second/source pace means a
   * budget of 40 is already roughly 40 seconds for that source.
   */
  tickRequestBudget: number;
  /**
   * Per-source request budget for one manual backfill (`TL_BACKFILL_BUDGET`).
   * A seven-day group backfill can need thousands of embed probes; the default
   * of 5000 is a few hours at one request per second. `--budget` overrides it
   * for a single run.
   */
  backfillBudget: number;
  /**
   * BFF → VPS signing key (`TL_SHARED_SECRET`), at least 32 characters. Null
   * when unset: the collector tick and the migration command do not need it,
   * but the API refuses to boot without it (`requireSharedSecret`).
   */
  sharedSecret: string | null;
  /**
   * The owner's Telegram id (`TL_OWNER_TELEGRAM_ID`), used by the owner check
   * in ticket #6. Optional here so the collector can run without it.
   */
  ownerTelegramId: number | null;
  /**
   * Bot API token (`TL_BOT_TOKEN`). Null keeps the digest off: the collector
   * tick still ingests, it just has no sender.
   */
  botToken: string | null;
  /**
   * Bot username (`TL_BOT_USERNAME`), without the leading `@`. Used to build
   * Mini App deep links in the digest. Null keeps the digest off.
   */
  botUsername: string | null;
}

/** The spec asks for a 32-byte shared secret; bytes and characters agree in ASCII hex. */
export const MIN_SHARED_SECRET_LENGTH = 32;

/** The detail probe has a 2-second budget; it runs while the reader waits. */
export const DEFAULT_DETAIL_PROBE_TIMEOUT_MS = 2_000;

const MAX_DETAIL_PROBE_TIMEOUT_MS = 30_000;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function requireString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = (env[name] ?? fallback).trim();
  if (value === '') {
    throw new ConfigError(`${name} must not be empty`);
  }
  return value;
}

/**
 * Reads and validates the environment once at boot.
 * The API and the database stay reachable from localhost only by default;
 * Caddy is the TLS edge in front of them.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = requireString(env, 'TL_HOST', '127.0.0.1');

  const rawPort = (env.TL_PORT ?? '8787').trim();
  if (!/^\d+$/.test(rawPort)) {
    throw new ConfigError(`TL_PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65535) {
    throw new ConfigError(`TL_PORT must be an integer between 1 and 65535, got "${rawPort}"`);
  }

  const databasePath = requireString(env, 'TL_DATABASE_PATH', './data/tele-lenta.db');

  const rawLogLevel = (env.TL_LOG_LEVEL ?? 'info').trim();
  if (!(LOG_LEVELS as readonly string[]).includes(rawLogLevel)) {
    throw new ConfigError(
      `TL_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${rawLogLevel}"`,
    );
  }

  const userAgent = requireString(env, 'TL_USER_AGENT', DEFAULT_USER_AGENT);

  const rawTimeout = (env.TL_REQUEST_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS)).trim();
  if (!/^\d+$/.test(rawTimeout)) {
    throw new ConfigError(
      `TL_REQUEST_TIMEOUT_MS must be a positive integer, got "${rawTimeout}"`,
    );
  }
  const requestTimeoutMs = Number(rawTimeout);
  if (requestTimeoutMs < 1 || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
    throw new ConfigError(
      `TL_REQUEST_TIMEOUT_MS must be between 1 and ${MAX_REQUEST_TIMEOUT_MS}, got "${rawTimeout}"`,
    );
  }

  const rawProbeTimeout = (
    env.TL_DETAIL_PROBE_TIMEOUT_MS ?? String(DEFAULT_DETAIL_PROBE_TIMEOUT_MS)
  ).trim();
  if (!/^\d+$/.test(rawProbeTimeout)) {
    throw new ConfigError(
      `TL_DETAIL_PROBE_TIMEOUT_MS must be a positive integer, got "${rawProbeTimeout}"`,
    );
  }
  const detailProbeTimeoutMs = Number(rawProbeTimeout);
  if (detailProbeTimeoutMs < 1 || detailProbeTimeoutMs > MAX_DETAIL_PROBE_TIMEOUT_MS) {
    throw new ConfigError(
      `TL_DETAIL_PROBE_TIMEOUT_MS must be between 1 and ${MAX_DETAIL_PROBE_TIMEOUT_MS}, got "${rawProbeTimeout}"`,
    );
  }

  const rawBudget = (env.TL_TICK_REQUEST_BUDGET ?? '40').trim();
  if (!/^\d+$/.test(rawBudget)) {
    throw new ConfigError(`TL_TICK_REQUEST_BUDGET must be a positive integer, got "${rawBudget}"`);
  }
  const tickRequestBudget = Number(rawBudget);
  if (tickRequestBudget < 1 || tickRequestBudget > 1_000) {
    throw new ConfigError(
      `TL_TICK_REQUEST_BUDGET must be between 1 and 1000, got "${rawBudget}"`,
    );
  }

  const rawBackfillBudget = (env.TL_BACKFILL_BUDGET ?? '5000').trim();
  if (!/^\d+$/.test(rawBackfillBudget)) {
    throw new ConfigError(
      `TL_BACKFILL_BUDGET must be a positive integer, got "${rawBackfillBudget}"`,
    );
  }
  const backfillBudget = Number(rawBackfillBudget);
  if (backfillBudget < 1 || backfillBudget > 50_000) {
    throw new ConfigError(
      `TL_BACKFILL_BUDGET must be between 1 and 50000, got "${rawBackfillBudget}"`,
    );
  }

  const rawSecret = (env.TL_SHARED_SECRET ?? '').trim();
  if (rawSecret !== '' && rawSecret.length < MIN_SHARED_SECRET_LENGTH) {
    throw new ConfigError(
      `TL_SHARED_SECRET must be at least ${MIN_SHARED_SECRET_LENGTH} characters`,
    );
  }

  const rawOwnerId = (env.TL_OWNER_TELEGRAM_ID ?? '').trim();
  let ownerTelegramId: number | null = null;
  if (rawOwnerId !== '') {
    if (!/^[1-9]\d{0,15}$/.test(rawOwnerId)) {
      throw new ConfigError(
        `TL_OWNER_TELEGRAM_ID must be a positive Telegram user id, got "${rawOwnerId}"`,
      );
    }
    ownerTelegramId = Number(rawOwnerId);
    if (!Number.isSafeInteger(ownerTelegramId)) {
      throw new ConfigError(
        `TL_OWNER_TELEGRAM_ID must be a positive Telegram user id, got "${rawOwnerId}"`,
      );
    }
  }

  const rawBotToken = (env.TL_BOT_TOKEN ?? '').trim();
  const botToken = rawBotToken === '' ? null : rawBotToken;

  const rawBotUsername = (env.TL_BOT_USERNAME ?? '').trim().replace(/^@/, '');
  let botUsername: string | null = null;
  if (rawBotUsername !== '') {
    if (!/^[A-Za-z0-9_]{4,32}$/.test(rawBotUsername)) {
      throw new ConfigError(
        `TL_BOT_USERNAME must be 4-32 letters, digits, or underscores, got "${rawBotUsername}"`,
      );
    }
    botUsername = rawBotUsername;
  }

  return {
    host,
    port,
    databasePath,
    logLevel: rawLogLevel as LogLevel,
    userAgent,
    requestTimeoutMs,
    detailProbeTimeoutMs,
    tickRequestBudget,
    backfillBudget,
    sharedSecret: rawSecret === '' ? null : rawSecret,
    ownerTelegramId,
    botToken,
    botUsername,
  };
}

/**
 * The API cannot serve an authenticated `/v1/*` without a signing key, so the
 * server entry point calls this instead of starting with auth disabled.
 */
export function requireSharedSecret(config: Config): string {
  if (config.sharedSecret === null) {
    throw new ConfigError(
      `TL_SHARED_SECRET is required to run the API (at least ${MIN_SHARED_SECRET_LENGTH} characters)`,
    );
  }
  return config.sharedSecret;
}
