import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ParsedMessage } from '../src/parser/telegram-html.js';
import {
  classifyMessage,
  contentHash,
  type ClassificationSource,
  type ClassifyResult,
} from '../src/ingest/classify.js';

const FETCHED_AT = '2026-11-05T12:00:00.000Z';
const PUBLISHED_AT = '2026-11-05T10:00:00.000Z';

function message(text: string, overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    id: 100,
    text,
    datetime: PUBLISHED_AT,
    edited: false,
    photos: [],
    hasVideo: false,
    ...overrides,
  };
}

const CLASSIFIEDS: ClassificationSource = { sectionHint: 'classifieds' };

function classify(
  text: string,
  source: ClassificationSource = CLASSIFIEDS,
  overrides: Partial<ParsedMessage> = {},
): ClassifyResult {
  return classifyMessage(message(text, overrides), source, {
    sourceId: 7,
    url: 'https://t.me/example/100',
    fetchedAt: FETCHED_AT,
  });
}

function listingOf(result: ClassifyResult) {
  assert.equal(result.kind, 'listing', `expected a listing, got ${result.kind}`);
  if (result.kind !== 'listing') throw new Error('unreachable');
  return result;
}

describe('section', () => {
  it('comes from the source hint', () => {
    assert.equal(listingOf(classify('Продам диван', { sectionHint: 'jobs' })).listing.section, 'jobs');
    assert.equal(
      listingOf(classify('Продам диван', { sectionHint: 'classifieds' })).listing.section,
      'classifieds',
    );
  });

  it('keeps an events post in events only when it parses', () => {
    const event = listingOf(
      classify('Концерт 5 ноября в 19:00', { sectionHint: 'events' }),
    );
    assert.equal(event.listing.section, 'events');
    assert.equal(event.listing.eventStartsAt, '2026-11-05T18:00:00.000Z');
  });
});

describe('category', () => {
  const cases: Array<{ text: string; expected: string }> = [
    { text: 'Продам двухкомнатную квартиру в Подгорице', expected: 'real_estate' },
    { text: 'Сдам апартаменты у моря', expected: 'real_estate' },
    { text: 'Продам BMW 320d, 2015 год', expected: 'auto' },
    { text: 'Продам машину, пробег 120000', expected: 'auto' },
    { text: 'Продам диван и шкаф', expected: 'goods' },
    { text: 'Продам iPhone 15', expected: 'goods' },
    { text: 'Услуги электрика, ремонт проводки', expected: 'services' },
    { text: 'Репетитор по английскому', expected: 'services' },
    { text: 'Всякое разное, пишите в личку', expected: 'other' },
  ];

  for (const testCase of cases) {
    it(`classifies ${JSON.stringify(testCase.text)} as ${testCase.expected}`, () => {
      assert.equal(listingOf(classify(testCase.text)).listing.category, testCase.expected);
    });
  }

  it('falls back to the source category hint when no keyword matches', () => {
    const result = listingOf(
      classify('Всякое разное, пишите в личку', {
        sectionHint: 'classifieds',
        categoryHint: 'goods',
      }),
    );
    assert.equal(result.listing.category, 'goods');
  });

  it('lets keywords beat the source category hint', () => {
    const result = listingOf(
      classify('Продам квартиру', {
        sectionHint: 'classifieds',
        categoryHint: 'goods',
      }),
    );
    assert.equal(result.listing.category, 'real_estate');
  });

  it('uses other for non-classifieds posts without a hint', () => {
    const result = listingOf(
      classify('Продам квартиру', { sectionHint: 'jobs', categoryHint: null }),
    );
    assert.equal(result.listing.category, 'other');
  });
});

describe('demand', () => {
  const cases: Array<{ text: string; expected: 'offer' | 'wanted' }> = [
    { text: 'Куплю квартиру в Подгорице', expected: 'wanted' },
    { text: 'Ищу работу в отеле', expected: 'wanted' },
    { text: 'Сниму комнату на месяц', expected: 'wanted' },
    { text: '#резюме Официант, опыт 3 года', expected: 'wanted' },
    { text: 'Ищем сотрудника на ресепшн', expected: 'wanted' },
    { text: 'Продам квартиру', expected: 'offer' },
    { text: 'Сдам офис', expected: 'offer' },
  ];

  for (const testCase of cases) {
    it(`marks ${JSON.stringify(testCase.text)} as ${testCase.expected}`, () => {
      assert.equal(listingOf(classify(testCase.text)).listing.demand, testCase.expected);
    });
  }
});

