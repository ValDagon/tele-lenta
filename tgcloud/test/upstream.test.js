import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sha256Hex } from '../lib/sha256.js';
import {
  DEFAULT_TIMEOUT_MS,
  SIGNATURE_HEADER,
  SIGNATURE_VERSION,
  TIMESTAMP_HEADER,
  USER_HEADER,
  buildSignedRequest,
  callVps,
  joinUrl,
  mapUpstreamFailure,
  serializeBody,
} from '../lib/upstream.js';

/**
 * The same contract vps/test/auth-signature.test.ts pins. Computed from the
 * spec text, independently of both implementations.
 */
const TEST_SECRET = 'tele-lenta-test-shared-secret-0123456789';
const PINNED_CANONICAL =
  'TL1\n1700000000\nPOST\n/v1/session?x=1\n' +
  '17b4db064e17f4878e391177e6ca623b798911f34014bc9e78920993d7dd27ad\n42';
const PINNED_SIGNATURE = 'e31c66f79672f1a78e863622d7ebabdee59d58cebd36faee148b97a0b6a5cec4';

const PINNED_INPUT = {
  secret: TEST_SECRET,
  userId: 42,
  method: 'POST',
  target: '/v1/session?x=1',
  body: '{"id":42}',
  timestamp: 1700000000,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildSignedRequest', () => {
  it('reproduces the VPS pinned vector exactly', () => {
    const signed = buildSignedRequest(PINNED_INPUT);

    assert.equal(signed.canonical, PINNED_CANONICAL);
    assert.equal(signed.signature, PINNED_SIGNATURE);
    assert.deepEqual(signed.headers, {
      [USER_HEADER]: '42',
      [TIMESTAMP_HEADER]: '1700000000',
      [SIGNATURE_HEADER]: PINNED_SIGNATURE,
    });
    assert.equal(signed.body, '{"id":42}');
  });

  it('hashes the empty body to the well-known SHA-256', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const signed = buildSignedRequest({ ...PINNED_INPUT, body: undefined });
    assert.ok(signed.canonical.includes('\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n'));
  });

  it('binds the timestamp, method, target, query, body, and user', () => {
    const variants = [
      { timestamp: '1700000060' },
      { method: 'PUT' },
      { target: '/v1/session' },
      { target: '/v1/session?x=2' },
      { body: '{"id":41}' },
      { userId: 41 },
    ];

    for (const change of variants) {
      const signed = buildSignedRequest({ ...PINNED_INPUT, ...change });
      assert.notEqual(signed.signature, PINNED_SIGNATURE, JSON.stringify(change));
    }
  });

  it('normalizes the method to uppercase and keeps the target byte for byte', () => {
    const signed = buildSignedRequest({
      ...PINNED_INPUT,
      method: 'post',
      target: '/v1/feed?q=%D0%9F%D0%BE%D0%B4%D0%B3%D0%BE%D1%80%D0%B8%D1%86%D0%B0&sources=1&sources=2',
    });
    const lines = signed.canonical.split('\n');
    assert.equal(lines[2], 'POST');
    assert.equal(
      lines[3],
      '/v1/feed?q=%D0%9F%D0%BE%D0%B4%D0%B3%D0%BE%D1%80%D0%B8%D1%86%D0%B0&sources=1&sources=2',
    );
    assert.equal(signed.headers[TIMESTAMP_HEADER], '1700000000');
  });

  it('serializes an object body once and signs exactly those bytes', () => {
    const body = { id: 42, name: 'Тест' };
    const signed = buildSignedRequest({
      ...PINNED_INPUT,
      body,
      timestamp: 1700000000,
    });
    assert.equal(signed.body, JSON.stringify(body));
    assert.equal(serializeBody(body), JSON.stringify(body));
    assert.ok(signed.canonical.includes(`\n${sha256Hex(JSON.stringify(body))}\n`));
  });

  it('derives the timestamp from an injected clock', () => {
    const signed = buildSignedRequest({ ...PINNED_INPUT, timestamp: undefined, now: 1_700_000_000_999 });
    assert.equal(signed.headers[TIMESTAMP_HEADER], '1700000000');
  });

  it('rejects a short secret, a bad user id, and a bad target', () => {
    assert.throws(() => buildSignedRequest({ ...PINNED_INPUT, secret: 'short' }), /secret/);
    assert.throws(() => buildSignedRequest({ ...PINNED_INPUT, userId: '007' }), /userId/);
    assert.throws(() => buildSignedRequest({ ...PINNED_INPUT, userId: 0 }), /userId/);
    assert.throws(() => buildSignedRequest({ ...PINNED_INPUT, target: 'v1/feed' }), /target/);
    assert.throws(() => buildSignedRequest({ ...PINNED_INPUT, target: '/v1/feed#x' }), /target/);
    assert.throws(() => buildSignedRequest({ ...PINNED_INPUT, timestamp: 'soon' }), /timestamp/);
  });

  it('keeps the signature version stable', () => {
    assert.equal(SIGNATURE_VERSION, 'TL1');
  });
});

