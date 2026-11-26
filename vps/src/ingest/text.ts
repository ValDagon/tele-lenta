/**
 * Text normalization for clustering and search.
 *
 * There are deliberately two pipelines:
 *
 * - {@link normalizeText} produces the comparison form used by the cluster
 *   key. It keeps the script of the post (Cyrillic stays Cyrillic) because a
 *   cross-post is normally copied verbatim; transliterating here would merge
 *   unrelated posts that happen to share a rough Latin reading.
 * - {@link buildSearchText} / {@link normalizeSearchQuery} produce the
 *   substring-search form. Diacritics are folded and Cyrillic is transliterated
 *   with the Montenegrin Latin mapping, so «Подгорица» and «Podgorica» (and
 *   «Nikšić» and «Никшић») meet on the same string.
 *
 * Everything here is pure, deterministic, and never touches the network, the
 * database, or the filesystem.
 */

/** Longest title a card renders; counted in code points, never UTF-16 units. */
export const TITLE_MAX_LENGTH = 120;

/**
 * Normalization form used for clustering.
 *
 * Rules, in order:
 *
 * 1. Unicode NFC and lower case.
 * 2. `ё` folds to `е`, superscript digits `¹²³` fold to `1 2 3`.
 * 3. Every character that is not a Unicode letter or digit becomes a space:
 *    punctuation, emoji, symbols, variation selectors, and zero-width joiners
 *    all disappear. Hashtags therefore lose their `#` but keep the word.
 * 4. Runs of whitespace (including line breaks) collapse to one space and the
 *    ends are trimmed.
 *
 * The result is stable under formatting: case, quotes, dashes, bullet points,
 * emoji, and repeated whitespace all normalize to the same string.
 */
export function normalizeText(input: string): string {
  const nfc = input.normalize('NFC').toLowerCase();
  const folded = nfc
    .replace(/ё/g, 'е')
    .replace(/¹/g, '1')
    .replace(/²/g, '2')
    .replace(/³/g, '3');
  return folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Cyrillic → Latin map aligned with Montenegrin Latin, not with a linguistic
 * Russian transliteration. The point is that both scripts of the same name
 * produce the same search string: «Никшић» → `niksic` matches `Nikšić` →
 * `niksic`; «Подгорица» → `podgorica` matches `Podgorica` → `podgorica`.
 */
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'z', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', ш: 's', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'ju', я: 'ja',
  // Serbian Cyrillic letters that have a single Montenegrin Latin counterpart.
  ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz',
  // Other Cyrillic alphabets seen in the region.
  і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u',
};

/** Folds Latin diacritics to their base letters and `đ` to `dj`. */
function foldDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'dj');
}

/**
 * The shared search pipeline: lowercase, fold diacritics, transliterate
 * Cyrillic, then keep only Latin letters, digits, and single spaces.
 *
 * The same function runs over stored text and over a user query, so a query
 * never has to know which script the source used.
 */
export function normalizeSearch(input: string): string {
  const lowered = input.normalize('NFC').toLowerCase();
  const folded = foldDiacritics(lowered);
  let latin = '';
  for (const char of folded) {
    latin += CYRILLIC_TO_LATIN[char] ?? char;
  }
  return latin
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Query normalization for search. A thin, named alias of {@link normalizeSearch}
 * so endpoints and tests share one documented entry point; the server may then
 * reject a query whose normalized form is shorter than the minimum length.
 */
export function normalizeSearchQuery(query: string): string {
  return normalizeSearch(query);
}

/** Hashtags in source order, lowercased, without the leading `#`, deduplicated. */
export function extractHashtags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const match of input.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = match[1];
    if (tag === undefined) continue;
    const lowered = tag.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    tags.push(lowered);
  }
  return tags;
}

/**
 * Builds `listings.search_text`: title, normalized body, the display city, and
 * hashtags, all through the search pipeline. Hashtags are included explicitly
 * because a post may use `#Подгорица` where the body omits the city.
 */
export function buildSearchText(parts: {
  title?: string | null;
  textNormalized: string;
  city?: string | null;
  hashtags?: readonly string[];
}): string {
  const segments: string[] = [];
  if (parts.title !== null && parts.title !== undefined && parts.title !== '') {
    segments.push(parts.title);
  }
  segments.push(parts.textNormalized);
  if (parts.city !== null && parts.city !== undefined && parts.city !== '') {
    segments.push(parts.city);
  }
  if (parts.hashtags !== undefined) segments.push(...parts.hashtags);
  return normalizeSearch(segments.join(' '));
}

const LEADING_DECORATION =
  /^(?:\s|[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]|#[\p{L}\p{N}_]+|[-–—•·*:>|])+/u;

/** Removes leading emoji, hashtags, bullets, and whitespace from one line. */
function stripLeadingDecoration(line: string): string {
  return line.replace(LEADING_DECORATION, '').trim();
}

/**
 * Title: the first line that still has content after leading emoji, hashtags,
 * and bullet marks are removed. Capped at {@link TITLE_MAX_LENGTH} code points
 * so a cut never splits a surrogate pair; a lone surrogate cannot be produced.
 */
export function titleFromText(raw: string, maxLength: number = TITLE_MAX_LENGTH): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = stripLeadingDecoration(line);
    if (cleaned === '') continue;
    const codePoints = Array.from(cleaned);
    if (codePoints.length <= maxLength) return cleaned;
    return codePoints.slice(0, maxLength).join('').trimEnd();
  }
  return null;
}
