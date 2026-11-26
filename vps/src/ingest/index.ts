/**
 * Ingestion seam: normalization, classification, and album collapse. Pure
 * modules only — no database, network, or filesystem. The tick in session C
 * calls `collapseAlbums` per source and `classifyMessage` per surviving
 * message, then writes the result through the store.
 */

export {
  ALBUM_WINDOW_MS,
  collapseAlbums,
  type AlbumGroup,
  type AlbumOptions,
} from './albums.js';
export {
  classifyMessage,
  contentHash,
  PARSER_VERSION,
  type ClassifiedListing,
  type ClassificationSource,
  type ClassifyOptions,
  type ClassifyResult,
  type DropReason,
  type ListingFacets,
} from './classify.js';
export { knownCities, matchCity, type CityMatch } from './city.js';
export {
  EVENT_YEAR_ROLL_DAYS,
  parseEventStart,
  type EventParseResult,
} from './events.js';
export {
  CATEGORIES,
  DEMANDS,
  OTHER_CATEGORY,
  classifyCategory,
  detectDemand,
  resolveSection,
  type Category,
  type Demand,
} from './facets.js';
export {
  parseAmount,
  parsePrice,
  type ParsedPrice,
  type PriceCurrency,
  type PricePeriod,
} from './price.js';
export {
  DEFAULT_SPAM_RULES,
  detectSpam,
  isLinkOnly,
  mergeSpamRules,
  type SpamInput,
  type SpamRules,
  type SpamVerdict,
} from './spam.js';
export {
  buildSearchText,
  extractHashtags,
  normalizeSearch,
  normalizeSearchQuery,
  normalizeText,
  TITLE_MAX_LENGTH,
  titleFromText,
} from './text.js';
