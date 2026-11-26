/**
 * Montenegrin city dictionary for deterministic city extraction.
 *
 * The text is matched after the search pipeline (diacritics folded, Cyrillic
 * transliterated), so every alias is stored in that normalized form: «Бар» and
 * `Bar` both arrive as `bar`. Aliases include common inflected stems
 * (`podgoric` covers Подгорица / Подгорице / Подгорицу and
 * Podgorica / Podgorici / Podgoricu).
 *
 * Matching is token-based. An alias of four or more characters may match a
 * token prefix, so declension works without listing every form. Short aliases
 * (`bar`, `plav`, `tuzi`) must match a whole token, otherwise `bar` would fire
 * inside `baraholka`. The earliest match in the text wins; ties go to the
 * longest alias, which is why `Herceg Novi` beats `Bar` in a text that starts
 * with `Stari Bar`.
 *
 * The display form is a fixed Latin-with-diacritics name, not the source's own
 * spelling: cards and search should not change spelling with the cross-post.
 * `cityKey` is already in the search-normalized form and feeds the clusterer.
 */

import { normalizeSearch } from './text.js';

export interface CityMatch {
  /** Fixed display spelling, e.g. `Podgorica`, `Nikšić`, `Herceg Novi`. */
  display: string;
  /** Cluster/search key, e.g. `podgorica`, `niksic`, `herceg-novi`. */
  key: string;
}

interface CityDefinition {
  display: string;
  key: string;
  /** Aliases in normalized search form. */
  aliases: readonly string[];
}

/** An alias shorter than this only matches a whole token. */
const PREFIX_MIN_LENGTH = 4;

/**
 * Short or ambiguous aliases that must match a whole token even though they
 * reach {@link PREFIX_MIN_LENGTH}: `plav` must not fire inside «плавающий»,
 * `tuzi` inside «тужилаштво», and `bar` inside a brand or a chat name.
 */
const EXACT_ALIASES = new Set([
  'bar', 'bara', 'bare', 'baru', 'barom', 'бар', 'бара', 'баре', 'бару', 'баром',
  'plav', 'plava', 'plavu', 'плав', 'плава', 'плаву',
  'tuzi', 'tuzima', 'тузи', 'тузима',
]);

