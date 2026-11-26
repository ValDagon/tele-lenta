/**
 * Builds the one batched Дайджест message per user (spec «Bot and digest»).
 *
 * The function is pure: it takes the already-grouped unsent matches and
 * returns Telegram HTML plus the cluster ids that actually fit. Layer B sends
 * the result and records those ids with `DigestStore.markSent`; this module
 * never sends and never touches the database.
 *
 * Format, one card per line under its search name:
 *
 *     Новые совпадения по сохранённым поискам:
 *
 *     <b>Квартира в Подгорице</b>
 *     <a href="https://t.me/<bot>?startapp=card_12">Сдам квартиру</a> — 650 €, Podgorica
 *     и ещё 2
 *
 * There is no emoji and no middle dot, every user-controlled string goes
 * through `escapeHtml`, and the link is built from the numeric cluster id only.
 * The whole message is capped at `limit` cards (ten by default), so one busy
 * search cannot flood the chat.
 */

import type { UnsentMatch } from '../store/index.js';

import { DIGEST_TIME_ZONE, MAX_DIGEST_CARDS } from './constants.js';

export interface DigestGroupInput {
  searchName: string;
  matches: readonly UnsentMatch[];
}

export interface ComposeDigestInput {
  userName?: string | null;
  groups: ReadonlyArray<DigestGroupInput>;
  /** Bot username with or without a leading `@`. */
  botUsername: string;
  /** Total card cap; defaults to {@link MAX_DIGEST_CARDS}. */
  limit?: number;
}

export interface ComposedDigest {
  /** Telegram HTML; an empty string means "nothing to send". */
  html: string;
  /** The cluster ids that were included, in message order, deduplicated. */
  clusterIds: number[];
  /** True when at least one card did not fit. */
  hasMore: boolean;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five characters Telegram's HTML parser treats as markup. */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const eventFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: DIGEST_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** «5 декабря, 19:00» in Podgorica; null for an unparsable timestamp. */
function formatEventStart(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  let day = '';
  let month = '';
  let hour = '';
  let minute = '';
  for (const part of eventFormatter.formatToParts(date)) {
    if (part.type === 'day') day = part.value;
    if (part.type === 'month') month = part.value;
    if (part.type === 'hour') hour = String(Number(part.value) % 24).padStart(2, '0');
    if (part.type === 'minute') minute = part.value;
  }
  if (day === '' || month === '') return null;
  return `${day} ${month}, ${hour}:${minute}`;
}

/** The slot the card would show, following the section like the feed card. */
function detailsFor(match: UnsentMatch): string[] {
  const parts: string[] = [];

  if (match.section === 'events') {
    if (match.eventStartsAt !== null) {
      const formatted = formatEventStart(match.eventStartsAt);
      if (formatted !== null) parts.push(formatted);
    }
  } else if (match.section === 'jobs') {
    if (match.salaryRaw !== null && match.salaryRaw !== '') parts.push(match.salaryRaw);
  } else if (match.priceRaw !== null && match.priceRaw !== '') {
    parts.push(match.priceRaw);
  }

  if (match.city !== null && match.city !== '') parts.push(match.city);
  return parts;
}

function cardLine(match: UnsentMatch, botUsername: string): string {
  const title = match.title.trim() === '' ? 'Без названия' : match.title;
  const url = `https://t.me/${botUsername}?startapp=card_${match.clusterId}`;
  const details = detailsFor(match).map(escapeHtml);

  const link = `<a href="${url}">${escapeHtml(title)}</a>`;
  return details.length === 0 ? link : `${link} — ${details.join(', ')}`;
}

export function composeDigest(input: ComposeDigestInput): ComposedDigest {
  const limit = input.limit ?? MAX_DIGEST_CARDS;
  const botUsername = input.botUsername.replace(/^@+/, '');

  const blocks: string[] = [];
  const clusterIds: number[] = [];
  const seenClusters = new Set<number>();
  let remaining = Math.max(0, limit);
  let hasMore = false;

  for (const group of input.groups) {
    if (group.matches.length === 0) continue;

    const fit = Math.min(group.matches.length, remaining);
    const included = group.matches.slice(0, fit);
    remaining -= fit;

    const lines = included.map((match) => {
      if (!seenClusters.has(match.clusterId)) {
        seenClusters.add(match.clusterId);
        clusterIds.push(match.clusterId);
      }
      return cardLine(match, botUsername);
    });

    const dropped = group.matches.length - fit;
    if (dropped > 0) {
      hasMore = true;
      lines.push(`и ещё ${dropped}`);
    }

    blocks.push([`<b>${escapeHtml(group.searchName)}</b>`, ...lines].join('\n'));
  }

  if (clusterIds.length === 0) {
    return { html: '', clusterIds: [], hasMore };
  }

  const greeting =
    input.userName !== null && input.userName !== undefined && input.userName.trim() !== ''
      ? `Привет, <b>${escapeHtml(input.userName)}</b>! Новые совпадения по сохранённым поискам:`
      : 'Новые совпадения по сохранённым поискам:';

  return {
    html: [greeting, ...blocks].join('\n\n'),
    clusterIds,
    hasMore,
  };
}
