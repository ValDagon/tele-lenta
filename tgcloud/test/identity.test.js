import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { identity } from '../lib/resources.js';

/**
 * The manual path is re-verification of `initData` under a configured bot token.
 * Fixtures are signed with node:crypto from a test token, never a real one.
 */
const TEST_BOT_TOKEN = '424242:TEST-BOT-TOKEN-tele-lenta-000000000';
const PINNED_NOW_MS = 1_700_000_000_500;

function signInitData(fields, botToken = TEST_BOT_TOKEN) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function signedInitData(overrides = {}) {
  return signInitData({
    auth_date: '1700000000',
    user: JSON.stringify({
      id: 1002003004,
      first_name: 'Тест',
      username: 'beta_tester',
      language_code: 'ru',
    }),
    ...overrides,
  });
}

const PLATFORM_USER = { id: 1002003004, first_name: 'Тест', username: 'platform_user' };

function thrownCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code;
  }
}

describe('identity: platform-verified path', () => {
  it('uses ctx.initData.user and normalizes the id', () => {
    const user = identity({ initData: { user: PLATFORM_USER } }, {});
    assert.equal(user.id, 1002003004);
    assert.equal(user.username, 'platform_user');

    const numeric = identity({ initData: { user: { id: '42' } } }, {});
    assert.equal(numeric.id, 42);
  });

  it('ignores initData in the body when no bot token is configured', () => {
    const user = identity({ initData: { user: PLATFORM_USER } }, { initData: 'garbage' });
    assert.equal(user.id, 1002003004);
  });

  it('rejects a missing user or a missing user id', () => {
    assert.equal(thrownCode(() => identity({}, {})), 'init_data_invalid');
    assert.equal(thrownCode(() => identity(undefined, undefined)), 'init_data_invalid');
    assert.equal(thrownCode(() => identity({ initData: {} }, {})), 'init_data_invalid');
    assert.equal(thrownCode(() => identity({ initData: { user: {} } }, {})), 'init_data_invalid');
    assert.equal(thrownCode(() => identity({ initData: { user: { id: 0 } } }, {})), 'init_data_invalid');
    assert.equal(thrownCode(() => identity({ initData: { user: { id: -5 } } }, {})), 'init_data_invalid');
    assert.equal(
      thrownCode(() => identity({ initData: { user: { id: 1.5 } } }, {})),
      'init_data_invalid',
    );
  });
});

describe('identity: manual initData path', () => {
  const options = { botToken: TEST_BOT_TOKEN, now: PINNED_NOW_MS };

  it('verifies the payload and prefers it over ctx', () => {
    const user = identity({ initData: { user: { id: 999 } } }, { initData: signedInitData() }, options);
    assert.equal(user.id, 1002003004);
    assert.equal(user.username, 'beta_tester');
    assert.equal(user.first_name, 'Тест');
  });

  it('rejects a tampered payload instead of falling back to ctx', () => {
    const tampered = signedInitData().replace('beta_tester', 'alpha_tester');
    assert.equal(
      thrownCode(() => identity({ initData: { user: PLATFORM_USER } }, { initData: tampered }, options)),
      'init_data_invalid',
    );
  });

  it('maps an expired auth_date to init_data_expired', () => {
    const raw = signedInitData({ auth_date: '1700000000' });
    const now = 1_700_200_000_000; // more than 24 hours later
    assert.equal(
      thrownCode(() => identity({ initData: { user: PLATFORM_USER } }, { initData: raw }, { botToken: TEST_BOT_TOKEN, now })),
      'init_data_expired',
    );
  });

  it('does not read a user id from input.id or input.user_id', () => {
    assert.equal(
      thrownCode(() => identity({}, { id: 1002003004, user_id: 1002003004 })),
      'init_data_invalid',
    );
    assert.equal(
      thrownCode(() => identity({}, { id: 1002003004 }, { botToken: TEST_BOT_TOKEN, now: PINNED_NOW_MS })),
      'init_data_invalid',
    );
  });
});
