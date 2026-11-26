import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RFC4231_CASE_2, probeHmac } from '../lib/hmac-probe.js';
import { hmacSha256Hex } from '../lib/hmac.js';

describe('hmac runtime probe', () => {
  it('checks the RFC 4231 case 2 vector through crypto.subtle when present', async () => {
    const result = await probeHmac();

    assert.equal(result.activePath, 'pure-js');
    assert.equal(typeof result.subtleAvailable, 'boolean');
    assert.equal(typeof result.vectorOk, 'boolean');

    // Node 22 has Web Crypto, so both must hold here.
    assert.equal(result.subtleAvailable, true);
    assert.equal(result.vectorOk, true);
  });

  it('pins the probe vector against the pure-JS implementation too', () => {
    assert.equal(
      hmacSha256Hex(RFC4231_CASE_2.key, RFC4231_CASE_2.message),
      RFC4231_CASE_2.digest,
    );
  });
});
