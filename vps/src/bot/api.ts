/**
 * The Bot API sender used by the Дайджест worker.
 *
 * It deliberately does not reuse the polite collector client: that client is
 * built for t.me pages and its retry policy, User-Agent, and per-source budget
 * do not apply to api.telegram.org. What it does share is the shape: the
 * transport, clock, and sleep are injected, so tests never touch the network
 * and never sleep.
 *
 * A send result is a classification, not an exception. The worker decides what
 * to do with it: `blocked` marks the user undeliverable, `retry` leaves the
 * rows unsent for the next tick, and `fatal` is logged without retrying the
 * same HTML forever.
 *
 * Nothing here logs the URL (it carries the token) or the message text.
 */

/** The narrow slice of `fetch` this sender needs. Native `fetch` satisfies it. */
export type BotTransport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export type BotSendResult =
  | { status: 'sent' }
  | { status: 'blocked' }
  | { status: 'retry'; retryAfterMs: number | null }
  | { status: 'fatal'; code: number | null };

export interface BotSender {
  sendMessage(chatId: number, html: string): Promise<BotSendResult>;
}

export interface BotLogger {
  warn(message: string): void;
}

export interface BotSenderOptions {
  token: string;
  transport?: BotTransport;
  /** Defaults to `https://api.telegram.org`. */
  baseUrl?: string;
  /** Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Defaults to 34 ms, roughly the Bot API's 30 messages per second. */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: BotLogger;
}

export const DEFAULT_BOT_BASE_URL = 'https://api.telegram.org';
export const DEFAULT_BOT_TIMEOUT_MS = 10_000;
/** 1000 / 30 ≈ 33.3; 34 ms keeps the stream under the limit without bursts. */
export const DEFAULT_BOT_MIN_INTERVAL_MS = 34;

const BLOCKED_DESCRIPTION = /chat not found|deactivated|blocked|user is deactivated/i;

interface BotResponseBody {
  ok?: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

function parseBody(raw: string): BotResponseBody {
  if (raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as BotResponseBody) : {};
  } catch {
    return {};
  }
}

function retryAfterMs(body: BotResponseBody): number | null {
  const seconds = body.parameters?.retry_after;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

function classify(status: number, body: BotResponseBody): BotSendResult {
  const description = body.description ?? '';

  if (status === 403) return { status: 'blocked' };
  if (status === 429) return { status: 'retry', retryAfterMs: retryAfterMs(body) };
  if (status >= 500) return { status: 'retry', retryAfterMs: null };

  if (status === 400) {
    return BLOCKED_DESCRIPTION.test(description)
      ? { status: 'blocked' }
      : { status: 'fatal', code: status };
  }

  if (status >= 400) return { status: 'fatal', code: status };
  if (body.ok === false) {
    const code = body.error_code ?? null;
    if (code === 403) return { status: 'blocked' };
    if (code === 429) return { status: 'retry', retryAfterMs: retryAfterMs(body) };
    if (code !== null && code >= 500) return { status: 'retry', retryAfterMs: null };
    return { status: 'fatal', code };
  }
  return { status: 'sent' };
}

function describe(result: BotSendResult): string {
  switch (result.status) {
    case 'sent':
      return 'sent';
    case 'blocked':
      return 'blocked';
    case 'retry':
      return result.retryAfterMs === null
        ? 'retry'
        : `retry after ${result.retryAfterMs}ms`;
    case 'fatal':
      return `fatal code=${String(result.code)}`;
  }
}

export function createBotSender(options: BotSenderOptions): BotSender {
  const transport = options.transport ?? (fetch as BotTransport);
  const baseUrl = (options.baseUrl ?? DEFAULT_BOT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOT_TIMEOUT_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_BOT_MIN_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => (ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms))));
  const logger = options.logger ?? { warn: () => {} };

  let lastSendAt: number | null = null;

  return {
    async sendMessage(chatId: number, html: string): Promise<BotSendResult> {
      if (lastSendAt !== null) {
        const elapsed = now() - lastSendAt;
        if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
      }
      lastSendAt = now();

      let result: BotSendResult;
      try {
        const response = await transport(`${baseUrl}/bot${options.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: html,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        result = classify(response.status, parseBody(await response.text()));
      } catch {
        // Network error or timeout: the request may or may not have reached
        // Telegram, so the next tick retries the same unsent rows.
        result = { status: 'retry', retryAfterMs: null };
      }

      if (result.status !== 'sent') {
        logger.warn(`bot send chat=${chatId} ${describe(result)}`);
      }
      return result;
    },
  };
}
