/**
 * The BFF → VPS request: the TL1 signature and the typed caller.
 *
 * This mirrors `vps/src/auth/signature.ts` byte for byte. The pinned vector in
 * `tgcloud/test/upstream.test.js` (the same one `vps/test/auth-signature.test.ts`
 * pins) fails if either side drifts.
 *
 * Headers:
 *
 *   X-TL-User       Telegram user id, decimal, no sign and no leading zero
 *   X-TL-Timestamp  Unix epoch SECONDS, decimal
 *   X-TL-Signature  HMAC-SHA256, lowercase hex (64 characters)
 *
 * The MAC covers this exact string, `\n`-joined with no trailing newline:
 *
 *   TL1
 *   <timestamp exactly as sent>
 *   <METHOD, uppercase>
 *   <request target exactly as sent: path plus ?query, percent-encoding untouched>
 *   <sha256 hex of the raw body>
 *   <user id exactly as sent>
 *
 * The target includes the query string, so feed filters and cursors are
 * covered. The body hash is over the bytes sent, so the caller must not
 * re-serialize the body after signing: `buildSignedRequest` returns the exact
 * `body` to send.
 */

import { sha256Hex } from './sha256.js';
import { hmacSha256Hex } from './hmac.js';
import { ERROR_CODES, isErrorCode } from './errors.js';

export const SIGNATURE_VERSION = 'TL1';

export const USER_HEADER = 'X-TL-User';
export const TIMESTAMP_HEADER = 'X-TL-Timestamp';
export const SIGNATURE_HEADER = 'X-TL-Signature';

/** Default upstream timeout; the Mini App's own client also uses 10 s. */
export const DEFAULT_TIMEOUT_MS = 10_000;

const DIGITS = /^\d+$/;

/**
 * Serializes a request body once, so the MAC and the wire agree.
 *
 * `undefined`/`null` is the empty body; a string is UTF-8; a `Uint8Array` is
 * used as-is; any other value is JSON-serialized exactly once and returned as a
 * string.
 *
 * @param {unknown} body
 * @returns {string | Uint8Array}
 */
export function serializeBody(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return body;
  return JSON.stringify(body);
}

function validateSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('shared secret must be a string of at least 32 characters');
  }
}

function validateUserId(userId) {
  const value = String(userId);
  if (!DIGITS.test(value) || value === '0' || (value.length > 1 && value.charAt(0) === '0')) {
    throw new Error('userId must be a positive decimal Telegram id');
  }
  return value;
}

function validateTarget(target) {
  if (typeof target !== 'string' || target.charAt(0) !== '/') {
    throw new Error('target must be an absolute request path starting with "/"');
  }
  if (target.includes('#') || /\s/.test(target)) {
    throw new Error('target must be the exact path and query, without a fragment or whitespace');
  }
  return target;
}

function validateMethod(method) {
  if (typeof method !== 'string' || method.length === 0) {
    throw new Error('method is required');
  }
  return method.toUpperCase();
}

function validateTimestamp(timestamp) {
  const value = String(timestamp);
  if (!DIGITS.test(value)) throw new Error('timestamp must be Unix seconds');
  return value;
}

/**
 * Builds the signed headers for one upstream request.
 *
 * @param {{
 *   secret: string,
 *   userId: string | number,
 *   method?: string,
 *   target: string,
 *   body?: unknown,
 *   timestamp?: string | number,
 *   now?: number,
 * }} input
 *   `timestamp` is Unix seconds; `now` is epoch milliseconds and only used when
 *   `timestamp` is omitted (injectable for tests).
 * @returns {{
 *   headers: Record<string, string>,
 *   canonical: string,
 *   signature: string,
 *   body: string | Uint8Array,
 * }}
 *   `body` is the exact payload the caller must send.
 */
