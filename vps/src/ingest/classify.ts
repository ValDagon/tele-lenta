/**
 * The classification seam: one parsed Telegram message plus its source context
 * becomes either a `NewListing` for the store, a dropped message, or an
 * explicit event-parser failure for `parser_failures`.
 *
 * Pure and deterministic. No database, no network, no filesystem, no clock of
 * its own: `fetchedAt` comes from the caller so a test can pin it.
 *
 * Section comes from the source hint. For an events source the post must parse
 * a start date and time; when it does not, the result is `event_unparseable`
 * and the tick records it instead of silently filing the post as classifieds.
 * Service messages are dropped by the parser before they reach this layer; the
 * only thing dropped here is a message with no text and no media at all.
 */

import { createHash } from 'node:crypto';

import type { ParsedMessage } from '../parser/telegram-html.js';
import type { NewListing, Section } from '../store/types.js';

import { matchCity } from './city.js';
import { parseEventStart } from './events.js';
import {
  classifyCategory,
  detectDemand,
  resolveSection,
  type Category,
  type Demand,
} from './facets.js';
import { parsePrice, type PriceCurrency, type PricePeriod } from './price.js';
import { detectSpam, mergeSpamRules, type SpamRules } from './spam.js';
import { buildSearchText, extractHashtags, normalizeText, titleFromText } from './text.js';

/**
 * Bumped whenever normalization, classification, or the content hash changes
 * shape. Stored on every listing so a backfill can re-derive rows predictably.
 */
export const PARSER_VERSION = '2026-11-05.1';

/** What the source row contributes to classification. */
export interface ClassificationSource {
  sectionHint: Section;
  categoryHint?: string | null;
  isSpamSource?: boolean;
}

export interface ClassifyOptions {
  sourceId: number;
  /** Full public URL of this message. */
  url: string;
  /** Observation time, ISO 8601 UTC. */
  fetchedAt: string;
  /** Spam/ad markers; defaults are used when omitted. */
  spamRules?: Partial<SpamRules>;
}

/** Derived fields the clusterer consumes, plus the facet values the store stores. */
export interface ListingFacets {
  textNormalized: string;
  priceKey: string | null;
  cityKey: string | null;
  section: Section;
  category: Category;
  demand: Demand;
}

export interface ClassifiedListing {
  listing: NewListing;
  facets: ListingFacets;
}

export type DropReason = 'empty';

export type ClassifyResult =
  | ({ kind: 'listing' } & ClassifiedListing)
  | { kind: 'dropped'; messageId: number; reason: DropReason }
  | { kind: 'event_unparseable'; messageId: number; url: string; error: string };

/**
 * Content hash for edit detection: raw text, the ordered photo list, and video
 * presence. Any of them changing means the message was edited and the cluster
 * assignment is recomputed. Display formatting is irrelevant; source text is not.
 */
export function contentHash(input: {
  text: string;
  photos: readonly string[];
  hasVideo: boolean;
}): string {
  const canonical = JSON.stringify([input.text, input.photos, input.hasVideo]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Classifies one message. The caller passes an album-collapsed message (the
 * surviving id with the merged photo set), so this function never has to know
 * about albums; calling it twice with the same input yields the same result.
 */
export function classifyMessage(
  message: ParsedMessage,
  source: ClassificationSource,
  options: ClassifyOptions,
): ClassifyResult {
  const hasMedia = message.photos.length > 0 || message.hasVideo;
  if (message.text.trim() === '' && !hasMedia) {
    return { kind: 'dropped', messageId: message.id, reason: 'empty' };
  }

  const section = resolveSection(source.sectionHint);
  const spamRules = mergeSpamRules(options.spamRules);
  const { isSpam, isAd } = detectSpam(
    { text: message.text, isSpamSource: source.isSpamSource ?? false },
    spamRules,
  );

  if (section === 'events') {
    const event = parseEventStart(message.text, message.datetime);
    if (event.kind === 'unparseable') {
      return {
        kind: 'event_unparseable',
        messageId: message.id,
        url: options.url,
        error: event.error,
      };
    }
    return buildListing({ message, source, options, section, isSpam, isAd, eventStartsAt: event.startsAt });
  }

  return buildListing({ message, source, options, section, isSpam, isAd, eventStartsAt: null });
}

interface BuildInput {
  message: ParsedMessage;
  source: ClassificationSource;
  options: ClassifyOptions;
  section: Section;
  isSpam: boolean;
  isAd: boolean;
  eventStartsAt: string | null;
}

function buildListing(input: BuildInput): ClassifyResult {
  const { message, source, options, section } = input;

  const textRaw = message.text;
  const textNormalized = normalizeText(textRaw);
  const hashtags = extractHashtags(textRaw);
  const title = titleFromText(textRaw);
  const city = matchCity(textRaw);
  const price = parsePrice(textRaw);
  const category = classifyCategory(textNormalized, source.categoryHint ?? null, section);
  const demand = detectDemand(textNormalized);

  const listing: NewListing = {
    sourceId: options.sourceId,
    messageId: message.id,
    url: options.url,
    publishedAt: message.datetime,
    editedAt: null,
    fetchedAt: options.fetchedAt,
    textRaw,
    textNormalized,
    searchText: buildSearchText({
      title,
      textNormalized,
      city: city?.display ?? null,
      hashtags,
    }),
    contentHash: contentHash({
      text: textRaw,
      photos: message.photos,
      hasVideo: message.hasVideo,
    }),
    title,
    section,
    category,
    demand,
    city: city?.display ?? null,
    priceRaw: price.raw,
    priceValue: price.value,
    priceCurrency: price.currency as PriceCurrency | null,
    pricePeriod: price.period as PricePeriod | null,
    salaryRaw: section === 'jobs' ? price.raw : null,
    eventStartsAt: input.eventStartsAt,
    hasPhotos: message.photos.length > 0,
    hasVideo: message.hasVideo,
    isAd: input.isAd,
    isSpam: input.isSpam,
    messageStatus: 'available',
    parserVersion: PARSER_VERSION,
    photos: message.photos.map((url) => ({ url })),
  };

  return {
    kind: 'listing',
    listing,
    facets: {
      textNormalized,
      priceKey: price.key,
      cityKey: city?.key ?? null,
      section,
      category,
      demand,
    },
  };
}
