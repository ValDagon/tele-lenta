/**
 * Pure-JS SHA-256 (FIPS 180-4) for the Telegram Serverless sandbox.
 *
 * The Serverless runtime is a V8 sandbox that cannot rely on `node:crypto`, and
 * the availability of `crypto.subtle` has not been proven there. The active
 * BFF signing path therefore uses this module; `lib/hmac-probe.js` checks
 * `crypto.subtle` separately and only for diagnostics.
 *
 * No imports, no platform globals except typed arrays. Strings are encoded to
 * UTF-8 here so the same bytes reach the hash on every runtime.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/**
 * Normalizes a hash input to bytes.
 *
 * Accepts a string (UTF-8 encoded here), a `Uint8Array`, any other
 * `ArrayBufferView`, a `number[]`, or an `ArrayBuffer`. Lone surrogates are
 * replaced with U+FFFD, matching `TextEncoder` and Node's `Buffer` UTF-8
 * encoder.
 *
 * @param {string|Uint8Array|number[]|ArrayBuffer|ArrayBufferView} value
 * @returns {Uint8Array}
 */
export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return utf8Bytes(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('expected a string, byte array, or ArrayBuffer');
}

/** UTF-8 encodes a JavaScript string without `TextEncoder`. */
export function utf8Bytes(value) {
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = 0xfffd; // lone high surrogate
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd; // lone low surrogate
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Lowercase hex for a byte array. */
export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return hex;
}

/** SHA-256 digest as 32 bytes. */
export function sha256Bytes(value) {
  const input = toBytes(value);
  const byteLength = input.length;

  // Pad: 0x80, zeros, then the 64-bit big-endian bit length.
  const paddedLength = ((byteLength + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[byteLength] = 0x80;

  const highBits = Math.floor(byteLength / 0x20000000); // byteLength * 8 / 2^32
  const lowBits = (byteLength << 3) >>> 0;
  const end = paddedLength;
  padded[end - 8] = (highBits >>> 24) & 0xff;
  padded[end - 7] = (highBits >>> 16) & 0xff;
  padded[end - 6] = (highBits >>> 8) & 0xff;
  padded[end - 5] = highBits & 0xff;
  padded[end - 4] = (lowBits >>> 24) & 0xff;
  padded[end - 3] = (lowBits >>> 16) & 0xff;
  padded[end - 2] = (lowBits >>> 8) & 0xff;
  padded[end - 1] = lowBits & 0xff;

  const state = new Uint32Array(INITIAL_STATE);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    digest[i * 4] = (state[i] >>> 24) & 0xff;
    digest[i * 4 + 1] = (state[i] >>> 16) & 0xff;
    digest[i * 4 + 2] = (state[i] >>> 8) & 0xff;
    digest[i * 4 + 3] = state[i] & 0xff;
  }
  return digest;
}

/** Lowercase hex SHA-256, the form the VPS signature contract uses. */
export function sha256Hex(value) {
  return bytesToHex(sha256Bytes(value));
}
