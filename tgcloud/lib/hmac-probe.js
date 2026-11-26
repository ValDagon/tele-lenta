/**
 * Runtime HMAC diagnostic probe.
 *
 * Ticket #9 asked for a pre-flight: does the Serverless runtime provide
 * `crypto.subtle`? This probe answers that and checks one RFC 4231 vector
 * through it. It is NOT on the signing path: `lib/hmac.js` is always used, so a
 * missing or broken `crypto.subtle` cannot break the BFF.
 *
 * Run it once after a deploy (or from a temporary diagnostic endpoint) and
 * record the result in the ticket. `subtleAvailable: false` is expected in a
 * runtime that exposes no Web Crypto; it is not an error.
 */

import { bytesToHex, utf8Bytes } from './sha256.js';

/** RFC 4231, test case 2. */
export const RFC4231_CASE_2 = Object.freeze({
  key: 'Jefe',
  message: 'what do ya want for nothing?',
  digest: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
});

/**
 * @returns {Promise<{
 *   subtleAvailable: boolean,
 *   vectorOk: boolean,
 *   activePath: 'pure-js',
 *   detail?: string,
 * }>}
 */
export async function probeHmac() {
  const cryptoObject = globalThis.crypto;
  const subtle = cryptoObject && cryptoObject.subtle;

  if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.sign !== 'function') {
    return { subtleAvailable: false, vectorOk: false, activePath: 'pure-js' };
  }

  try {
    const key = await subtle.importKey(
      'raw',
      utf8Bytes(RFC4231_CASE_2.key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await subtle.sign('HMAC', key, utf8Bytes(RFC4231_CASE_2.message));
    const hex = bytesToHex(new Uint8Array(signature));
    return {
      subtleAvailable: true,
      vectorOk: hex === RFC4231_CASE_2.digest,
      activePath: 'pure-js',
    };
  } catch (error) {
    return {
      subtleAvailable: true,
      vectorOk: false,
      activePath: 'pure-js',
      detail: error && error.name ? String(error.name) : 'subtle_error',
    };
  }
}