const CITY_DEFINITIONS: readonly CityDefinition[] = [
  { display: 'Podgorica', key: 'podgorica', aliases: ['podgoric', 'подгориц'] },
  { display: 'Nikšić', key: 'niksic', aliases: ['niksic', 'никшић', 'никшиц'] },
  {
    display: 'Herceg Novi',
    key: 'herceg-novi',
    aliases: [
      'herceg novi', 'herceg novom', 'herceg novog', 'herceg novim', 'hercegnovi',
      'херцег нови', 'херцег новом', 'херцег новог', 'херцегнов',
    ],
  },
  {
    display: 'Bar',
    key: 'bar',
    aliases: ['bar', 'bara', 'bare', 'baru', 'barom', 'бар', 'бара', 'баре', 'бару', 'баром'],
  },
  { display: 'Budva', key: 'budva', aliases: ['budv', 'будв'] },
  { display: 'Kotor', key: 'kotor', aliases: ['kotor', 'котор'] },
  { display: 'Tivat', key: 'tivat', aliases: ['tivat', 'tivt', 'тиват', 'тивт'] },
  { display: 'Ulcinj', key: 'ulcinj', aliases: ['ulcinj', 'улцињ'] },
  { display: 'Cetinje', key: 'cetinje', aliases: ['cetinj', 'цетињ'] },
  { display: 'Bijelo Polje', key: 'bijelo-polje', aliases: ['bijelo polj', 'бијело пољ'] },
  { display: 'Berane', key: 'berane', aliases: ['beran', 'беран'] },
  { display: 'Pljevlja', key: 'pljevlja', aliases: ['pljevlj', 'пљевљ'] },
  { display: 'Danilovgrad', key: 'danilovgrad', aliases: ['danilovgrad', 'даниловград'] },
  { display: 'Rožaje', key: 'rozaje', aliases: ['rozaj', 'рожај'] },
  { display: 'Žabljak', key: 'zabljak', aliases: ['zabljak', 'жабљак'] },
  { display: 'Plužine', key: 'pluzine', aliases: ['pluzin', 'плужин'] },
  { display: 'Mojkovac', key: 'mojkovac', aliases: ['mojkov', 'мојков'] },
  { display: 'Kolašin', key: 'kolasin', aliases: ['kolasin', 'колашин'] },
  { display: 'Andrijevica', key: 'andrijevica', aliases: ['andrijevic', 'андријевиц'] },
  { display: 'Petnjica', key: 'petnjica', aliases: ['petnjic', 'петњиц'] },
  { display: 'Gusinje', key: 'gusinje', aliases: ['gusinj', 'гусињ'] },
  { display: 'Plav', key: 'plav', aliases: ['plav', 'plavu', 'plava', 'плав', 'плаву', 'плава'] },
  { display: 'Tuzi', key: 'tuzi', aliases: ['tuzi', 'tuzima', 'тузи', 'тузима'] },
  { display: 'Sutomore', key: 'sutomore', aliases: ['sutomor', 'сутомор'] },
  { display: 'Petrovac', key: 'petrovac', aliases: ['petrovac', 'petrovc', 'петровац'] },
  { display: 'Igalo', key: 'igalo', aliases: ['igal', 'игал'] },
  { display: 'Bečići', key: 'becici', aliases: ['becic', 'бечић'] },
  { display: 'Šavnik', key: 'savnik', aliases: ['savnik', 'шавник'] },
];

interface CompiledAlias {
  words: readonly string[];
  prefixLast: boolean;
  city: CityDefinition;
  length: number;
}

/** Aliases normalized once at module load; pure data, no I/O. */
const COMPILED: readonly CompiledAlias[] = CITY_DEFINITIONS.flatMap((city) =>
  city.aliases.map((alias) => {
    const words = normalizeSearch(alias).split(' ').filter((word) => word !== '');
    const normalized = words.join(' ');
    return {
      words,
      prefixLast:
        (words[words.length - 1]?.length ?? 0) >= PREFIX_MIN_LENGTH &&
        !EXACT_ALIASES.has(normalized),
      city,
      length: normalized.length,
    };
  }),
).sort((a, b) => b.length - a.length);

function aliasMatches(alias: CompiledAlias, tokens: readonly string[], start: number): boolean {
  if (alias.words.length === 0) return false;
  if (start + alias.words.length > tokens.length) return false;

  for (let offset = 0; offset < alias.words.length; offset += 1) {
    const expected = alias.words[offset];
    const actual = tokens[start + offset];
    if (expected === undefined || actual === undefined) return false;

    const isLast = offset === alias.words.length - 1;
    if (isLast && alias.prefixLast) {
      if (!actual.startsWith(expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }

  return true;
}

/**
 * Finds the first city mentioned in the text, or null when none of the known
 * Montenegrin names appears. The search runs over the source text, not over a
 * title, so a city inside a longer body is still found.
 */
export function matchCity(text: string): CityMatch | null {
  const tokens = normalizeSearch(text).split(' ').filter((token) => token !== '');
  if (tokens.length === 0) return null;

  for (let index = 0; index < tokens.length; index += 1) {
    for (const alias of COMPILED) {
      if (!aliasMatches(alias, tokens, index)) continue;
      return { display: alias.city.display, key: alias.city.key };
    }
  }

  return null;
}

/** The dictionary as data; useful for tests and for the future filter sheet. */
export function knownCities(): readonly CityMatch[] {
  return CITY_DEFINITIONS.map(({ display, key }) => ({ display, key }));
}
