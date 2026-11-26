import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  bytesToHex,
  sha256Bytes,
  sha256Hex,
  toBytes,
  utf8Bytes,
} from '../lib/sha256.js';
import {
  constantTimeEqualBytes,
  constantTimeEqualHex,
  hmacSha256Bytes,
  hmacSha256Hex,
} from '../lib/hmac.js';

const hex = (bytes) => Buffer.from(bytes).toString('hex');

describe('sha256', () => {
  it('hashes the well-known empty and "abc" vectors', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    assert.equal(sha256Bytes('').length, 32);
  });

  it('encodes UTF-8 itself, including surrogate pairs and lone surrogates', () => {
    const samples = ['Подгорица', 'Никшић', '😀 emoji', 'a\u0301', 'lone\uD800here', 'lone\uDC00here'];
    for (const sample of samples) {
      assert.equal(bytesToHex(utf8Bytes(sample)), Buffer.from(sample, 'utf8').toString('hex'));
      assert.equal(sha256Hex(sample), createHash('sha256').update(sample, 'utf8').digest('hex'));
    }
  });

  it('accepts strings, Uint8Array, ArrayBuffer, views, and number arrays', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    assert.equal(sha256Hex(bytes), expected);
    assert.equal(sha256Hex(Array.from(bytes)), expected);
    assert.equal(sha256Hex(bytes.buffer), expected);
    assert.equal(sha256Hex(new DataView(bytes.buffer)), expected);
    assert.deepEqual(toBytes(bytes), bytes);
  });

  it('hashes a message that needs extra padding blocks', () => {
    for (const length of [55, 56, 63, 64, 65, 127, 128, 129, 1000]) {
      const input = 'a'.repeat(length);
      assert.equal(sha256Hex(input), createHash('sha256').update(input).digest('hex'), `length ${length}`);
    }
  });

  it('matches node:crypto on random byte arrays and strings', () => {
    for (let i = 0; i < 40; i += 1) {
      const bytes = randomBytes(Math.floor(Math.random() * 300));
      assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));

      const length = Math.floor(Math.random() * 120);
      const pool = ['a', 'Z', '0', ' ', 'é', 'ћ', 'Ж', '😀', '\u0000', '\uD83D'];
      let text = '';
      for (let j = 0; j < length; j += 1) {
        text += pool[Math.floor(Math.random() * pool.length)];
      }
      assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('hmac-sha256 (RFC 4231)', () => {
  const cases = [
    {
      name: 'case 1',
      key: Buffer.alloc(20, 0x0b),
      message: 'Hi There',
      expected: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    },
    {
      name: 'case 2',
      key: 'Jefe',
      message: 'what do ya want for nothing?',
      expected: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    },
    {
      name: 'case 4',
      key: Buffer.from(Array.from({ length: 25 }, (_, i) => i + 1)),
      message: Buffer.alloc(50, 0xcd),
      expected: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    },
    {
      name: 'case 6 (key longer than block size)',
      key: Buffer.alloc(131, 0xaa),
      message: 'Test Using Larger Than Block-Size Key - Hash Key First',
      expected: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    },
    {
      name: 'case 7 (long key and long message)',
      key: Buffer.alloc(131, 0xaa),
      message:
        'This is a test using a larger than block-size key and a larger than block-size data. ' +
        'The key needs to be hashed before being used by the HMAC algorithm.',
      expected: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    },
  ];

  for (const testCase of cases) {
    it(`matches ${testCase.name}`, () => {
      assert.equal(hmacSha256Hex(testCase.key, testCase.message), testCase.expected);
      assert.equal(hex(hmacSha256Bytes(testCase.key, testCase.message)), testCase.expected);
    });
  }

  it('matches node:crypto on random keys and messages', () => {
    for (let i = 0; i < 20; i += 1) {
      const key = randomBytes(Math.floor(Math.random() * 200));
      const message = randomBytes(Math.floor(Math.random() * 400));
      const expected = createHmac('sha256', key).update(message).digest('hex');
      assert.equal(hmacSha256Hex(key, message), expected);
    }
  });

  it('treats a block-sized key without hashing it', () => {
    const key = randomBytes(64);
    const message = 'x';
    assert.equal(
      hmacSha256Hex(key, message),
      createHmac('sha256', key).update(message).digest('hex'),
    );
  });
});

describe('constant-time comparison helpers', () => {
  it('compares equal and unequal byte arrays', () => {
    assert.equal(constantTimeEqualBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3])), true);
    assert.equal(constantTimeEqualBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4])), false);
    assert.equal(constantTimeEqualBytes(Uint8Array.from([1]), Uint8Array.from([1, 2])), false);
  });

  it('compares hex case-insensitively and rejects malformed values', () => {
    const lower = 'a'.repeat(64);
    assert.equal(constantTimeEqualHex(lower, lower.toUpperCase()), true);
    assert.equal(constantTimeEqualHex(lower, 'b'.repeat(63)), false);
    assert.equal(constantTimeEqualHex(lower, 'z'.repeat(64)), false);
    assert.equal(constantTimeEqualHex('', ''), false);
    assert.equal(constantTimeEqualHex(lower, `${'a'.repeat(63)}g`), false);
  });
});
