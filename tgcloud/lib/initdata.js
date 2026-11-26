/**
 * Telegram Mini App `initData` verification.
 *
 * The Serverless platform passes `ctx.initData` to an endpoint already checked
 * against the configured bot token, but the BFF re-derives the hash itself so
 * the check is visible, testable, and independent of a platform guarantee. The
 * user id is taken only from this verified payload, never from the request
 * body.
 *
 * Algorithm (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *
 *   dataCheckString = all fields except `hash`, sorted by key, `key=value`
 *                     joined with "\n"
 *   secretKey       = HMAC-SHA256(key: "WebAppData", message: botToken)
 *   expectedHash    = HMAC-SHA256(key: secretKey, message: dataCheckString)
 *
 * The runtime's `crypto.subtle` is not proven, so the MAC is the pure-JS
 * implementation in `lib/hmac.js`. The probe in `lib/hmac-probe.js` exists for
 * diagnostics only and is not on this path.
 *
 * `initData` is never logged. The result's `raw` field is the parsed field map,
 * also never logged.
 */

import { hmacSha256Bytes, hmacSha256Hex, constantTimeEqualHex } from './hmac.js';

/** `auth_date` may be at most this old (24 hours). */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

/** `auth_date` may be at most this far in the future (5 minutes). */
export const INIT_DATA_MAX_FUTURE_SECONDS = 5 * 60;

const HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Parses a URL-encoded `initData` string into an ordered entry list.
 * Returns `null` when the input is not a well-formed query string or repeats a
 * key (Telegram never repeats one, and a duplicate would let the signed value
 * and the read value differ).
 *
 * @param {string} rawInitData
 * @returns {Array<[string, string]> | null}
 */
export function parseInitData(rawInitData) {
  if (typeof rawInitData !== 'string' || rawInitData.length === 0) return null;
  const input = rawInitData.charAt(0) === '?' ? rawInitData.slice(1) : rawInitData;

  let params;
  try {
    params = new URLSearchParams(input);
  } catch {
    return null;
  }

  const entries = [];
  const seen = new Set();
  for (const [key, value] of params) {
    if (seen.has(key)) return null;
    seen.add(key);
    entries.push([key, value]);
  }
  return entries.length === 0 ? null : entries;
}

/**
 * Builds the data-check string from parsed entries: every field except `hash`,
 * sorted by key, `key=value`, joined with `\n`.
 *
 * @param {Array<[string, string]>} entries
 * @returns {string}
 */
export function buildDataCheckString(entries) {
  return entries
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/** Derives the Telegram WebApp secret key from the bot token. */
export function deriveWebAppSecret(botToken) {
  return hmacSha256Bytes('WebAppData', botToken);
}

function failure(code, reason) {
  return { ok: false, code, reason };
}

/**
 * Verifies `initData` and extracts the Telegram user.
 *
 * @param {string} rawInitData the URL-encoded `initData` string
 * @param {string} botToken the bot's token, server-side only
 * @param {{ now?: number, maxAgeSeconds?: number, maxFutureSeconds?: number }} [options]
 *   `now` is epoch milliseconds (injectable for tests)
 * @returns {
 *   | { ok: true, user: Record<string, unknown> & { id: number }, authDate: number, startParam: string | null, raw: Record<string, string> }
 *   | { ok: false, code: 'init_data_invalid' | 'init_data_expired', reason: string }
 * }
 */
export function verifyInitData(rawInitData, botToken, options = {}) {
  if (typeof botToken !== 'string' || botToken.length === 0) {
    return failure('init_data_invalid', 'missing_bot_token');
  }

  const entries = parseInitData(rawInitData);
  if (entries === null) return failure('init_data_invalid', 'malformed_init_data');

  const fields = new Map(entries);

  const presentedHash = fields.get('hash');
  if (typeof presentedHash !== 'string' || !HASH_PATTERN.test(presentedHash)) {
    return failure('init_data_invalid', 'missing_or_malformed_hash');
  }

  const secret = deriveWebAppSecret(botToken);
  const expectedHash = hmacSha256Hex(secret, buildDataCheckString(entries));
  if (!constantTimeEqualHex(expectedHash, presentedHash)) {
    return failure('init_data_invalid', 'signature_mismatch');
  }

  const rawAuthDate = fields.get('auth_date');
  if (typeof rawAuthDate !== 'string' || !/^\d+$/.test(rawAuthDate)) {
    return failure('init_data_invalid', 'missing_auth_date');
  }
  const authDate = Number(rawAuthDate);

  const nowMs = options.now === undefined ? Date.now() : options.now;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    return failure('init_data_invalid', 'invalid_clock');
  }
  const nowSeconds = Math.floor(nowMs / 1000);

  const maxAge = options.maxAgeSeconds ?? INIT_DATA_MAX_AGE_SECONDS;
  const maxFuture = options.maxFutureSeconds ?? INIT_DATA_MAX_FUTURE_SECONDS;

  if (nowSeconds - authDate > maxAge) {
    return failure('init_data_expired', 'auth_date_too_old');
  }
  if (authDate - nowSeconds > maxFuture) {
    return failure('init_data_expired', 'auth_date_in_the_future');
  }

  const rawUser = fields.get('user');
  if (typeof rawUser !== 'string' || rawUser.length === 0) {
    return failure('init_data_invalid', 'missing_user');
  }

  let parsedUser;
  try {
    parsedUser = JSON.parse(rawUser);
  } catch {
    return failure('init_data_invalid', 'malformed_user_json');
  }
  if (parsedUser === null || typeof parsedUser !== 'object' || Array.isArray(parsedUser)) {
    return failure('init_data_invalid', 'malformed_user_json');
  }

  const userId =
    typeof parsedUser.id === 'number'
      ? parsedUser.id
      : typeof parsedUser.id === 'string' && /^\d+$/.test(parsedUser.id)
        ? Number(parsedUser.id)
        : null;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return failure('init_data_invalid', 'missing_user_id');
  }

  const raw = {};
  for (const [key, value] of entries) {
    if (key !== 'hash') raw[key] = value;
  }

  const startParam = fields.get('start_param');

  return {
    ok: true,
    user: { ...parsedUser, id: userId },
    authDate,
    startParam: typeof startParam === 'string' && startParam.length > 0 ? startParam : null,
    raw,
  };
}
