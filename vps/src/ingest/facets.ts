/**
 * Section, category, and demand rules. All input is `normalizeText` output, so
 * the keyword tables are stored in that same form (lower case, punctuation
 * removed, `ё` folded to `е`).
 *
 * Section comes from the source hint and is not re-guessed from the text: a
 * post in an events source is an event, a post in a jobs source is a vacancy.
 * Category is deliberately conservative — a handful of strong keyword rules,
 * the source's category hint only as a fallback, and `other` otherwise.
 * Demand is a small closed list; anything without a «куплю/ищу/сниму/резюме»
 * marker is an offer.
 */

import type { Section } from '../store/types.js';

/** Category ids used by the filter sheet and the `listings.category` column. */
export const CATEGORIES = ['real_estate', 'auto', 'goods', 'services', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Stable canonical id for the «Другое» fallback. */
export const OTHER_CATEGORY: Category = 'other';

export type Demand = 'offer' | 'wanted';

export const DEMANDS: readonly Demand[] = ['offer', 'wanted'];

interface CategoryRule {
  category: Category;
  /** Token prefixes, length four or more, covering inflection. */
  prefixes: readonly string[];
  /** Whole tokens for short or ambiguous words. */
  words: readonly string[];
}

/**
 * Rule order is priority order: the first category with any hit wins. Real
 * estate and cars are the least ambiguous, so they lead. Services precede goods
 * because a service post usually names its object («ремонт стиральных машин»),
 * while a goods post rarely names a service.
 */
const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: 'real_estate',
    prefixes: [
      'квартир', 'апартамент', 'студи', 'комнат', 'недвижим', 'вилл', 'коттедж',
      'пентхаус', 'гараж', 'парков', 'паркинг', 'участк', 'офис', 'магазин',
      'склад', 'apartman', 'nekretnin', 'garsonjer', 'zemljist', 'parkiralist',
      'poslovn', 'kancelarij',
    ],
    words: [
      'дом', 'дома', 'доме', 'домом', 'дому', 'жилье', 'жилья', 'жилью',
      'жильем', 'дача', 'дачи', 'дачу', 'дача', 'земля', 'земли', 'землю',
      'stan', 'stana', 'stanu', 'kuca', 'kuce', 'kuci', 'soba', 'sobe', 'sobu',
      'plac', 'placa',
    ],
  },
  {
    category: 'auto',
    prefixes: [
      'автомобил', 'машин', 'мотоцикл', 'скутер', 'мопед', 'велосипед',
      'прицеп', 'фургон', 'грузовик', 'джип', 'внедорожник', 'bmw', 'audi',
      'mercedes', 'volkswagen', 'toyota', 'renault', 'opel', 'ford', 'nissan',
      'hyundai', 'skoda', 'mazda', 'mitsubishi', 'honda', 'peugeot', 'citroen',
      'fiat', 'golf', 'passat', 'vozil', 'automobil', 'motocikl', 'bicikl',
      'kamion', 'kombi',
    ],
    words: ['авто', 'машина', 'машины', 'машину', 'машиной', 'машине', 'car', 'cars'],
  },
  {
    category: 'services',
    prefixes: [
      'услуг', 'ремонт', 'мастер', 'уборк', 'клининг', 'электрик', 'сантехник',
      'репетитор', 'массаж', 'маникюр', 'педикюр', 'стрижк', 'парикмахер',
      'грузоперевоз', 'переезд', 'перевод', 'юрист', 'бухгалтер', 'фотограф',
      'дизайн', 'разработк', 'программист', 'настройк', 'установк', 'сборк',
      'монтаж', 'доставк', 'такси', 'santehnik', 'majstor', 'ciscenj', 'prevoz',
      'tutor', 'frizer', 'masaz', 'manikir', 'programer', 'dizajn', 'popravk',
      'montaz', 'dostav', 'selidb',
    ],
    words: ['услуга', 'услуги', 'usluga', 'usluge'],
  },
  {
    category: 'goods',
    prefixes: [
      'мебел', 'диван', 'кресл', 'стул', 'шкаф', 'кроват', 'матрас',
      'холодильник', 'стиральн', 'телевизор', 'телефон', 'айфон', 'iphone',
      'samsung', 'xiaomi', 'ноутбук', 'компьютер', 'монитор', 'принтер',
      'наушник', 'колонк', 'планшет', 'игров', 'приставк', 'пылесос',
      'микроволнов', 'посуд', 'одежд', 'обув', 'куртк', 'плать', 'игрушк',
      'инструмент', 'дрель', 'перфоратор', 'самокат', 'коляск', 'namestaj',
      'telefon', 'laptop', 'racunar', 'televizor', 'frizider', 'odec', 'obuc',
      'igrack', 'alat',
    ],
    words: [
      'вещи', 'вещей', 'вещь', 'товар', 'товары', 'мебель', 'техника',
      'бытовая', 'roba', 'stvari', 'ves masina',
    ],
  },
];

/** Negative words that keep a bare «стол» from matching a table listing. */
function tokensOf(textNormalized: string): string[] {
  return textNormalized.split(' ').filter((token) => token !== '');
}

function hasAnyHit(tokens: readonly string[], rule: CategoryRule): boolean {
  for (const token of tokens) {
    for (const prefix of rule.prefixes) {
      if (token.startsWith(prefix)) return true;
    }
    for (const word of rule.words) {
      if (token === word) return true;
    }
  }
  return false;
}

/** Section is the source's hint; no text rule is allowed to override it. */
export function resolveSection(hint: Section): Section {
  return hint;
}

function isValidCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Conservative category derivation. Keywords win over the hint so a car posted
 * in a goods chat still lands under Авто; the hint fills only the no-signal
 * fallback, and `other` is the final fallback.
 */
export function classifyCategory(
  textNormalized: string,
  hint?: string | null,
  section: Section = 'classifieds',
): Category {
  if (section !== 'classifieds') {
    if (hint !== null && hint !== undefined && isValidCategory(hint)) return hint;
    return OTHER_CATEGORY;
  }

  const tokens = tokensOf(textNormalized);
  for (const rule of CATEGORY_RULES) {
    if (hasAnyHit(tokens, rule)) return rule.category;
  }

  if (hint !== null && hint !== undefined && isValidCategory(hint)) return hint;
  return OTHER_CATEGORY;
}

const WANTED_WORDS = new Set([
  'куплю', 'купим', 'сниму', 'снимем', 'снимаю', 'ищу', 'ищем', 'ищет',
  'ищут', 'резюме',
]);

/**
 * `wanted` for the spec's markers: куплю, ищу, сниму, ищу работу, резюме, and
 * `#резюме` (normalization drops the `#`, so the word remains). Everything else
 * is an offer.
 */
export function detectDemand(textNormalized: string): Demand {
  for (const token of tokensOf(textNormalized)) {
    if (WANTED_WORDS.has(token)) return 'wanted';
    if (token.startsWith('ищ')) return 'wanted';
  }
  return 'offer';
}
