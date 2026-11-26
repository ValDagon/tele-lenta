import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseTelegramHtml,
  type ParseResult,
  type ParsedMessage,
} from '../src/parser/telegram-html.js';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CDN_PHOTO_HOST = /^https:\/\/cdn[0-9a-z-]*\.telesco\.pe\//i;

function parseFixture(name: string): ParseResult {
  return parseTelegramHtml(readFileSync(join(fixturesDir, name), 'utf8'));
}

function messagesOf(result: ParseResult): ParsedMessage[] {
  assert.equal(result.kind, 'messages', `expected messages, got ${result.kind}`);
  if (result.kind !== 'messages') throw new Error('unreachable');
  return result.messages;
}

function oneMessage(result: ParseResult): ParsedMessage {
  const messages = messagesOf(result);
  assert.equal(messages.length, 1);
  const [message] = messages;
  assert.ok(message !== undefined);
  return message;
}

/** A photo URL is only ever a Telegram CDN photo, never an emoji or avatar. */
function assertCdnPhotos(messages: ParsedMessage[]): void {
  for (const message of messages) {
    for (const photo of message.photos) {
      assert.match(photo, CDN_PHOTO_HOST, `unexpected photo host in message ${message.id}`);
      assert.ok(!photo.includes('telegram.org/img/emoji'), 'emoji images must not be photos');
    }
  }
}

