import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAmount, parsePrice, type ParsedPrice } from '../src/ingest/price.js';

interface PriceCase {
  text: string;
  value: number | null;
  currency: 'eur' | 'usd' | 'rsd' | null;
  period: string | null;
  key: string | null;
}

describe('parsePrice', () => {
  const cases: PriceCase[] = [
    { text: 'Продам квартиру, 650 €', value: 650, currency: 'eur', period: null, key: 'eur:650' },
    { text: 'Цена 650€', value: 650, currency: 'eur', period: null, key: 'eur:650' },
    { text: '€650', value: 650, currency: 'eur', period: null, key: 'eur:650' },
    { text: '1 200 €', value: 1200, currency: 'eur', period: null, key: 'eur:1200' },
    { text: '1.200€', value: 1200, currency: 'eur', period: null, key: 'eur:1200' },
    { text: '650,50 €', value: 650.5, currency: 'eur', period: null, key: 'eur:650.5' },
    { text: '650 EUR', value: 650, currency: 'eur', period: null, key: 'eur:650' },
    { text: '650 евро', value: 650, currency: 'eur', period: null, key: 'eur:650' },
    { text: '350 $', value: 350, currency: 'usd', period: null, key: 'usd:350' },
    { text: '$350', value: 350, currency: 'usd', period: null, key: 'usd:350' },
    { text: '350 USD', value: 350, currency: 'usd', period: null, key: 'usd:350' },
    { text: '500 RSD', value: 500, currency: 'rsd', period: null, key: 'rsd:500' },
    { text: '1.500 дин', value: 1500, currency: 'rsd', period: null, key: 'rsd:1500' },
    { text: '1 500 динара', value: 1500, currency: 'rsd', period: null, key: 'rsd:1500' },
    { text: '650 €/мес', value: 650, currency: 'eur', period: 'month', key: 'eur:650/month' },
    { text: '650€ в месяц', value: 650, currency: 'eur', period: 'month', key: 'eur:650/month' },
    { text: '50 € за ночь', value: 50, currency: 'eur', period: 'night', key: 'eur:50/night' },
    { text: '20 €/сутки', value: 20, currency: 'eur', period: 'day', key: 'eur:20/day' },
    { text: '800 € в год', value: 800, currency: 'eur', period: 'year', key: 'eur:800/year' },
    { text: '300 € за неделю', value: 300, currency: 'eur', period: 'week', key: 'eur:300/week' },
  ];

  for (const testCase of cases) {
    it(`parses ${JSON.stringify(testCase.text)}`, () => {
      const price = parsePrice(testCase.text);
      assert.equal(price.value, testCase.value);
      assert.equal(price.currency, testCase.currency);
      assert.equal(price.period, testCase.period);
      assert.equal(price.key, testCase.key);
      assert.ok(price.raw !== null && price.raw.length > 0);
      assert.ok(testCase.text.includes(price.raw), `raw ${JSON.stringify(price.raw)} is a source slice`);
    });
  }

  it('keeps price_raw but nulls the numeric fields for a range', () => {
    const price = parsePrice('Продам, 500-700 €, торг');
    assert.equal(price.value, null);
    assert.equal(price.currency, null);
    assert.equal(price.period, null);
    assert.equal(price.key, null);
    assert.equal(price.raw, '500-700 €');
  });

  it('keeps price_raw but nulls the numeric fields for «от … до …»', () => {
    const price = parsePrice('Цена от 500 до 700 €');
    assert.equal(price.value, null);
    assert.equal(price.key, null);
    assert.equal(price.raw, 'от 500 до 700 €');
  });

  it('keeps price_raw but nulls the numeric fields for several prices', () => {
    const price: ParsedPrice = parsePrice('Аренда 650 €/мес, депозит 300 €');
    assert.equal(price.value, null);
    assert.equal(price.key, null);
    assert.ok(price.raw?.includes('650 €/мес'));
    assert.ok(price.raw?.includes('300 €'));
  });

  it('ignores numbers without a currency', () => {
    assert.deepEqual(parsePrice('Продам за 500, торг'), {
      raw: null,
      value: null,
      currency: null,
      period: null,
      key: null,
    });
    assert.deepEqual(parsePrice('60 м2, 3 комнаты'), {
      raw: null,
      value: null,
      currency: null,
      period: null,
      key: null,
    });
  });

  it('treats a lone «от 500 €» as an unambiguous amount', () => {
    const price = parsePrice('Зарплата от 800 €');
    assert.equal(price.value, 800);
    assert.equal(price.key, 'eur:800');
  });
});

describe('parseAmount', () => {
  it('handles thousands and decimal separators', () => {
    assert.equal(parseAmount('1 200'), 1200);
    assert.equal(parseAmount('1.200'), 1200);
    assert.equal(parseAmount('1,200'), 1200);
    assert.equal(parseAmount('650,50'), 650.5);
    assert.equal(parseAmount('1.200,50'), 1200.5);
    assert.equal(parseAmount('0.500'), 0.5);
  });
});
