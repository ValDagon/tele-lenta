import type { Card } from "../api/types";
import { config } from "../config";
import { plural } from "../lib/plural";
import {
  dayDividerLabel,
  dayKey,
  formatEventDate,
  relativeTime,
} from "../lib/time";

/**
 * Pure presentation rules for one Карточка. Slot emptiness is returned as
 * `null`, never as a placeholder string, so the component omits a slot instead
 * of faking content.
 */

const CATEGORY_LABELS: Record<string, string> = config.feed.categories;

export function categoryLabel(category: string): string | null {
  const label = CATEGORY_LABELS[category];
  return label === undefined || label.trim() === "" ? null : label;
}

/**
 * Category inside Объявления, section elsewhere. Search results cross sections,
 * so they ask for the section to lead the label («Объявления, Недвижимость»);
 * it is never repeated when the label already is the section.
 */
export function cardMetaLabel(card: Card, showSection = false): string {
  const base =
    card.section === "classifieds"
      ? (categoryLabel(card.category) ?? config.feed.sections.classifieds)
      : config.feed.sections[card.section];

  if (!showSection) return base;

  const section = config.feed.sections[card.section];
  return base === section ? base : `${section}, ${base}`;
}

/** «Куплю» / «Ищу» / «Ищу работу», or nothing for an offer or an event. */
export function demandBadge(card: Card): string | null {
  if (card.section === "events") return null;
  if (card.demand !== "wanted") return null;
  if (card.section === "jobs") return config.feed.demand.job;
  return /куплю/i.test(card.title)
    ? config.feed.demand.buy
    : config.feed.demand.seek;
}

/** Price or salary raw text; for events, the start date. */
export function cardPriceText(card: Card, now: Date = new Date()): string | null {
  if (card.section === "events") {
    if (!card.event) return null;
    const label = formatEventDate(card.event.starts_at, now);
    return label === "" ? null : label;
  }

  const slot = card.section === "jobs" ? card.salary : card.price;
  const raw = slot?.raw.trim() ?? "";
  return raw === "" ? null : raw;
}

export function cardRelativeTime(card: Card, now: Date): string {
  return relativeTime(card.earliest_published_at, now);
}

/** «ещё 2 источника» — the trail keeps at most three monograms. */
export function sourceOverflowLabel(count: number): string {
  return `${config.feed.sourceOverflowPrefix} ${count} ${plural(count, [
    config.feed.sources.one,
    config.feed.sources.few,
    config.feed.sources.many,
  ])}`;
}

/**
 * The link name. It must let a screen reader decide from the announcement, so
 * it carries title, price/date, city, and the source count.
 */
export function cardAccessibleName(
  card: Card,
  now: Date = new Date(),
  showSection = false,
): string {
  const parts: string[] = [];
  if (showSection) parts.push(config.feed.sections[card.section]);

  const title = card.title.trim();
  if (title !== "") parts.push(title);

  const price = cardPriceText(card, now);
  if (price !== null) parts.push(price);

  const city = card.city?.trim() ?? "";
  if (city !== "") parts.push(city);

  parts.push(`${config.feed.sourceCountName}: ${card.source_count}`);
  return parts.join(", ");
}

export function isMultiSource(card: Card): boolean {
  return card.source_count > 1;
}

/** Only hotlinked Telegram CDN photos render; anything else is an absent slot. */
export function cardPhotoUrl(card: Card): string | null {
  const url = card.photo?.url.trim() ?? "";
  if (url === "") return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (
      parsed.hostname === "telesco.pe" ||
      parsed.hostname.endsWith(".telesco.pe")
    ) {
      return url;
    }
  } catch {
    return null;
  }

  return null;
}

export type FeedRow =
  | { kind: "divider"; key: string; label: string }
  | { kind: "card"; card: Card };

/**
 * Inserts one day divider before the first card of each Podgorica calendar day.
 * The feed is already newest first; this never reorders it.
 */
export function buildFeedRows(cards: readonly Card[], now: Date): FeedRow[] {
  const rows: FeedRow[] = [];
  let previousDay: string | null = null;

  for (const card of cards) {
    const key = dayKey(card.earliest_published_at);
    if (key !== null && key !== previousDay) {
      rows.push({
        kind: "divider",
        key,
        label: dayDividerLabel(card.earliest_published_at, now),
      });
      previousDay = key;
    }
    rows.push({ kind: "card", card });
  }

  return rows;
}
