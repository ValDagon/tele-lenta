import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_CLOCK_SKEW_SECONDS,
  canonicalString,
  sha256Hex,
  signRequest,
  verifySignature,
  type SignatureParts,
} from '../src/auth/signature.js';

import { TEST_SHARED_SECRET } from './helpers/auth.js';

/**
 * The wire contract for ticket #9. The canonical string and the HMAC vector
 * below were computed from the spec text, independently of the BFF's future
 * implementation. If either changes, the BFF is already broken and this test
 * says so.
 */
const CONTRACT: SignatureParts = {
  timestamp: '1700000000',
  method: 'POST',
  target: '/v1/session?x=1',
  bodyHash: sha256Hex('{"id":42}'),
  userId: '42',
};

const PINNED_CANONICAL =
  'TL1\n1700000000\nPOST\n/v1/session?x=1\n' +
  '17b4db064e17f4878e391177e6ca623b798911f34014bc9e78920993d7dd27ad\n42';

const PINNED_SIGNATURE = 'e31c66f79672f1a78e863622d7ebabdee59d58cebd36faee148b97a0b6a5cec4';

describe('request signature contract', () => {
  it('builds the documented canonical string byte for byte', () => {
    assert.equal(canonicalString(CONTRACT), PINNED_CANONICAL);
  });

  it('signs the canonical string with the pinned HMAC-SHA256 vector', () => {
    assert.equal(signRequest(TEST_SHARED_SECRET, CONTRACT), PINNED_SIGNATURE);
    assert.ok(verifySignature(TEST_SHARED_SECRET, CONTRACT, PINNED_SIGNATURE));
    assert.ok(verifySignature(TEST_SHARED_SECRET, CONTRACT, PINNED_SIGNATURE.toUpperCase()));
  });

  it('hashes the empty body to the well-known SHA-256', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(sha256Hex(Buffer.alloc(0)), sha256Hex(''));
  });

  it('binds every part of the request', () => {
    const tampered: Array<[string, SignatureParts]> = [
      ['timestamp', { ...CONTRACT, timestamp: '1700000060' }],
      ['method', { ...CONTRACT, method: 'PUT' }],
      ['target', { ...CONTRACT, target: '/v1/session' }],
      ['query string', { ...CONTRACT, target: '/v1/session?x=2' }],
      ['body hash', { ...CONTRACT, bodyHash: sha256Hex('{"id":41}') }],
      ['user id', { ...CONTRACT, userId: '41' }],
    ];

    for (const [part, parts] of tampered) {
      assert.equal(
        verifySignature(TEST_SHARED_SECRET, parts, PINNED_SIGNATURE),
        false,
        `a signature must not verify after changing ${part}`,
      );
    }
  });

  it('rejects a wrong secret and a malformed signature without throwing', () => {
    assert.equal(verifySignature('another-secret-0123456789abcdef', CONTRACT, PINNED_SIGNATURE), false);
    for (const bad of ['', 'deadbeef', 'z'.repeat(64), PINNED_SIGNATURE.slice(0, 63)]) {
      assert.equal(verifySignature(TEST_SHARED_SECRET, CONTRACT, bad), false);
    }
  });

  it('uses a 60-second clock-skew allowance', () => {
    assert.equal(MAX_CLOCK_SKEW_SECONDS, 60);
  });
});
