/**
 * Pure-JS HMAC-SHA256 (RFC 2104) built on `lib/sha256.js`.
 *
 * The active BFF signing path uses this module, not `crypto.subtle`. See
 * `lib/hmac-probe.js` for the diagnostic probe.
 */

import { sha256Bytes, sha256Hex, toBytes, bytesToHex } from './sha256.js';

const BLOCK_SIZE = 64; // SHA-256 block size in bytes

/**
 * HMAC-SHA256 over any accepted key/message input, as 32 bytes.
 *
 * @param {string|Uint8Array|number[]|ArrayBuffer|ArrayBufferView} key
 * @param {string|Uint8Array|number[]|ArrayBuffer|ArrayBufferView} message
 * @returns {Uint8Array}
 */
export function hmacSha256Bytes(key, message) {
  let keyBytes = toBytes(key);
  // RFC 2104: keys longer than the block size are hashed first; shorter keys
  // are zero-padded. Exactly block-sized keys are used as-is.
  if (keyBytes.length > BLOCK_SIZE) keyBytes = sha256Bytes(keyBytes);

  const messageBytes = toBytes(message);
  const inner = new Uint8Array(BLOCK_SIZE + messageBytes.length);
  const outer = new Uint8Array(BLOCK_SIZE + 32);

  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    const byte = i < keyBytes.length ? keyBytes[i] : 0;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }
  inner.set(messageBytes, BLOCK_SIZE);

  const innerDigest = sha256Bytes(inner);
  outer.set(innerDigest, BLOCK_SIZE);
  return sha256Bytes(outer);
}

/** Lowercase hex HMAC-SHA256. */
export function hmacSha256Hex(key, message) {
  return bytesToHex(hmacSha256Bytes(key, message));
}

/**
 * Compares two byte arrays without an early exit on the first difference.
 * Length is not secret (every caller compares fixed-size digests), but a
 * length mismatch is rejected before the loop.
 */
export function constantTimeEqualBytes(a, b) {
  const left = toBytes(a);
  const right = toBytes(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i] ^ right[i];
  }
  return difference === 0;
}

/**
 * Constant-time comparison of two lowercase/uppercase hex strings.
 *
 * Values must be the same even length and valid hex; a malformed value is
 * rejected before any comparison, so a presented signature of the wrong shape
 * cannot equal an expected one.
 */
export function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || a.length !== b.length || a.length % 2 !== 0) return false;
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= hexValue(a.charCodeAt(i)) ^ hexValue(b.charCodeAt(i));
  }
  return difference === 0;
}

function hexValue(code) {
  // 0-9 => 0..9, A-F => 10..15, a-f => 10..15
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  return (code | 0x20) - 0x61 + 10;
}

/** Lowercase hex for a byte array; re-exported so callers import one module. */
export { sha256Hex };
