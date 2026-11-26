/**
 * Deterministic price extraction from listing text.
 *
 * The display value (`priceRaw`) is always the exact slice of the source text,
 * so a card can show «1 200 €/мес» or «от 500 €» without reconstructing it.
 * Numeric fields are filled only when the expression is unambiguous: exactly
 * one amount, one currency, and no range. Ranges and multi-price posts keep
 * `priceRaw` and leave `priceValue`, `priceCurrency`, `pricePeriod`, and
 * `priceKey` null.
 *
 * No currency marker means no price. A bare «500» is not confidently a price —
 * it may be square metres, a phone number, or a year — so it is ignored.
 */

export type PriceCurrency = 'eur' | 'usd' | 'rsd';

/**
 * Canonical period ids. `sqm` is a per-square-metre rate, common in rent ads.
 */
export type PricePeriod = 'month' | 'week' | 'day' | 'night' | 'hour' | 'year' | 'sqm';

export interface ParsedPrice {
  /** Exact display slice from the source, or null when no price expression was found. */
  raw: string | null;
  /** Numeric amount when unambiguous; null otherwise. */
  value: number | null;
  currency: PriceCurrency | null;
  period: PricePeriod | null;
  /**
   * Canonical cluster key, e.g. `eur:650` or `eur:650/month`, or null when the
   * price is absent or ambiguous. The clusterer treats null as "no price".
   */
  key: string | null;
}

const EMPTY_PRICE: ParsedPrice = {
  raw: null,
  value: null,
  currency: null,
  period: null,
  key: null,
};

