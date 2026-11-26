import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  INIT_DATA_MAX_AGE_SECONDS,
  INIT_DATA_MAX_FUTURE_SECONDS,
  buildDataCheckString,
  parseInitData,
  verifyInitData,
} from '../lib/initdata.js';

/**
 * Fixtures in this file are generated with node:crypto from a test bot token.
 * The one exception is PINNED_INIT_DATA below: its hash was computed once,
 * outside this repository's modules, and is hardcoded so a change inside the
 * BFF's HMAC code cannot move both sides of the assertion together.
 */
const TEST_BOT_TOKEN = '424242:TEST-BOT-TOKEN-tele-lenta-000000000';

/** auth_date 1700000000 = 2023-11-14T22:13:20Z; `now` is pinned around it. */
const PINNED_NOW_MS = 1_700_000_000_000;
const PINNED_BOT_TOKEN = '424242:TEST-BOT-TOKEN-tele-lenta-000000000';
const PINNED_INIT_DATA =
  'auth_date=1700000000&chat_instance=-1234567890123456789&chat_type=private' +
  '&query_id=AAHTESTQUERYID&start_param=card_42' +
  '&user=%7B%22id%22%3A1002003004%2C%22first_name%22%3A%22%D0%A2%D0%B5%D1%81%D1%82%22%2C%22last_name%22%3A%22%D0%9F%D0%BE%D0%BB%D1%8C%D0%B7%D0%BE%D0%B2%D0%B0%D1%82%D0%B5%D0%BB%D1%8C%22%2C%22username%22%3A%22beta_tester%22%2C%22language_code%22%3A%22ru%22%7D' +
  '&hash=632179ce939c90b1d54ed4550482749274fd31fec3eafb4bda5b18faed00fac5';

/**
 * Signs a field map the way Telegram does, using node:crypto only.
 * @param {Record<string,string>} fields
 * @param {string} [botToken]
 */
function signInitData(fields, botToken = TEST_BOT_TOKEN) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function userJson(overrides = {}) {
  return JSON.stringify({
    id: 1002003004,
    first_name: 'Тест',
    last_name: 'Пользователь',
    username: 'beta_tester',
    language_code: 'ru',
    ...overrides,
  });
}

function baseFields(authDate) {
  return {
    auth_date: String(authDate),
    chat_instance: '-1234567890123456789',
    chat_type: 'private',
    query_id: 'AAHTESTQUERYID',
    user: userJson(),
  };
}

describe('initData parsing', () => {
  it('parses fields and rejects empty input and duplicate keys', () => {
    const entries = parseInitData('a=1&b=two%20words');
    assert.deepEqual(entries, [
      ['a', '1'],
      ['b', 'two words'],
    ]);
    assert.equal(parseInitData(''), null);
    assert.equal(parseInitData(undefined), null);
    assert.equal(parseInitData('a=1&a=2'), null);
  });

  it('sorts the data-check string by key and drops only the hash', () => {
    const entries = parseInitData('b=2&auth_date=1&hash=deadbeef&a=0');
    assert.equal(buildDataCheckString(entries), 'a=0\nauth_date=1\nb=2');
  });
});