describe('derived listing fields', () => {
  it('builds title, city, price, search text, and facets together', () => {
    const { listing, facets } = listingOf(
      classify('🔥 #срочно Продам квартиру\n650 €/мес\nПодгорица, центр'),
    );

    assert.equal(listing.title, 'Продам квартиру');
    assert.equal(listing.city, 'Podgorica');
    assert.equal(listing.priceRaw, '650 €/мес');
    assert.equal(listing.priceValue, 650);
    assert.equal(listing.priceCurrency, 'eur');
    assert.equal(listing.pricePeriod, 'month');
    assert.equal(listing.priceRaw, '650 €/мес');
    assert.equal(listing.salaryRaw, null);
    assert.equal(listing.parserVersion, '2026-11-05.1');
    assert.equal(listing.messageStatus, 'available');

    assert.equal(facets.cityKey, 'podgorica');
    assert.equal(facets.priceKey, 'eur:650/month');
    const searchText = listing.searchText ?? '';
    assert.ok(searchText.includes('podgorica'));
    assert.ok(searchText.includes('prodam'));
    assert.equal(searchText, searchText.toLowerCase());
  });

  it('keeps price raw but null value when the price is ambiguous', () => {
    const { listing, facets } = listingOf(classify('Продам, 500-700 €'));
    assert.equal(listing.priceRaw, '500-700 €');
    assert.equal(listing.priceValue, null);
    assert.equal(facets.priceKey, null);
  });

  it('treats a jobs price expression as salary_raw', () => {
    const { listing } = listingOf(
      classify('Официант, зарплата от 800 €', { sectionHint: 'jobs' }),
    );
    assert.equal(listing.priceRaw, 'от 800 €');
    assert.equal(listing.salaryRaw, 'от 800 €');
  });

  it('keeps photo input and records media presence', () => {
    const { listing } = listingOf(
      classify('Продам диван', CLASSIFIEDS, {
        photos: ['https://cdn4.telesco.pe/file/a.jpg', 'https://cdn4.telesco.pe/file/b.jpg'],
      }),
    );
    assert.equal(listing.hasPhotos, true);
    assert.equal(listing.photos?.length, 2);
    assert.equal(listing.hasVideo, false);
  });

  it('keeps an image-only post as a listing with no title', () => {
    const { listing } = listingOf(
      classify('', CLASSIFIEDS, { photos: ['https://cdn4.telesco.pe/file/a.jpg'] }),
    );
    assert.equal(listing.title, null);
    assert.equal(listing.textNormalized, '');
    assert.equal(listing.hasPhotos, true);
  });
});

describe('drops and event failures', () => {
  it('drops a message with no text and no media', () => {
    const result = classifyMessage(message(''), CLASSIFIEDS, {
      sourceId: 7,
      url: 'https://t.me/example/100',
      fetchedAt: FETCHED_AT,
    });
    assert.deepEqual(result, { kind: 'dropped', messageId: 100, reason: 'empty' });
  });

  it('returns an explicit event failure instead of downgrading it', () => {
    const result = classify('Анонс без даты', { sectionHint: 'events' }, { id: 321 });
    assert.equal(result.kind, 'event_unparseable');
    if (result.kind !== 'event_unparseable') throw new Error('unreachable');
    assert.equal(result.messageId, 321);
    assert.equal(result.url, 'https://t.me/example/100');
    assert.match(result.error, /date/i);
  });

  it('fails an event post whose time is missing', () => {
    const result = classify('Концерт 5 ноября', { sectionHint: 'events' });
    assert.equal(result.kind, 'event_unparseable');
    if (result.kind !== 'event_unparseable') throw new Error('unreachable');
    assert.match(result.error, /time/i);
  });
});

describe('spam and ads', () => {
  it('marks a link-only post as spam', () => {
    const { listing } = listingOf(classify('https://t.me/example'));
    assert.equal(listing.isSpam, true);
    assert.equal(listing.isAd, false);
  });

  it('does not mark short text as spam', () => {
    const { listing } = listingOf(classify('Продам'));
    assert.equal(listing.isSpam, false);
    assert.equal(listing.isAd, false);
  });

  it('marks every post from a spam source', () => {
    const { listing } = listingOf(
      classify('Продам диван', { sectionHint: 'classifieds', isSpamSource: true }),
    );
    assert.equal(listing.isSpam, true);
  });

  it('marks a configured spam marker', () => {
    const { listing } = listingOf(classify('Казино, лучшие ставки, пишите'));
    assert.equal(listing.isSpam, true);
  });

  it('marks explicit ad markers and invite links', () => {
    assert.equal(listingOf(classify('Реклама: скидка 20%')).listing.isAd, true);
    assert.equal(
      listingOf(classify('Наш канал, подписывайся: https://t.me/+abc123')).listing.isAd,
      true,
    );
  });

  it('allows caller-supplied marker lists', () => {
    const result = classifyMessage(message('Особый маркер'), CLASSIFIEDS, {
      sourceId: 7,
      url: 'https://t.me/example/100',
      fetchedAt: FETCHED_AT,
      spamRules: { spamMarkers: ['особый маркер'], adMarkers: [] },
    });
    assert.equal(result.kind, 'listing');
    if (result.kind !== 'listing') throw new Error('unreachable');
    assert.equal(result.listing.isSpam, true);
    assert.equal(result.listing.isAd, false);
  });
});

describe('determinism and immutability', () => {
  it('returns the same result for the same input', () => {
    const input = message('Продам квартиру, 650 €, Подгорица');
    Object.freeze(input);
    Object.freeze(input.photos);

    const first = classifyMessage(input, CLASSIFIEDS, {
      sourceId: 7,
      url: 'https://t.me/example/100',
      fetchedAt: FETCHED_AT,
    });
    const second = classifyMessage(input, CLASSIFIEDS, {
      sourceId: 7,
      url: 'https://t.me/example/100',
      fetchedAt: FETCHED_AT,
    });

    assert.deepEqual(first, second);
  });

  it('hashes text, photos, and video but nothing else', () => {
    const base = contentHash({ text: 'Продам диван', photos: ['a.jpg'], hasVideo: false });
    assert.equal(base, contentHash({ text: 'Продам диван', photos: ['a.jpg'], hasVideo: false }));
    assert.notEqual(base, contentHash({ text: 'Продам стол', photos: ['a.jpg'], hasVideo: false }));
    assert.notEqual(base, contentHash({ text: 'Продам диван', photos: ['b.jpg'], hasVideo: false }));
    assert.notEqual(base, contentHash({ text: 'Продам диван', photos: ['a.jpg'], hasVideo: true }));
  });
});