const CURRENCY = String.raw`(?:€|\$|euro\b|eur\b|евро(?![а-яё])|евра(?![а-яё])|usd\b|доллар[а-яё]*(?![а-яё])|rsd\b|дин(?:ар[а-яё]*)?(?![а-яё]))`;
const AMOUNT = String.raw`\d{1,3}(?:[ \u00A0.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

/** Amount before currency (`650 €`) or currency before amount (`€ 650`). */
const PRICE_EXPRESSION = new RegExp(
  String.raw`(${AMOUNT})\s*${CURRENCY}|${CURRENCY}\s*(${AMOUNT})`,
  'giu',
);

const PERIOD_TAIL =
  /^\s*(?:\/\s*)?(?:(?:в|за)\s+|per\s+)?(месяц|мес|год|года|недел[юия]|сутки|сут|день|дня|ноч[ьи]|час|м2|м²|month|week|day|night|hour|year)(?![а-яё])/i;

const PERIOD_MAP: Readonly<Record<string, PricePeriod>> = {
  месяц: 'month',
  мес: 'month',
  month: 'month',
  год: 'year',
  года: 'year',
  year: 'year',
  неделю: 'week',
  неделя: 'week',
  недели: 'week',
  week: 'week',
  сутки: 'day',
  сут: 'day',
  день: 'day',
  дня: 'day',
  day: 'day',
  ночь: 'night',
  ночи: 'night',
  night: 'night',
  час: 'hour',
  hour: 'hour',
  м2: 'sqm',
  'м²': 'sqm',
};

interface PriceMatch {
  index: number;
  end: number;
  raw: string;
  amount: string;
  currency: PriceCurrency;
  period: PricePeriod | null;
}

function detectCurrency(expression: string): PriceCurrency | null {
  const lower = expression.toLowerCase();
  if (lower.includes('€') || lower.includes('eur') || lower.includes('евро') || lower.includes('евра')) {
    return 'eur';
  }
  if (lower.includes('$') || lower.includes('usd') || lower.includes('доллар')) return 'usd';
  if (lower.includes('rsd') || lower.includes('дин')) return 'rsd';
  return null;
}

/**
 * Parses the amount digits. European and US separators are both accepted:
 * a separator followed by exactly three digits is a thousands separator
 * (`1.200` → 1200, `1,200` → 1200), otherwise it is a decimal separator
 * (`650,50` → 650.5). One deliberate ambiguity: `0.500` is read as `0.5`,
 * because a leading zero is never a thousands group.
 */
export function parseAmount(raw: string): number | null {
  let value = raw.replace(/[\s\u00A0]/g, '').replace(/[.,]+$/, '');
  if (value === '') return null;

  const comma = value.includes(',');
  const dot = value.includes('.');
  if (comma && dot) {
    const last = Math.max(value.lastIndexOf(','), value.lastIndexOf('.'));
    value = `${value.slice(0, last).replace(/[.,]/g, '')}.${value.slice(last + 1)}`;
  } else if (comma || dot) {
    const separator = comma ? ',' : '.';
    const parts = value.split(separator);
    if (parts.length > 2) {
      value = parts.join('');
    } else {
      const [whole = '', fraction = ''] = parts;
      if (fraction.length === 3 && whole.length <= 3 && whole !== '0') {
        value = `${whole}${fraction}`;
      } else {
        value = `${whole}.${fraction}`;
      }
    }
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

/** `650` → `650`, `650.5` → `650.5`, `1e3` is never produced by the parser. */
function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '');
}

function periodAfter(text: string, end: number): { period: PricePeriod; length: number } | null {
  const tail = text.slice(end, end + 32);
  const match = PERIOD_TAIL.exec(tail);
  if (match === null) return null;
  const word = match[1];
  if (word === undefined) return null;
  const period = PERIOD_MAP[word.toLowerCase()];
  if (period === undefined) return null;
  return { period, length: match[0].length };
}

interface RangeHint {
  start: number;
  ambiguous: boolean;
}

/**
 * Detects a range that the matched expression alone does not show:
 * `500-700 €`, `от 500 до 700 €`, `500 € - 700 €`.
 */
function rangeAround(text: string, index: number, end: number): RangeHint | null {
  const before = text.slice(0, index);
  const dash = /(\d[\d\s.,]*)\s*[-–—]\s*$/.exec(before);
  if (dash !== null) return { start: index - dash[0].length, ambiguous: true };

  const to = /(?:от\s+)?(\d[\d\s.,]*)\s+до\s*$/.exec(before);
  if (to !== null) return { start: index - to[0].length, ambiguous: true };

  const afterDash = /^\s*(?:[-–—]|до\s+)/.exec(text.slice(end, end + 12));
  if (afterDash !== null) return { start: index, ambiguous: true };

  // A lone «от 500 €» is still one clear number; keep the «от» in the display
  // slice so the card reads «от 500 €».
  const from = /(?<![а-яё])от\s*$/i.exec(before);
  if (from !== null) return { start: index - from[0].length, ambiguous: false };

  return null;
}

function collectMatches(text: string): PriceMatch[] {
  const matches: PriceMatch[] = [];

  for (const match of text.matchAll(PRICE_EXPRESSION)) {
    const index = match.index;
    if (index === undefined) continue;
    const amount = match[1] ?? match[2];
    if (amount === undefined) continue;
    const currency = detectCurrency(match[0]);
    if (currency === null) continue;

    const end = index + match[0].length;
    const period = periodAfter(text, end);
    const rawEnd = period === null ? end : end + period.length;

    matches.push({
      index,
      end: rawEnd,
      raw: text.slice(index, rawEnd).trim(),
      amount,
      currency,
      period: period?.period ?? null,
    });
  }

  return matches;
}

/**
 * Parses the first price expression in the text and reports whether it is
 * unambiguous. Exported for tests and for callers that need only one value.
 */
export function parsePrice(text: string): ParsedPrice {
  const matches = collectMatches(text);
  const first = matches[0];
  if (first === undefined) return EMPTY_PRICE;

  if (matches.length > 1) {
    const last = matches[matches.length - 1];
    const raw = text.slice(first.index, last === undefined ? first.end : last.end).trim();
    return { raw, value: null, currency: null, period: null, key: null };
  }

  const range = rangeAround(text, first.index, first.end);
  const raw = range === null ? first.raw : text.slice(range.start, first.end).trim();

  if (range?.ambiguous === true) {
    return { raw, value: null, currency: null, period: null, key: null };
  }

  const value = parseAmount(first.amount);
  if (value === null) {
    return { raw, value: null, currency: first.currency, period: first.period, key: null };
  }

  const key = first.period === null
    ? `${first.currency}:${formatAmount(value)}`
    : `${first.currency}:${formatAmount(value)}/${first.period}`;

  return { raw, value, currency: first.currency, period: first.period, key };
}