describe('parser on real Telegram HTML fixtures', () => {
  const expectedShape = [
    {
      fixture: 'channel-montework.html',
      kind: 'messages' as const,
      count: 20,
      firstId: 1224,
      lastId: 1246,
    },
    {
      fixture: 'group-text-photos.html',
      kind: 'messages' as const,
      count: 1,
      firstId: 1110000,
      lastId: 1110000,
    },
    {
      fixture: 'group-image-only.html',
      kind: 'messages' as const,
      count: 1,
      firstId: 384013,
      lastId: 384013,
    },
    {
      fixture: 'group-video.html',
      kind: 'messages' as const,
      count: 1,
      firstId: 1110022,
      lastId: 1110022,
    },
    {
      fixture: 'edited-post.html',
      kind: 'messages' as const,
      count: 1,
      firstId: 535,
      lastId: 535,
    },
    { fixture: 'not-found.html', kind: 'not_found' as const },
  ];

  for (const testCase of expectedShape) {
    it(`reads ${testCase.fixture} as ${testCase.kind}`, () => {
      const result = parseFixture(testCase.fixture);
      assert.equal(result.kind, testCase.kind);
      if (result.kind !== 'messages') return;

      assert.equal(result.messages.length, testCase.count);
      assert.equal(result.messages[0]?.id, testCase.firstId);
      assert.equal(result.messages[result.messages.length - 1]?.id, testCase.lastId);
      assertCdnPhotos(result.messages);
    });
  }

  it('parses a channel page with several posts, ascending ids and real dates', () => {
    const messages = messagesOf(parseFixture('channel-montework.html'));

    assert.equal(messages.length, 20);
    const ids = messages.map((message) => message.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.equal(new Set(ids).size, ids.length);

    for (const message of messages) {
      assert.equal(new Date(message.datetime).toISOString(), message.datetime);
      assert.equal(message.edited, false);
      assert.equal(message.hasVideo, false);
    }
  });

  it('preserves line breaks in post text', () => {
    const messages = messagesOf(parseFixture('channel-montework.html'));
    const message = messages.find((candidate) => candidate.id === 1224);

    assert.ok(message !== undefined);
    assert.equal(message.text, 'Первая строка\n\nВторая строка\nТретья строка');
  });

  it('parses a group embed with text and photos in order', () => {
    const message = oneMessage(parseFixture('group-text-photos.html'));

    assert.equal(message.id, 1110000);
    assert.equal(message.datetime, '2026-10-31T16:26:49.000Z');
    assert.equal(
      message.text,
      'Продам тестовый товар\n\nЦена: 100 €\nГород: Подгорица\n\n@example',
    );
    assert.equal(message.photos.length, 4);
    assert.equal(message.hasVideo, false);
    assert.equal(message.edited, false);
    assert.equal(new Set(message.photos).size, 4);
    assertCdnPhotos([message]);
  });

  it('parses an album across consecutive ids with one caption and one photo set', () => {
    const fixtures = ['album-1109995.html', 'album-1109996.html', 'album-1109997.html'];
    const messages = fixtures.map((fixture) => oneMessage(parseFixture(fixture)));

    assert.deepEqual(
      messages.map((message) => message.id),
      [1109995, 1109996, 1109997],
    );
    assert.equal(messages[1]?.id, (messages[0]?.id ?? 0) + 1);
    assert.equal(messages[2]?.id, (messages[1]?.id ?? 0) + 1);

    const texts = new Set(messages.map((message) => message.text));
    assert.equal(texts.size, 1, 'album members share a caption');

    const photoSets = messages.map((message) => JSON.stringify(message.photos));
    assert.equal(new Set(photoSets).size, 1, 'album members share one photo set');
    assert.equal(messages[0]?.photos.length, 7);
    assertCdnPhotos(messages);
  });

  it('keeps an image-only post with no text', () => {
    const message = oneMessage(parseFixture('group-image-only.html'));

    assert.equal(message.text, '');
    assert.equal(message.photos.length, 7);
    assert.equal(message.hasVideo, false);
    assertCdnPhotos([message]);
  });

  it('keeps the emoji in text and never treats it as a photo', () => {
    const message = oneMessage(parseFixture('emoji-image-set.html'));

    assert.match(message.text, /📍/);
    assert.equal(message.photos.length, 1);
    assert.ok(!message.photos.some((photo) => photo.includes('telegram.org')));
    assertCdnPhotos([message]);
  });

  it('reports video presence and does not mistake a video thumbnail for a photo', () => {
    const message = oneMessage(parseFixture('group-video.html'));

    assert.equal(message.hasVideo, true);
    assert.deepEqual(message.photos, []);
    assert.ok(message.text.length > 0);
  });

  it('distinguishes an explicit "Post not found" from a parse failure', () => {
    const notFound = parseFixture('not-found.html');
    const corrupted = parseFixture('corrupted-truncated.html');

    assert.deepEqual(notFound, { kind: 'not_found' });
    assert.equal(corrupted.kind, 'parse_error');
  });

  it('flags an edited post', () => {
    const message = oneMessage(parseFixture('edited-post.html'));

    assert.equal(message.edited, true);
    assert.equal(message.datetime, '2026-07-30T16:52:37.000Z');
  });

  it('drops service messages before they reach callers', () => {
    const messages = messagesOf(parseFixture('service-message.html'));
    assert.deepEqual(messages, []);
  });

  it('fails loudly on markup drift instead of returning an empty feed', () => {
    const renamed = parseFixture('corrupted-message-class.html');
    assert.equal(renamed.kind, 'parse_error');
    if (renamed.kind === 'parse_error') {
      assert.match(renamed.error, /no tgme_widget_message widgets/);
    }

    const truncated = parseFixture('corrupted-truncated.html');
    assert.equal(truncated.kind, 'parse_error');
    if (truncated.kind === 'parse_error') {
      assert.match(truncated.error, /missing its <time datetime>/);
    }
  });

  it('treats an empty document as a parse error, not as "no new posts"', () => {
    assert.equal(parseTelegramHtml('').kind, 'parse_error');
    assert.equal(parseTelegramHtml('   \n  ').kind, 'parse_error');
  });

  it('can opt into an empty result explicitly', () => {
    const result = parseTelegramHtml('<html><body></body></html>', { requireMessages: false });
    assert.deepEqual(result, { kind: 'messages', messages: [] });
  });

  it('only accepts photo URLs from cdn*.telesco.pe across every fixture', () => {
    const mediaFixtures = [
      'channel-montework.html',
      'group-text-photos.html',
      'album-1109995.html',
      'group-image-only.html',
      'emoji-image-set.html',
      'group-video.html',
    ];

    for (const fixture of mediaFixtures) {
      const result = parseFixture(fixture);
      if (result.kind !== 'messages') continue;
      assertCdnPhotos(result.messages);
    }
  });
});
