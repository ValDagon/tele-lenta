/**
 * Per-request authentication and allowlist enforcement for every `/v1/*`
 * route. `/health` stays public and is the only route outside this layer.
 *
 * A request is accepted only when all of these hold:
 *
 * 1. `X-TL-User`, `X-TL-Timestamp`, and `X-TL-Signature` are present and
 *    well-formed, the timestamp is within 60 seconds of the VPS clock, and the
 *    HMAC verifies (`./signature.ts` is the contract).
 * 2. The MAC-bound user id has a `users` row with `allowed = 1`. The id always
 *    comes from the signed header, never from the body or the query.
 * 3. The request fits the per-user and global rate limits (`./rate-limit.ts`).
 *
 * `POST /v1/session` is the one route that runs its handler before the
 * allowlist check (`tlAllowUninvited` route config), so it can record the
 * verified profile of an unknown id for `admin allow`. Its handler re-checks
 * `allowed` itself and answers `not_invited` exactly like every other route.
 *
 * Denials are logged with the Telegram id and display name only. Headers,
 * bodies, `initData`, and the shared secret never reach the logger.
 */

import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from 'fastify';

import { ApiError, invalidRequest } from '../api/errors.js';
import type { Store } from '../store/index.js';
import type { User } from '../store/index.js';

import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimitConfig } from './rate-limit.js';
import {
  MAX_CLOCK_SKEW_SECONDS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  USER_HEADER,
  sha256Hex,
  verifySignature,
} from './signature.js';

export * from './rate-limit.js';
export * from './signature.js';

export interface AuthOptions {
  /** 32-byte shared secret shared with the BFF (`TL_SHARED_SECRET`). */
  sharedSecret: string;
  /** Injected clock in milliseconds; tests move it to cross the window. */
  now?: () => number;
  /** Test override of the production 60/600-per-minute defaults. */
  rateLimit?: Partial<RateLimitConfig>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw body bytes before JSON parsing; the signature covers exactly these. */
    rawBody?: Buffer;
    /** The `users` row for the MAC-bound id; absent for an unknown id. */
    tlUser?: User;
    /** The Telegram id from the verified `X-TL-User` header. */
    tlTelegramUserId?: number;
  }
}

const USER_ID = /^[1-9]\d{0,15}$/;
const TIMESTAMP = /^\d{1,15}$/;

function headerValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? null;
  return null;
}

export interface Denial {
  code: 'invalid_request' | 'init_data_invalid' | 'init_data_expired' | 'not_invited' | 'rate_limited' | 'access_check_failed';
  statusCode: number;
  message: string;
  telegramUserId?: number;
  displayName?: string | null;
  scope?: 'user' | 'global';
}

/**
 * Logs the denial and throws the envelope. Only the signed Telegram id, the
 * display name, the code, and the route are recorded — no header value, no
 * body, no secret.
 */
export function denyRequest(request: FastifyRequest, denial: Denial): never {
  const { path } = routeOf(request);
  const fields: Record<string, unknown> = {
    code: denial.code,
    method: request.method.toUpperCase(),
    path,
  };
  if (denial.telegramUserId !== undefined) fields.telegram_user_id = denial.telegramUserId;
  if (denial.displayName !== undefined) fields.display_name = denial.displayName;
  if (denial.scope !== undefined) fields.scope = denial.scope;

  request.log.warn(fields, 'request denied');
  throw new ApiError(denial.code, denial.message, denial.statusCode);
}

function routeOf(request: FastifyRequest): { target: string; path: string } {
  const target = request.raw.url ?? request.url;
  const query = target.indexOf('?');
  return { target, path: query === -1 ? target : target.slice(0, query) };
}

function allowUninvited(request: FastifyRequest): boolean {
  const config = request.routeOptions.config as unknown as
    | Record<string, unknown>
    | undefined;
  return config?.tlAllowUninvited === true;
}

/** Resolves the display name used in denial logs; never a header value. */
function displayNameOf(user: User | null): string | null {
  if (user === null) return null;
  return user.firstName ?? user.username ?? null;
}