describe('verifyInitData', () => {
  const now = 1_700_000_000_500;

  it('accepts a freshly signed payload and returns the verified user', () => {
    const raw = signInitData({ ...baseFields(1_700_000_000), start_param: 'card_42' });
    const result = verifyInitData(raw, TEST_BOT_TOKEN, { now });

    assert.equal(result.ok, true);
    assert.equal(result.user.id, 1002003004);
    assert.equal(result.user.username, 'beta_tester');
    assert.equal(result.authDate, 1_700_000_000);
    assert.equal(result.startParam, 'card_42');
    assert.equal(result.raw.hash, undefined);
    assert.equal(result.raw.user, userJson());
  });

  it('reproduces the independently computed pinned reference vector', () => {
    // The hash in PINNED_INIT_DATA was computed outside the BFF's HMAC code.
    const result = verifyInitData(PINNED_INIT_DATA, PINNED_BOT_TOKEN, { now: PINNED_NOW_MS });

    assert.equal(result.ok, true, 'the pinned initData vector must verify');
    assert.equal(result.user.id, 1002003004);
    assert.equal(result.user.first_name, 'Тест');
    assert.equal(result.authDate, 1700000000);
    assert.equal(result.startParam, 'card_42');
  });

  it('rejects the pinned vector when a signed byte changes', () => {
    const tampered = PINNED_INIT_DATA.replace('beta_tester', 'alpha_tester');
    const result = verifyInitData(tampered, PINNED_BOT_TOKEN, { now: PINNED_NOW_MS });
    assert.deepEqual(result, {
      ok: false,
      code: 'init_data_invalid',
      reason: 'signature_mismatch',
    });
  });

  it('rejects a bad hash, a missing hash, and a malformed hash', () => {
    const raw = signInitData(baseFields(1_700_000_000));
    const badHash = raw.replace(/hash=[0-9a-f]+$/, `hash=${'0'.repeat(64)}`);
    assert.equal(verifyInitData(badHash, TEST_BOT_TOKEN, { now }).code, 'init_data_invalid');

    const missing = raw.replace(/&hash=[0-9a-f]+$/, '');
    assert.deepEqual(verifyInitData(missing, TEST_BOT_TOKEN, { now }), {
      ok: false,
      code: 'init_data_invalid',
      reason: 'missing_or_malformed_hash',
    });

    const short = raw.replace(/hash=[0-9a-f]+$/, 'hash=deadbeef');
    assert.equal(verifyInitData(short, TEST_BOT_TOKEN, { now }).code, 'init_data_invalid');
  });

  it('rejects a signature made with a different bot token', () => {
    const raw = signInitData(baseFields(1_700_000_000), '999999:OTHER-BOT-TOKEN-00000000000');
    const result = verifyInitData(raw, TEST_BOT_TOKEN, { now });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'init_data_invalid');
  });

  it('rejects auth_date older than 24 hours', () => {
    const stale = signInitData(baseFields(1_700_000_000));
    const result = verifyInitData(stale, TEST_BOT_TOKEN, {
      now: (1_700_000_000 + INIT_DATA_MAX_AGE_SECONDS + 1) * 1000,
    });
    assert.deepEqual(result, {
      ok: false,
      code: 'init_data_expired',
      reason: 'auth_date_too_old',
    });
  });

  it('accepts auth_date exactly 24 hours old', () => {
    const edge = signInitData(baseFields(1_700_000_000));
    const result = verifyInitData(edge, TEST_BOT_TOKEN, {
      now: (1_700_000_000 + INIT_DATA_MAX_AGE_SECONDS) * 1000,
    });
    assert.equal(result.ok, true);
  });

  it('rejects auth_date more than 5 minutes in the future', () => {
    const future = signInitData(baseFields(1_700_000_000 + INIT_DATA_MAX_FUTURE_SECONDS + 1));
    const result = verifyInitData(future, TEST_BOT_TOKEN, { now: 1_700_000_000_000 });
    assert.deepEqual(result, {
      ok: false,
      code: 'init_data_expired',
      reason: 'auth_date_in_the_future',
    });
  });

  it('accepts auth_date exactly 5 minutes in the future', () => {
    const edge = signInitData(baseFields(1_700_000_000 + INIT_DATA_MAX_FUTURE_SECONDS));
    assert.equal(verifyInitData(edge, TEST_BOT_TOKEN, { now: 1_700_000_000_000 }).ok, true);
  });

  it('rejects a missing or malformed auth_date', () => {
    const missing = signInitData({
      chat_type: 'private',
      query_id: 'x',
      user: userJson(),
    });
    assert.equal(verifyInitData(missing, TEST_BOT_TOKEN, { now }).reason, 'missing_auth_date');

    const malformed = signInitData({ ...baseFields(1_700_000_000), auth_date: 'yesterday' });
    assert.equal(verifyInitData(malformed, TEST_BOT_TOKEN, { now }).reason, 'missing_auth_date');
  });

  it('rejects malformed user JSON, a missing user, and a missing id', () => {
    const malformed = signInitData({ ...baseFields(1_700_000_000), user: '{"id":' });
    assert.deepEqual(verifyInitData(malformed, TEST_BOT_TOKEN, { now }), {
      ok: false,
      code: 'init_data_invalid',
      reason: 'malformed_user_json',
    });

    const withoutUser = signInitData({
      auth_date: '1700000000',
      chat_type: 'private',
      query_id: 'AAHTESTQUERYID',
    });
    assert.deepEqual(verifyInitData(withoutUser, TEST_BOT_TOKEN, { now }), {
      ok: false,
      code: 'init_data_invalid',
      reason: 'missing_user',
    });

    const noIdFields = baseFields(1_700_000_000);
    noIdFields.user = JSON.stringify({ username: 'no_id' });
    const noId = signInitData(noIdFields);
    assert.deepEqual(verifyInitData(noId, TEST_BOT_TOKEN, { now }), {
      ok: false,
      code: 'init_data_invalid',
      reason: 'missing_user_id',
    });
  });

  it('accepts a numeric string id and rejects a zero or negative id', () => {
    const fields = baseFields(1_700_000_000);
    fields.user = JSON.stringify({ id: '42' });
    assert.equal(verifyInitData(signInitData(fields), TEST_BOT_TOKEN, { now }).user.id, 42);

    for (const id of [0, -1, '0', '-5', 'abc']) {
      const invalid = baseFields(1_700_000_000);
      invalid.user = JSON.stringify({ id });
      assert.equal(
        verifyInitData(signInitData(invalid), TEST_BOT_TOKEN, { now }).code,
        'init_data_invalid',
        `id ${id}`,
      );
    }
  });

  it('returns null start_param when absent and never returns user on failure', () => {
    const raw = signInitData(baseFields(1_700_000_000));
    const ok = verifyInitData(raw, TEST_BOT_TOKEN, { now });
    assert.equal(ok.startParam, null);

    const bad = verifyInitData(raw, 'wrong-token', { now });
    assert.equal('user' in bad, false);
    assert.equal('authDate' in bad, false);
  });

  it('rejects an empty bot token without throwing', () => {
    const raw = signInitData(baseFields(1_700_000_000));
    const result = verifyInitData(raw, '', { now });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'init_data_invalid');
  });

  it('never echoes the raw initData or the bot token in a failure', () => {
    const raw = signInitData(baseFields(1_700_000_000));
    const result = verifyInitData(raw, 'wrong-token', { now });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(TEST_BOT_TOKEN), false);
    assert.equal(serialized.includes('wrong-token'), false);
    assert.equal(serialized.includes(raw), false);
  });
});
