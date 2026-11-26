import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EndpointError,
  ERROR_CODES,
  ERROR_CODE_LIST,
  errorBody,
  errorResult,
  isErrorCode,
  jsonResult,
  messageForCode,
  statusForCode,
  toErrorResult,
} from '../lib/errors.js';

describe('error envelope', () => {
  it('uses the spec shape and the stable code list', () => {
    assert.deepEqual(ERROR_CODE_LIST, [
      'init_data_invalid',
      'init_data_expired',
      'not_invited',
      'access_check_failed',
      'not_found',
      'invalid_request',
      'rate_limited',
      'upstream_unavailable',
    ]);

    assert.deepEqual(errorBody(ERROR_CODES.NOT_INVITED), {
      error: { code: 'not_invited', message: messageForCode('not_invited') },
    });
    assert.deepEqual(errorBody('not_found', 'card 7 is gone'), {
      error: { code: 'not_found', message: 'card 7 is gone' },
    });
  });

  it('knows every stable code and rejects anything else', () => {
    for (const code of ERROR_CODE_LIST) assert.equal(isErrorCode(code), true);
    for (const value of ['', 'teapot', undefined, null, 42]) assert.equal(isErrorCode(value), false);
  });

  it('maps codes to HTTP statuses', () => {
    assert.equal(statusForCode('init_data_invalid'), 401);
    assert.equal(statusForCode('init_data_expired'), 401);
    assert.equal(statusForCode('not_invited'), 403);
    assert.equal(statusForCode('not_found'), 404);
    assert.equal(statusForCode('invalid_request'), 400);
    assert.equal(statusForCode('rate_limited'), 429);
    assert.equal(statusForCode('access_check_failed'), 503);
    assert.equal(statusForCode('upstream_unavailable'), 503);
    assert.equal(statusForCode('unknown'), 500);
  });

  it('builds JSON results with no-store caching', () => {
    const result = jsonResult({ cards: [] });
    assert.equal(result.status, 200);
    assert.equal(result.body, '{"cards":[]}');
    assert.deepEqual(result.json, { cards: [] });
    assert.match(result.headers['content-type'], /application\/json/);
    assert.equal(result.headers['cache-control'], 'no-store');
  });

  it('builds an error result with the code status', () => {
    const result = errorResult('rate_limited');
    assert.equal(result.status, 429);
    assert.deepEqual(JSON.parse(result.body), {
      error: { code: 'rate_limited', message: messageForCode('rate_limited') },
    });
  });
});

describe('EndpointError', () => {
  it('carries the code, status, and the platform parameters', () => {
    const error = new EndpointError('init_data_expired');
    assert.equal(error.name, 'EndpointError');
    assert.equal(error.code, 'init_data_expired');
    assert.equal(error.status, 401);
    assert.deepEqual(error.parameters, {
      code: 'init_data_expired',
      message: messageForCode('init_data_expired'),
    });
    assert.deepEqual(error.toJSON(), errorBody('init_data_expired'));
    assert.ok(error instanceof Error);
  });

  it('accepts a custom message and a cause without leaking it in JSON', () => {
    const cause = new Error('secret=abc');
    const error = new EndpointError('upstream_unavailable', 'vps timed out', { cause });
    assert.equal(error.message, 'vps timed out');
    assert.equal(error.cause, cause);
    assert.equal(JSON.stringify(error.toJSON()).includes('secret=abc'), false);
  });

  it('normalizes thrown values to the neutral upstream code', () => {
    const known = toErrorResult(new EndpointError('not_invited'));
    assert.equal(known.status, 403);
    assert.equal(JSON.parse(known.body).error.code, 'not_invited');

    const unknown = toErrorResult(new Error('boom at /secret/path'));
    assert.equal(unknown.status, 503);
    assert.deepEqual(JSON.parse(unknown.body), {
      error: { code: 'upstream_unavailable', message: messageForCode('upstream_unavailable') },
    });
  });
});
