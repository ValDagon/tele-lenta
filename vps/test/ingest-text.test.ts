import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSearchText,
  extractHashtags,
  normalizeSearch,
  normalizeSearchQuery,
  normalizeText,
  TITLE_MAX_LENGTH,
  titleFromText,
} from '../src/ingest/text.js';

describe('normalizeText', () => {
  it('collapses formatting, case, punctuation, emoji, and whitespace variants', () => {
    const variants = [
      'Продам двухкомнатную квартиру в Подгорице, 60 м², центр',
      '  ПРОДАМ   двухкомнатную КВАРТИРУ в Подгорице!!! 60 м2, центр  ',
      '🔥 Продам двухкомнатную квартиру в Подгорице — 60 м2 — центр 🔥',
      '«Продам двухкомнатную квартиру в Подгорице» (60 м²), центр.',
      'Продам\nдвухкомнатную квартиру\tв Подгорице\n60 м² центр',
    ];

    const normalized = variants.map(normalizeText);
    for (const value of normalized) assert.equal(value, normalized[0]);
  });

  it('folds ё and superscript digits', () => {
    assert.equal(normalizeText('лёгкие деньги'), normalizeText('легкие деньги'));
    assert.equal(normalizeText('60 м²'), normalizeText('60 м2'));
  });

  it('normalizes composed and decomposed Unicode to the same string', () => {
    assert.equal(normalizeText('и\u0306'), normalizeText('й'));
  });

  it('keeps genuinely different offers different', () => {
    assert.notEqual(normalizeText('Продам квартиру'), normalizeText('Сдам квартиру'));
    assert.notEqual(
      normalizeText('Продам квартиру в Подгорице'),
      normalizeText('Продам квартиру в Будве'),
    );
  });
});

describe('search pipeline', () => {
  it('matches Cyrillic and Latin spellings of the same city', () => {
    const fromCyrillic = normalizeSearchQuery('Подгорица');
    const fromLatin = normalizeSearchQuery('Podgorica');
    assert.equal(fromCyrillic, 'podgorica');
    assert.equal(fromLatin, 'podgorica');

    const stored = buildSearchText({
      title: null,
      textNormalized: normalizeText('Сдам квартиру, центр'),
      city: 'Podgorica',
    });
    assert.ok(stored.includes(fromCyrillic));
    assert.ok(stored.includes(fromLatin));
  });

  it('folds diacritics and aligns Serbian Cyrillic with Montenegrin Latin', () => {
    assert.equal(normalizeSearch('Nikšić'), 'niksic');
    assert.equal(normalizeSearch('Никшић'), 'niksic');
    assert.equal(normalizeSearch('Bečići'), 'becici');
    assert.equal(normalizeSearch('Бечићи'), 'becici');
    assert.equal(normalizeSearch('Žabljak'), 'zabljak');
    assert.equal(normalizeSearch('Жабљак'), 'zabljak');
    assert.equal(normalizeSearch('Cetinje'), 'cetinje');
    assert.equal(normalizeSearch('Цетиње'), 'cetinje');
  });

  it('builds search text from title, body, city, and hashtags', () => {
    const text = buildSearchText({
      title: 'Продам квартиру',
      textNormalized: normalizeText('Срочно, торг'),
      city: 'Будва',
      hashtags: ['недвижимость'],
    });

    assert.ok(text.includes('prodam kvartiru'));
    assert.ok(text.includes('budva'));
    assert.ok(text.includes('nedvizimost'));
    assert.equal(text.toLowerCase(), text);
  });

  it('ignores punctuation and emoji in queries', () => {
    assert.equal(normalizeSearchQuery('  #Подгорица?! 🔥 '), 'podgorica');
  });
});

describe('titleFromText', () => {
  it('strips leading emoji, hashtags, bullets, and whitespace', () => {
    assert.equal(titleFromText('🔥 #срочно #продам Продам квартиру'), 'Продам квартиру');
    assert.equal(titleFromText('— • Продам гараж'), 'Продам гараж');
    assert.equal(titleFromText('#толькотег\nСдам комнату'), 'Сдам комнату');
  });

  it('caps at 120 code points without splitting a surrogate pair', () => {
    const title = titleFromText(`Продам ${'😀'.repeat(200)}`);
    assert.ok(title !== null);
    assert.equal(Array.from(title).length, TITLE_MAX_LENGTH);
    for (const char of title) {
      const code = char.codePointAt(0);
      assert.ok(code !== undefined);
      assert.ok(code < 0xd800 || code > 0xdfff, 'no lone surrogate');
    }
  });

  it('returns null for empty or decoration-only text', () => {
    assert.equal(titleFromText(''), null);
    assert.equal(titleFromText('   \n  '), null);
    assert.equal(titleFromText('🔥🔥 #тег'), null);
  });
});

describe('extractHashtags', () => {
  it('returns lowercased tags without # and without duplicates', () => {
    assert.deepEqual(extractHashtags('#ВАКАНСИИ #Резюме работа #вакансии'), [
      'вакансии',
      'резюме',
    ]);
  });
});
