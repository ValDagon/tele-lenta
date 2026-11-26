import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  START_BUTTON_TEXT,
  START_TEXT,
  START_UNAVAILABLE_TEXT,
  isStartCommand,
  isWebAppUrl,
  miniAppUrl,
  startCommandPayload,
  startReply,
} from '../lib/start.js';

/** A minimal Update.message in a private chat. */
function privateMessage(text, extra = {}) {
  return { chat: { id: 42, type: 'private' }, text, ...extra };
}

describe('isStartCommand', () => {
  it('accepts /start in a private chat', () => {
    assert.equal(isStartCommand(privateMessage('/start')), true);
  });

  it('accepts the addressed form /start@bot_username', () => {
    assert.equal(isStartCommand(privateMessage('/start@TeleLentaBot')), true);
    assert.equal(isStartCommand(privateMessage('/start@tele_lenta_bot card_7')), true);
  });

  it('accepts /start followed by a deep-link payload', () => {
    assert.equal(isStartCommand(privateMessage('/start card_42')), true);
    assert.equal(isStartCommand(privateMessage('/start   card_42')), true);
  });

  it('rejects ordinary text', () => {
    assert.equal(isStartCommand(privateMessage('привет')), false);
    assert.equal(isStartCommand(privateMessage('start')), false);
  });

  it('rejects the command in a group, supergroup, or channel', () => {
    for (const type of ['group', 'supergroup', 'channel']) {
      assert.equal(isStartCommand({ chat: { id: 1, type }, text: '/start' }), false, type);
    }
  });

  it('rejects a missing chat, missing text, and non-string text', () => {
    assert.equal(isStartCommand(null), false);
    assert.equal(isStartCommand(undefined), false);
    assert.equal(isStartCommand('not a message'), false);
    assert.equal(isStartCommand({}), false);
    assert.equal(isStartCommand({ chat: { id: 1, type: 'private' } }), false);
    assert.equal(isStartCommand({ chat: { id: 1, type: 'private' }, text: 42 }), false);
    assert.equal(isStartCommand({ chat: { id: 1, type: 'private' }, text: null }), false);
  });

  it('does not match a longer command or a bare @', () => {
    assert.equal(isStartCommand(privateMessage('/starter')), false);
    assert.equal(isStartCommand(privateMessage('/start@')), false);
    assert.equal(isStartCommand(privateMessage('/start_extra')), false);
  });

  it('requires the lowercase command, as Telegram sends it', () => {
    assert.equal(isStartCommand(privateMessage('/Start')), false);
    assert.equal(isStartCommand(privateMessage('/START')), false);
  });
});

describe('startCommandPayload', () => {
  it('returns null when there is no payload', () => {
    assert.equal(startCommandPayload(privateMessage('/start')), null);
    assert.equal(startCommandPayload(privateMessage('/start   ')), null);
    assert.equal(startCommandPayload(privateMessage('/start@TeleLentaBot')), null);
  });

  it('returns the payload after the command', () => {
    assert.equal(startCommandPayload(privateMessage('/start card_42')), 'card_42');
    assert.equal(startCommandPayload(privateMessage('/start@TeleLentaBot card_42')), 'card_42');
  });

  it('trims only the edges and keeps inner spacing', () => {
    assert.equal(startCommandPayload(privateMessage('/start   card_42  ')), 'card_42');
    assert.equal(startCommandPayload(privateMessage('/start  two words')), 'two words');
  });

  it('returns null for a non-start message', () => {
    assert.equal(startCommandPayload(privateMessage('card_42')), null);
    assert.equal(startCommandPayload(privateMessage('/start')), null);
    assert.equal(startCommandPayload(null), null);
    assert.equal(
      startCommandPayload({ chat: { id: 1, type: 'group' }, text: '/start card_42' }),
      null,
    );
  });
});