export function createAuthHook(store: Store, options: AuthOptions): preValidationHookHandler {
  if (options.sharedSecret.length === 0) {
    throw new Error('auth requires a non-empty shared secret');
  }
  const now = options.now ?? Date.now;
  const limiter = createRateLimiter(
    { ...DEFAULT_RATE_LIMIT, ...options.rateLimit },
    now,
  );

  return async function authHook(request) {
    const { target, path } = routeOf(request);
    // `/health` and anything outside `/v1/*` are not behind the BFF contract.
    if (!path.startsWith('/v1/')) return;

    const signature = headerValue(request, SIGNATURE_HEADER);
    const timestampRaw = headerValue(request, TIMESTAMP_HEADER);
    const userIdRaw = headerValue(request, USER_HEADER);

    if (signature === null || timestampRaw === null || userIdRaw === null) {
      const missing: string[] = [];
      if (userIdRaw === null) missing.push('X-TL-User');
      if (timestampRaw === null) missing.push('X-TL-Timestamp');
      if (signature === null) missing.push('X-TL-Signature');
      throw invalidRequest(`missing signed header(s): ${missing.join(', ')}`);
    }

    if (!USER_ID.test(userIdRaw)) {
      throw invalidRequest('X-TL-User must be a positive Telegram user id');
    }
    const telegramUserId = Number(userIdRaw);
    if (!Number.isSafeInteger(telegramUserId)) {
      throw invalidRequest('X-TL-User must be a positive Telegram user id');
    }

    if (!TIMESTAMP.test(timestampRaw)) {
      throw invalidRequest('X-TL-Timestamp must be Unix seconds');
    }
    const timestamp = Number(timestampRaw);
    const nowSeconds = Math.floor(now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      denyRequest(request, {
        code: 'init_data_expired',
        statusCode: 401,
        message: `request timestamp is more than ${MAX_CLOCK_SKEW_SECONDS} seconds from the server clock`,
        telegramUserId,
      });
    }

    const body = request.rawBody ?? Buffer.alloc(0);
    const valid = verifySignature(
      options.sharedSecret,
      {
        timestamp: timestampRaw,
        method: request.method.toUpperCase(),
        target,
        bodyHash: sha256Hex(body),
        userId: userIdRaw,
      },
      signature,
    );
    if (!valid) {
      denyRequest(request, {
        code: 'init_data_invalid',
        statusCode: 401,
        message: 'request signature is invalid',
        telegramUserId,
      });
    }

    let user: User | null;
    try {
      user = store.users.get(telegramUserId);
    } catch (error) {
      request.log.error({ err: error, telegram_user_id: telegramUserId }, 'allowlist lookup failed');
      throw new ApiError('access_check_failed', 'access check unavailable', 503);
    }

    request.tlTelegramUserId = telegramUserId;
    if (user !== null) request.tlUser = user;

    // Authenticated requests consume the budget before the allowlist decides,
    // so a denied user cannot hammer the API for free.
    const decision = limiter.check(telegramUserId);
    if (!decision.allowed) {
      denyRequest(request, {
        code: 'rate_limited',
        statusCode: 429,
        message:
          decision.scope === 'user'
            ? 'too many requests for this user'
            : 'too many requests',
        telegramUserId,
        displayName: displayNameOf(user),
        scope: decision.scope,
      });
    }

    if (allowUninvited(request)) return;

    if (user === null || !user.allowed) {
      denyRequest(request, {
        code: 'not_invited',
        statusCode: 403,
        message: 'this Telegram account is not invited',
        telegramUserId,
        displayName: displayNameOf(user),
      });
    }
  };
}

/**
 * Installs the raw-body capture and the auth hook. The JSON parser keeps the
 * exact body bytes on the request so the signature is checked over the wire
 * bytes, not a re-serialization; an unparsable body is `invalid_request`.
 */
export function registerAuth(
  app: FastifyInstance,
  store: Store,
  options: AuthOptions,
): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const bytes = body as Buffer;
      request.rawBody = bytes;
      if (bytes.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(bytes.toString('utf8')));
      } catch {
        done(invalidRequest('body must be valid JSON'), undefined);
      }
    },
  );

  app.addHook('preValidation', createAuthHook(store, options));
}