export function buildSignedRequest(input) {
  const { secret, userId, method = 'GET', target, body } = input ?? {};
  validateSecret(secret);

  const user = validateUserId(userId);
  const verb = validateMethod(method);
  const path = validateTarget(target);
  const timestamp = validateTimestamp(
    input.timestamp === undefined
      ? Math.floor((input.now === undefined ? Date.now() : input.now) / 1000)
      : input.timestamp,
  );

  const payload = serializeBody(body);
  const bodyHash = sha256Hex(payload);

  const canonical = [SIGNATURE_VERSION, timestamp, verb, path, bodyHash, user].join('\n');
  const signature = hmacSha256Hex(secret, canonical);

  return {
    headers: {
      [USER_HEADER]: user,
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: signature,
    },
    canonical,
    signature,
    body: payload,
  };
}

/**
 * Maps a non-2xx upstream response to a stable BFF code.
 *
 * An explicit `error.code` from the VPS wins when it is one of the stable codes
 * (this is how `not_invited`, `not_found`, and `access_check_failed` reach the
 * Mini App unchanged). Otherwise the status decides.
 */
export function mapUpstreamFailure(status, json) {
  const upstreamCode = json && typeof json === 'object' && json.error ? json.error.code : undefined;
  if (isErrorCode(upstreamCode)) return upstreamCode;

  if (status === 401) return ERROR_CODES.INIT_DATA_INVALID;
  if (status === 403) return ERROR_CODES.NOT_INVITED;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  if (status >= 500) return ERROR_CODES.UPSTREAM_UNAVAILABLE;
  if (status >= 400) return ERROR_CODES.INVALID_REQUEST;
  return ERROR_CODES.UPSTREAM_UNAVAILABLE;
}

/** Joins the configured base URL and an absolute target with one slash. */
export function joinUrl(baseUrl, target) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return `${base}${target}`;
}

/**
 * Calls the VPS with a signed request and maps the outcome to a typed result.
 *
 * Never throws for a network, timeout, or protocol failure; the caller branches
 * on `ok`.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   baseUrl: string,
 *   secret: string,
 *   userId: string | number,
 *   method?: string,
 *   target: string,
 *   body?: unknown,
 *   timeoutMs?: number,
 *   now?: number,
 * }} input
 * @returns {Promise<
 *   | { ok: true, status: number, json: unknown }
 *   | { ok: false, code: string, status: number | null, reason?: string }
 * >}
 */
export async function callVps(input) {
  const {
    fetchImpl = globalThis.fetch,
    baseUrl,
    secret,
    userId,
    method = 'GET',
    target,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now,
  } = input ?? {};

  if (typeof fetchImpl !== 'function') {
    return failure(ERROR_CODES.UPSTREAM_UNAVAILABLE, null, 'fetch_unavailable');
  }
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
    return failure(ERROR_CODES.UPSTREAM_UNAVAILABLE, null, 'invalid_base_url');
  }
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return failure(ERROR_CODES.UPSTREAM_UNAVAILABLE, null, 'invalid_timeout');
  }

  let signed;
  try {
    signed = buildSignedRequest({ secret, userId, method, target, body, now });
  } catch {
    // A bad userId/target/secret is a BFF bug, not a user error. The endpoint
    // logs it and the Mini App gets the neutral upstream code.
    return failure(ERROR_CODES.UPSTREAM_UNAVAILABLE, null, 'invalid_request_parameters');
  }

  const verb = method.toUpperCase();
  const sendsBody = verb !== 'GET' && verb !== 'HEAD' && signed.body !== '';
  const url = joinUrl(baseUrl, validateTarget(target));

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  let text;
  try {
    response = await fetchImpl(url, {
      method: verb,
      headers: signed.headers,
      ...(sendsBody ? { body: signed.body } : {}),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    return failure(
      ERROR_CODES.UPSTREAM_UNAVAILABLE,
      null,
      timedOut ? 'timeout' : error && error.name === 'AbortError' ? 'aborted' : 'network_error',
    );
  } finally {
    clearTimeout(timer);
  }

  const status = typeof response.status === 'number' ? response.status : 0;

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return failure(ERROR_CODES.UPSTREAM_UNAVAILABLE, status, 'non_json_response');
  }

  if (status >= 200 && status < 300) {
    return { ok: true, status, json };
  }

  return failure(mapUpstreamFailure(status, json), status, 'upstream_error');
}

function failure(code, status, reason) {
  return { ok: false, code, status, reason };
}
