import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { composeDigest } from '../src/digest/message.js';
import type { UnsentMatch } from '../src/store/index.js';

let nextId = 1;

function match(overrides: Partial<UnsentMatch> = {}): UnsentMatch {
  const clusterId = overrides.clusterId ?? nextId++;
  return {
    clusterId,
    earliestPublishedAt: '2026-11-01T08:00:00.000Z',
    section: 'classifieds',
    category: 'other',
    demand: 'offer',
    title: `Объявление ${clusterId}`,
    city: null,
    priceRaw: null,
    salaryRaw: null,
    eventStartsAt: null,
    searchId: 1,
    searchName: 'Поиск',
    matchedAt: '2026-11-01T09:00:00.000Z',
    ...overrides,
  };
}

const BOT = 'telenta_bot';
const link = (id: number): string => `https://t.me/${BOT}?startapp=card_${id}`;

describe('composeDigest', () => {
  it('renders one search group with a linked title and the available details', () => {
    const card = match({
      clusterId: 12,
      title: 'Сдам квартиру',
      priceRaw: '650 €',
      city: 'Podgorica',
    });

    const digest = composeDigest({
      groups: [{ searchName: 'Квартира в Подгорице', matches: [card] }],
      botUsername: BOT,
    });

    assert.equal(
      digest.html,
      [
        'Новые совпадения по сохранённым поискам:',
        '',
        '<b>Квартира в Подгорице</b>',
        `<a href="${link(12)}">Сдам квартиру</a> — 650 €, Podgorica`,
      ].join('\n'),
    );
    assert.deepEqual(digest.clusterIds, [12]);
    assert.equal(digest.hasMore, false);
  });

  it('greets the user and strips an @ from the bot username', () => {
    const digest = composeDigest({
      userName: 'Валентин',
      groups: [{ searchName: 'Работа', matches: [match({ clusterId: 3, section: 'jobs', salaryRaw: '800 €' })] }],
      botUsername: '@telenta_bot',
    });

    assert.ok(digest.html.startsWith('Привет, <b>Валентин</b>! Новые совпадения'));
    assert.ok(digest.html.includes(`href="${link(3)}"`));
    assert.ok(digest.html.includes('— 800 €'));
  });

  it('keeps the passed group order and omits groups with no matches', () => {
    const first = match({ clusterId: 1, searchId: 11, searchName: 'Первый' });
    const second = match({ clusterId: 2, searchId: 22, searchName: 'Второй' });

    const digest = composeDigest({
      groups: [
        { searchName: 'Первый', matches: [first] },
        { searchName: 'Пустой', matches: [] },
        { searchName: 'Второй', matches: [second] },
      ],
      botUsername: BOT,
    });

    const firstIndex = digest.html.indexOf('<b>Первый</b>');
    const secondIndex = digest.html.indexOf('<b>Второй</b>');
    assert.ok(firstIndex >= 0 && secondIndex > firstIndex);
    assert.ok(!digest.html.includes('Пустой'));
    assert.deepEqual(digest.clusterIds, [1, 2]);
    assert.equal(digest.hasMore, false);
  });

  it('caps the whole message at ten cards and marks the group remainder', () => {
    const makeGroup = (searchId: number, name: string, count: number, start: number): {
      searchName: string;
      matches: UnsentMatch[];
    } => ({
      searchName: name,
      matches: Array.from({ length: count }, (_, index) =>
        match({ clusterId: start + index, searchId, searchName: name }),
      ),
    });

    const digest = composeDigest({
      groups: [makeGroup(1, 'Большой', 6, 100), makeGroup(2, 'Средний', 7, 200)],
      botUsername: BOT,
    });

    assert.equal(digest.clusterIds.length, 10);
    assert.deepEqual(digest.clusterIds, [100, 101, 102, 103, 104, 105, 200, 201, 202, 203]);
    assert.equal(digest.hasMore, true);
    // Three of the second group did not fit.
    assert.ok(digest.html.includes('и ещё 3'));
    assert.ok(!digest.html.includes('и ещё 7'));
  });

  it('reports the remainder of a group even when the limit cuts it before its end', () => {
    const digest = composeDigest({
      groups: [
        {
          searchName: 'A',
          matches: Array.from({ length: 10 }, (_, index) => match({ clusterId: 10 + index })),
        },
        {
          searchName: 'B',
          matches: [match({ clusterId: 50 }), match({ clusterId: 51 })],
        },
      ],
      botUsername: BOT,
    });

    assert.equal(digest.clusterIds.length, 10);
    assert.equal(digest.hasMore, true);
    assert.ok(digest.html.includes('и ещё 2'));
    assert.ok(!digest.html.includes('card_50'));
  });

  it('honours a custom limit', () => {
    const digest = composeDigest({
      groups: [
        {
          searchName: 'A',
          matches: [match({ clusterId: 1 }), match({ clusterId: 2 }), match({ clusterId: 3 })],
        },
      ],
      botUsername: BOT,
      limit: 2,
    });

    assert.deepEqual(digest.clusterIds, [1, 2]);
    assert.equal(digest.hasMore, true);
    assert.ok(digest.html.includes('и ещё 1'));
  });

  it('escapes every user-controlled string', () => {
    const digest = composeDigest({
      userName: 'Иван & <b>сын</b>',
      groups: [
        {
          searchName: 'Поиск "<script>" & ко',
          matches: [
            match({
              clusterId: 7,
              title: '<b>Скидка</b> & "кавычки" \'апостроф\'',
              priceRaw: '100 € <торг>',
              city: 'Nikšić & Co',
            }),
          ],
        },
      ],
      botUsername: BOT,
    });

    assert.ok(!digest.html.includes('<script>'));
    assert.ok(!digest.html.includes('<b>Скидка'));
    assert.ok(!digest.html.includes('<торг>'));
    assert.ok(digest.html.includes('&lt;b&gt;Скидка&lt;/b&gt; &amp; &quot;кавычки&quot; &#39;апостроф&#39;'));
    assert.ok(digest.html.includes('Поиск &quot;&lt;script&gt;&quot; &amp; ко'));
    assert.ok(digest.html.includes('Иван &amp; &lt;b&gt;сын&lt;/b&gt;'));
    assert.ok(digest.html.includes('100 € &lt;торг&gt;'));
    assert.ok(digest.html.includes('Nikšić &amp; Co'));
    // The URL carries only the numeric cluster id.
    assert.ok(digest.html.includes(`href="${link(7)}"`));
  });

  it('formats an event start in Podgorica and leaves absent slots out', () => {
    const digest = composeDigest({
      groups: [
        {
          searchName: 'Мероприятия',
          matches: [
            match({
              clusterId: 5,
              section: 'events',
              title: 'Концерт',
              eventStartsAt: '2026-12-05T18:00:00.000Z',
            }),
            match({ clusterId: 6, title: 'Без деталей' }),
          ],
        },
      ],
      botUsername: BOT,
    });

    assert.ok(digest.html.includes(`>Концерт</a> — 5 декабря, 19:00`));
    assert.ok(digest.html.endsWith(`<a href="${link(6)}">Без деталей</a>`));
    assert.ok(!digest.html.includes('undefined'));
  });

  it('returns an empty message when nothing matches', () => {
    const digest = composeDigest({
      groups: [
        { searchName: 'A', matches: [] },
        { searchName: 'B', matches: [] },
      ],
      botUsername: BOT,
    });

    assert.equal(digest.html, '');
    assert.deepEqual(digest.clusterIds, []);
    assert.equal(digest.hasMore, false);
  });
});
