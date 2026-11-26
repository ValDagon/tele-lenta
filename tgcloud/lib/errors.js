/**
 * The BFF error envelope and the stable code vocabulary.
 *
 * Every endpoint answers either a resource JSON body or
 * `{ "error": { "code", "message" } }`. The Mini App owns the Russian copy for
 * each code, so the codes are a contract: add one only in the spec and the
 * Mini App together.
 *
 * `message` is for developers and logs. It never contains `initData`, a token,
 * a secret, or post content.
 */

/** The stable codes from the spec's "Error shape" section. */
export const ERROR_CODES = Object.freeze({
  INIT_DATA_INVALID: 'init_data_invalid',
  INIT_DATA_EXPIRED: 'init_data_expired',
  NOT_INVITED: 'not_invited',
  ACCESS_CHECK_FAILED: 'access_check_failed',
  NOT_FOUND: 'not_found',
  INVALID_REQUEST: 'invalid_request',
  RATE_LIMITED: 'rate_limited',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
});

/** Every stable code as an array (checks, tests, and pass-through filtering). */
export const ERROR_CODE_LIST = Object.freeze(Object.values(ERROR_CODES));

const ERROR_CODE_SET = new Set(ERROR_CODE_LIST);

/** True when `code` is one of the stable BFF codes. */
export function isErrorCode(code) {
  return typeof code === 'string' && ERROR_CODE_SET.has(code);
}

/** HTTP status per code; the BFF and the VPS agree on these. */
const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.INIT_DATA_INVALID]: 401,
  [ERROR_CODES.INIT_DATA_EXPIRED]: 401,
  [ERROR_CODES.NOT_INVITED]: 403,
  [ERROR_CODES.ACCESS_CHECK_FAILED]: 503,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.INVALID_REQUEST]: 400,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.UPSTREAM_UNAVAILABLE]: 503,
});

/** Default developer-facing message per code. */
const DEFAULT_MESSAGE = Object.freeze({
  [ERROR_CODES.INIT_DATA_INVALID]: 'initData did not verify',
  [ERROR_CODES.INIT_DATA_EXPIRED]: 'initData is outside the accepted time window',
  [ERROR_CODES.NOT_INVITED]: 'this account is not on the beta allowlist',
  [ERROR_CODES.ACCESS_CHECK_FAILED]: 'the access check could not be completed',
  [ERROR_CODES.NOT_FOUND]: 'the requested resource does not exist',
  [ERROR_CODES.INVALID_REQUEST]: 'the request is malformed',
  [ERROR_CODES.RATE_LIMITED]: 'too many requests',
  [ERROR_CODES.UPSTREAM_UNAVAILABLE]: 'the upstream service is unavailable',
});

/** HTTP status for a stable code; unknown codes are server errors. */
export function statusForCode(code) {
  return STATUS_BY_CODE[code] ?? 500;
}

/** Default message for a stable code, or a neutral fallback. */
export function messageForCode(code) {
  return DEFAULT_MESSAGE[code] ?? 'unexpected error';
}

/**
 * The error envelope, exactly as the Mini App and the VPS see it.
 *
 * @param {string} code one of `ERROR_CODES`
 * @param {string} [message] developer-facing text, never a secret
 * @returns {{ error: { code: string, message: string } }}
 */
export function errorBody(code, message) {
  return { error: { code, message: message ?? messageForCode(code) } };
}

/**
 * A BFF failure that an endpoint may throw. `parameters` is what the platform
 * hands to the client (the Mini App reads `code` from it); `code` is also a
 * direct property so the caller can branch without unwrapping.
 */
export class EndpointError extends Error {
  /**
   * @param {string} code one of `ERROR_CODES`
   * @param {string} [message]
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message ?? messageForCode(code), options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EndpointError';
    this.code = code;
    this.status = statusForCode(code);
    this.parameters = Object.freeze({ code, message: this.message });
  }

  /** The JSON body this error turns into. */
  toJSON() {
    return errorBody(this.code, this.message);
  }
}

/**
 * Builds a successful endpoint result. `body` is serialized once here so the
 * platform sends exactly these bytes.
 *
 * @param {unknown} body
 * @param {number} [status]
 * @returns {{ status: number, headers: Record<string,string>, body: string, json: unknown }}
 */
export function jsonResult(body, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
    json: body,
  };
}

/** Builds a JSON error result from a stable code. */
export function errorResult(code, message) {
  return jsonResult(errorBody(code, message), statusForCode(code));
}

/**
 * Normalizes anything an endpoint throws into a JSON error result.
 * An `EndpointError` keeps its code; anything else becomes
 * `upstream_unavailable` so an internal failure never leaks a stack or a
 * secret to the Mini App.
 */
export function toErrorResult(error) {
  if (error instanceof EndpointError) return errorResult(error.code, error.message);
  return errorResult(ERROR_CODES.UPSTREAM_UNAVAILABLE);
}