describe('mapUpstreamFailure', () => {
  it('passes stable upstream body codes through', () => {
    assert.equal(mapUpstreamFailure(403, { error: { code: 'not_invited' } }), 'not_invited');
    assert.equal(mapUpstreamFailure(404, { error: { code: 'not_found' } }), 'not_found');
    assert.equal(mapUpstreamFailure(503, { error: { code: 'access_check_failed' } }), 'access_check_failed');
  });

  it('maps statuses when the body carries no usable code', () => {
    assert.equal(mapUpstreamFailure(401, {}), 'init_data_invalid');
    assert.equal(mapUpstreamFailure(403, {}), 'not_invited');
    assert.equal(mapUpstreamFailure(404, {}), 'not_found');
    assert.equal(mapUpstreamFailure(429, {}), 'rate_limited');
    assert.equal(mapUpstreamFailure(500, {}), 'upstream_unavailable');
    assert.equal(mapUpstreamFailure(502, {}), 'upstream_unavailable');
    assert.equal(mapUpstreamFailure(400, {}), 'invalid_request');
    assert.equal(mapUpstreamFailure(418, { error: { code: 'teapot' } }), 'invalid_request');
  });
});

describe('callVps', () => {
  const base = {
    baseUrl: 'https://api.tele-lenta.test',
    secret: TEST_SECRET,
    userId: 42,
    method: 'POST',
    target: '/v1/session?x=1',
    body: '{"id":42}',
    now: 1_700_000_000_000,
  };

  it('sends the signed headers, method, and exact body, and returns JSON', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ allowed: true }, 200);
    };

    const result = await callVps({ ...base, fetchImpl });

    assert.deepEqual(result, { ok: true, status: 200, json: { allowed: true } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.tele-lenta.test/v1/session?x=1');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].init.headers, buildSignedRequest(base).headers);
    assert.equal(calls[0].init.body, '{"id":42}');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  it('joins the base URL and target with exactly one slash', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return jsonResponse({ cards: [] });
    };

    await callVps({ ...base, baseUrl: 'https://api.tele-lenta.test/', method: 'GET', body: undefined, target: '/v1/feed?limit=0', fetchImpl });
    assert.equal(calls[0], 'https://api.tele-lenta.test/v1/feed?limit=0');
    assert.equal(joinUrl('https://api.tele-lenta.test///', '/v1/feed'), 'https://api.tele-lenta.test/v1/feed');
  });

  it('omits the body for GET and HEAD', async () => {
    let seen;
    const fetchImpl = async (_url, init) => {
      seen = init;
      return jsonResponse({ ok: true });
    };
    await callVps({ ...base, method: 'GET', body: '{"ignored":true}', target: '/v1/feed', fetchImpl });
    assert.equal('body' in seen, false);
  });

  it('passes a not_invited 403 through unchanged', async () => {
    const fetchImpl = async () => jsonResponse({ error: { code: 'not_invited', message: 'no' } }, 403);
    const result = await callVps({ ...base, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_invited');
    assert.equal(result.status, 403);
  });

  it('maps 401 without a body code to init_data_invalid', async () => {
    const fetchImpl = async () => jsonResponse({ error: { message: 'nope' } }, 401);
    assert.equal((await callVps({ ...base, fetchImpl })).code, 'init_data_invalid');
  });

  it('maps 404 not_found, 429 rate_limited, and 5xx upstream_unavailable', async () => {
    const cases = [
      [404, { error: { code: 'not_found' } }, 'not_found'],
      [429, { error: { code: 'rate_limited' } }, 'rate_limited'],
      [500, {}, 'upstream_unavailable'],
      [503, { error: { code: 'access_check_failed' } }, 'access_check_failed'],
    ];

    for (const [status, body, expected] of cases) {
      const fetchImpl = async () => jsonResponse(body, status);
      const result = await callVps({ ...base, fetchImpl });
      assert.equal(result.ok, false);
      assert.equal(result.code, expected, `status ${status}`);
    }
  });

  it('maps a non-JSON success to upstream_unavailable', async () => {
    const fetchImpl = async () => new Response('<html>bad gateway</html>', { status: 200 });
    const result = await callVps({ ...base, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'upstream_unavailable');
    assert.equal(result.reason, 'non_json_response');
  });

  it('maps any non-JSON response to upstream_unavailable, whatever the status', async () => {
    const fetchImpl = async () => new Response('bad request', { status: 400 });
    const result = await callVps({ ...base, fetchImpl });
    assert.equal(result.code, 'upstream_unavailable');
    assert.equal(result.reason, 'non_json_response');
  });

  it('maps a network error to upstream_unavailable', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    const result = await callVps({ ...base, fetchImpl });
    assert.deepEqual(result, {
      ok: false,
      code: 'upstream_unavailable',
      status: null,
      reason: 'network_error',
    });
  });

  it('aborts after the timeout and maps it to upstream_unavailable', async () => {
    let aborted = false;
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });

    const result = await callVps({ ...base, fetchImpl, timeoutMs: 5 });
    assert.equal(aborted, true);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'upstream_unavailable');
    assert.equal(result.reason, 'timeout');
  });

  it('defaults to a 10-second timeout', () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 10_000);
  });

  it('never throws when the fetch implementation is missing or the config is bad', async () => {
    const missingFetch = await callVps({ ...base, fetchImpl: null });
    assert.equal(missingFetch.code, 'upstream_unavailable');
    assert.equal(missingFetch.reason, 'fetch_unavailable');

    const badBase = await callVps({ ...base, baseUrl: 'api.example.com', fetchImpl: async () => jsonResponse({}) });
    assert.equal(badBase.reason, 'invalid_base_url');

    const badSecret = await callVps({ ...base, secret: 'short', fetchImpl: async () => jsonResponse({}) });
    assert.equal(badSecret.code, 'upstream_unavailable');
    assert.equal(badSecret.reason, 'invalid_request_parameters');
  });
});
