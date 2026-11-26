import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  channelPageUrl,
  messageEmbedUrl,
  normalizeSourceUsername,
} from '../src/net/urls.js';

describe('Telegram URL builders', () => {
  it('builds a channel page url without pagination', () => {
    assert.equal(channelPageUrl('montework'), 'https://t.me/s/montework');
    assert.equal(channelPageUrl('@monte_Job'), 'https://t.me/s/monte_Job');
  });

  it('adds the before cursor as a query parameter', () => {
    assert.equal(
      channelPageUrl('montework', { before: 1109995 }),
      'https://t.me/s/montework?before=1109995',
    );
    assert.equal(
      channelPageUrl('montework', { before: null }),
      'https://t.me/s/montework',
    );
    assert.equal(channelPageUrl('montework', {}), 'https://t.me/s/montework');
  });

  it('builds a group message embed url with the id interpolated', () => {
    assert.equal(
      messageEmbedUrl('montenegro_chat', 42),
      'https://t.me/montenegro_chat/42?embed=1',
    );
    assert.equal(
      messageEmbedUrl('@montenegro_chat', 1_234_567),
      'https://t.me/montenegro_chat/1234567?embed=1',
    );
  });

  it('trims whitespace and a leading @ from usernames', () => {
    assert.equal(normalizeSourceUsername('  @montework '), 'montework');
  });

  it('rejects usernames and ids that cannot be a Telegram path segment', () => {
    assert.throws(() => normalizeSourceUsername(''), RangeError);
    assert.throws(() => normalizeSourceUsername('a/b'), RangeError);
    assert.throws(() => normalizeSourceUsername('t.me/montework'), RangeError);
    assert.throws(() => channelPageUrl('montework', { before: 0 }), RangeError);
    assert.throws(() => channelPageUrl('montework', { before: -3 }), RangeError);
    assert.throws(() => messageEmbedUrl('montework', 1.5), RangeError);
    assert.throws(() => messageEmbedUrl('montework', Number.NaN), RangeError);
  });
});
