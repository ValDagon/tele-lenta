/**
 * Deterministic spam and ad flags.
 *
 * No model, no probabilities: a flag is either set by a rule or it is not.
 * Short text alone is never spam — «Продам гараж» is a legitimate listing — and
 * a photo-less post is not spam either.
 *
 * `is_spam`:
 * - the source is marked as a spam source, or
 * - the text is link-only (nothing but URLs, mentions, hashtags, emoji, and
 *   punctuation), or
 * - a configured spam marker appears in the text.
 *
 * `is_ad`:
 * - an explicit ad marker appears, or
 * - the text carries a Telegram invite link (`t.me/+…` or `t.me/joinchat/…`).
 *
 * Both marker lists are plain lowercase substrings, passed in by the caller and
 * merged over the defaults. They are deliberately data, not code: the tick can
 * load them from configuration without a rebuild.
 */

import { normalizeText } from './text.js';

export interface SpamRules {
  /** Lowercase substrings that mark a post as spam. */
  spamMarkers: readonly string[];
  /** Lowercase substrings that mark a post as an advertisement. */
  adMarkers: readonly string[];
}

/**
 * Defaults are intentionally narrow. Each entry is a phrase that almost never
 * appears in a real classified, so the filter stays safe by default.
 */
export const DEFAULT_SPAM_RULES: SpamRules = {
  spamMarkers: [
    'казино',
    'ставки на спорт',
    '1xbet',
    '1хбет',
    'букмекер',
    'заработок из дома',
    'легкие деньги',
    'лёгкие деньги',
    'быстрые деньги',
    'криптосигнал',
    'инвестируй',
    'переходи по ссылке',
  ],
  adMarkers: [
    'реклама',
    'рекламный',
    'промокод',
    'розыгрыш',
    'подписывайся',
    'подпишись',
    'переходи по ссылке',
    'жми на ссылку',
    'ссылка в профиле',
    'наш канал',
  ],
};

const URL_PATTERN =
  /(?:https?:\/\/|www\.)\S+|(?:^|\s)(?:t|telegram)\.me\/\S+/giu;
const LINK_PRESENT = /(?:https?:\/\/|www\.|(?:t|telegram)\.me\/)/iu;
const INVITE_LINK = /(?:https?:\/\/)?(?:t|telegram)\.me\/(?:\+|joinchat\/)/iu;

export interface SpamInput {
  /** Raw post text, before normalization. */
  text: string;
  /** `sources.is_spam_source`. */
  isSpamSource: boolean;
}

export interface SpamVerdict {
  isSpam: boolean;
  isAd: boolean;
}

/** Merges caller markers over the defaults, lowercasing them once. */
export function mergeSpamRules(overrides?: Partial<SpamRules>): SpamRules {
  return {
    spamMarkers: (overrides?.spamMarkers ?? DEFAULT_SPAM_RULES.spamMarkers).map((marker) =>
      marker.toLowerCase(),
    ),
    adMarkers: (overrides?.adMarkers ?? DEFAULT_SPAM_RULES.adMarkers).map((marker) =>
      marker.toLowerCase(),
    ),
  };
}

/** True when a post contains a link and nothing else meaningful. */
export function isLinkOnly(text: string): boolean {
  if (!LINK_PRESENT.test(text)) return false;
  const withoutLinks = text.replace(URL_PATTERN, ' ');
  return normalizeText(withoutLinks) === '';
}

function hasMarker(text: string, markers: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return markers.some((marker) => marker !== '' && lower.includes(marker));
}

/** Computes both flags from the text and the source marker. */
export function detectSpam(input: SpamInput, rules: SpamRules = DEFAULT_SPAM_RULES): SpamVerdict {
  const isAd = hasMarker(input.text, rules.adMarkers) || INVITE_LINK.test(input.text);
  const isSpam =
    input.isSpamSource ||
    isLinkOnly(input.text) ||
    hasMarker(input.text, rules.spamMarkers);

  return { isSpam, isAd };
}
