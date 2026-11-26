/**
 * Signed-request helpers for the API tests. The signature is produced by the
 * production `signRequest`, and `auth-signature.test.ts` independently pins the
 * canonical string and one HMAC vector, so a format drift fails there before it
 * can quietly move both sides together.
 */

import type { FastifyInstance } from 'fastify';

import { signRequest, sha256Hex } from '../../src/auth/signature.js';
import type { Db } from '../../src/db.js';

export const TEST_SHARED_SECRET = 'tele-lenta-test-shared-secret-0123456789';
export const TEST_USER_ID = 1_002_003_004;
export const TEST_USERNAME = 'beta_tester';
export const TEST_FIRST_NAME = 'Тест';

export function bodyBytes(body: unknown): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body), 'utf8');
}

export interface SignedRequestOptions {
  url: string;
  method?: string;
  /** `undefined` means an empty body; an object is JSON-serialized. */
  body?: unknown;
  /** Telegram id placed in `X-TL-User` and covered by the MAC. */
  userId?: number | string;
  /** Unix seconds; defaults to the current clock. */
  timestamp?: number;
  secret?: string;
}

export interface SignedRequest {
  headers: Record<string, string>;
  /** The exact bytes the caller must send as the payload. */
  payload: Buffer;
}

export function signedRequest(options: SignedRequestOptions): SignedRequest {
  const method = (options.method ?? 'GET').toUpperCase();
  const userId = String(options.userId ?? TEST_USER_ID);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const secret = options.secret ?? TEST_SHARED_SECRET;
  const payload = bodyBytes(options.body);

  const signature = signRequest(secret, {
    timestamp,
    method,
    target: options.url,
    bodyHash: sha256Hex(payload),
    userId,
  });

  return {
    headers: {
      'x-tl-user': userId,
      'x-tl-timestamp': timestamp,
      'x-tl-signature': signature,
    },
    payload,
  };
}

export interface TestUserOptions {
  allowed?: boolean;
  username?: string | null;
  firstName?: string | null;
}

/** Seeds a `users` row directly; tests never go through the session route for it. */
export function seedUser(
  db: Db,
  telegramUserId: number = TEST_USER_ID,
  options: TestUserOptions = {},
): void {
  db.prepare(
    `INSERT INTO users (telegram_user_id, username, first_name, allowed, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    telegramUserId,
    options.username === undefined ? TEST_USERNAME : options.username,
    options.firstName === undefined ? TEST_FIRST_NAME : options.firstName,
    (options.allowed ?? true) ? 1 : 0,
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

/**
 * Adds signed headers to an ordinary `app.inject` call. A `body` object is
 * serialized once so the payload and the MAC cover the same bytes.
 */
export interface InjectedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json(): any;
}

export async function injectSigned(
  app: FastifyInstance,
  options: SignedRequestOptions,
): Promise<InjectedResponse> {
  const { payload, headers } = signedRequest(options);
  const method = (options.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && options.body !== undefined;

  return app.inject({
    method: method as 'GET',
    url: options.url,
    headers: hasBody ? { ...headers, 'content-type': 'application/json' } : headers,
    ...(hasBody ? { payload } : {}),
  });
}