describe('isWebAppUrl', () => {
  it('accepts an https URL with a host', () => {
    assert.equal(isWebAppUrl('https://app.tele-lenta.example'), true);
    assert.equal(isWebAppUrl('https://app.tele-lenta.example/feed?x=1'), true);
    assert.equal(isWebAppUrl('  https://app.tele-lenta.example  '), true);
  });

  it('rejects http, a missing host, and empty values', () => {
    assert.equal(isWebAppUrl('http://app.tele-lenta.example'), false);
    assert.equal(isWebAppUrl('https://'), false);
    assert.equal(isWebAppUrl('https:// '), false);
    assert.equal(isWebAppUrl(''), false);
    assert.equal(isWebAppUrl('   '), false);
    assert.equal(isWebAppUrl(undefined), false);
    assert.equal(isWebAppUrl(null), false);
  });

  it('rejects non-string and non-URL garbage', () => {
    assert.equal(isWebAppUrl(42), false);
    assert.equal(isWebAppUrl({ url: 'https://example.test' }), false);
    assert.equal(isWebAppUrl('app.tele-lenta.example'), false);
    assert.equal(isWebAppUrl('javascript:alert(1)'), false);
  });
});

describe('startReply', () => {
  it('returns the greeting and a web_app keyboard for a valid URL', () => {
    const reply = startReply({ miniappUrl: 'https://app.tele-lenta.example/' });

    assert.deepEqual(reply, {
      text: START_TEXT,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: START_BUTTON_TEXT,
              web_app: { url: 'https://app.tele-lenta.example/' },
            },
          ],
        ],
      },
    });
  });

  it('returns only the fallback text when the URL is missing or invalid', () => {
    for (const miniappUrl of [undefined, null, '', 'http://app.tele-lenta.example']) {
      const reply = startReply({ miniappUrl });
      assert.equal(reply.text, START_UNAVAILABLE_TEXT, String(miniappUrl));
      assert.equal('reply_markup' in reply, false, String(miniappUrl));
    }
  });

  it('also works when called without arguments', () => {
    const reply = startReply();
    assert.equal(reply.text, START_UNAVAILABLE_TEXT);
    assert.equal('reply_markup' in reply, false);
  });

  it('keeps the greeting free of emoji and exclamation marks', () => {
    assert.doesNotMatch(START_TEXT, /[!！]/);
    assert.doesNotMatch(START_TEXT, /\p{Extended_Pictographic}/u);
    assert.equal(START_TEXT.includes('\uFF01'), false);
  });
});

describe('miniAppUrl', () => {
  it('prefers the settings row over the environment', () => {
    const url = miniAppUrl({
      settings: new Map([['miniapp_url', 'https://settings.tele-lenta.example']]),
      env: { MINI_APP_URL: 'https://env.tele-lenta.example' },
    });

    assert.equal(url, 'https://settings.tele-lenta.example');
  });

  it('accepts settings as a plain object and as row arrays', () => {
    assert.equal(
      miniAppUrl({ settings: { miniapp_url: 'https://object.tele-lenta.example' }, env: {} }),
      'https://object.tele-lenta.example',
    );
    assert.equal(
      miniAppUrl({
        settings: [{ key: 'miniapp_url', value: 'https://rows.tele-lenta.example' }],
        env: {},
      }),
      'https://rows.tele-lenta.example',
    );
  });

  it('falls back to env.MINI_APP_URL', () => {
    assert.equal(
      miniAppUrl({ settings: new Map(), env: { MINI_APP_URL: 'https://env.tele-lenta.example' } }),
      'https://env.tele-lenta.example',
    );
  });

  it('returns null when neither source is configured', () => {
    assert.equal(miniAppUrl({ settings: new Map(), env: {} }), null);
    assert.equal(miniAppUrl({}), null);
    assert.equal(miniAppUrl(), null);
  });

  it('trims whitespace around the configured value', () => {
    assert.equal(
      miniAppUrl({ settings: { miniapp_url: '   https://app.tele-lenta.example/path  ' }, env: {} }),
      'https://app.tele-lenta.example/path',
    );
  });

  it('rejects http and falls back to a valid env URL', () => {
    assert.equal(
      miniAppUrl({
        settings: { miniapp_url: 'http://app.tele-lenta.example' },
        env: { MINI_APP_URL: 'https://env.tele-lenta.example' },
      }),
      'https://env.tele-lenta.example',
    );
    assert.equal(miniAppUrl({ settings: { miniapp_url: 'http://app.tele-lenta.example' } }), null);
  });

  it('ignores blank values', () => {
    assert.equal(
      miniAppUrl({ settings: { miniapp_url: '   ' }, env: { MINI_APP_URL: '  ' } }),
      null,
    );
  });
});
