/**
 * The BFF → VPS request signature. This module is the contract: ticket #9 must
 * reproduce it byte for byte, and the pinned vector in
 * `test/auth-signature.test.ts` fails if the canonical string ever changes.
 *
 * Three headers:
 *
 *   X-TL-User       the Telegram user id, decimal, no sign and no leading zero
 *   X-TL-Timestamp  Unix epoch SECONDS, decimal
 *   X-TL-Signature  HMAC-SHA256, lowercase hex (64 characters)
 *
 * The MAC is over this exact string, `\n`-separated with no trailing newline:
 *
 *   TL1
 *   <timestamp exactly as sent>
 *   <METHOD, uppercase>
 *   <request target exactly as sent: path plus `?query`, percent-encoding untouched>
 *   <sha256 hex of the raw request body; the empty body is sha256("")>
 *   <user id exactly as sent>
 *
 * The version line lets a future format change fail closed instead of parsing
 * ambiguous input. The user id is inside the MAC, so a signature made for one
 * user cannot be replayed as another. The request target includes the query
 * string, so feed filters and cursors are covered too; no fragment is ever
 * sent. The body hash is over the bytes on the wire, before JSON parsing, so a
 * re-serialized body does not verify.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_VERSION = 'TL1';

export const USER_HEADER = 'x-tl-user';
export const TIMESTAMP_HEADER = 'x-tl-timestamp';
export const SIGNATURE_HEADER = 'x-tl-signature';

/** The 60-second clock-skew allowance, and therefore the v1 replay window. */
export const MAX_CLOCK_SKEW_SECONDS = 60;

/** Lowercase hex SHA-256 of the body bytes; `sha256Hex('')` is the empty hash. */
export function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

export interface SignatureParts {
  /** X-TL-Timestamp exactly as sent. */
  timestamp: string;
  /** HTTP method, uppercase. */
  method: string;
  /** Raw request target: pathname plus `?query`, as sent. */
  target: string;
  /** Lowercase hex SHA-256 of the raw body. */
  bodyHash: string;
  /** X-TL-User exactly as sent. */
  userId: string;
}

/** The canonical string the HMAC is computed over. */
export function canonicalString(parts: SignatureParts): string {
  return [
    SIGNATURE_VERSION,
    parts.timestamp,
    parts.method.toUpperCase(),
    parts.target,
    parts.bodyHash,
    parts.userId,
  ].join('\n');
}

/** HMAC-SHA256 over the canonical string, lowercase hex. */
export function signRequest(secret: string, parts: SignatureParts): string {
  return createHmac('sha256', secret).update(canonicalString(parts)).digest('hex');
}

/**
 * Constant-time check of a presented signature. A malformed value (not 64 hex
 * characters) is rejected before any comparison; the buffers compared are
 * always the same length.
 */
export function verifySignature(
  secret: string,
  parts: SignatureParts,
  presented: string,
): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(presented)) return false;
  const expected = Buffer.from(signRequest(secret, parts), 'hex');
  const actual = Buffer.from(presented.toLowerCase(), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
