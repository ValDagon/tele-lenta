import type { CardDetail, CardPhoto, DetailSourceRow } from "../api/types";
import { config } from "../config";
import { categoryLabel } from "../feed/card-model";
import { plural } from "../lib/plural";
import { formatEventDate, relativeTime } from "../lib/time";

/**
 * Pure presentation rules for the detail screen: the full text, the gallery
 * counter, the source trail, and the MainButton target. Nothing here touches
 * the DOM, so every rule is testable without a browser.
 */

export type TextToken =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "mention"; text: string; url: string }
  | { kind: "hashtag"; text: string; tag: string };

const TOKEN_RE =
  /(https?:\/\/[^\s<>"]+|t\.me\/[^\s<>"]+|@[A-Za-z0-9_]{3,}|#[\p{L}\p{N}_]+)/gu;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}>»"'…]+$/u;

/**
 * Blank lines separate paragraphs; single newlines stay inside one paragraph
 * and are rendered as line breaks, so the post keeps its shape.
 */
export function splitParagraphs(body: string): string[] {
  const normalized = body.replace(/\r\n?/g, "\n");
  return normalized
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]+$/gm, "").trim())
    .filter((paragraph) => paragraph !== "");
}

/** One line of a paragraph as plain text, links, mentions, and hashtags. */
export function tokenizeText(line: string): TextToken[] {
  const tokens: TextToken[] = [];
  let lastIndex = 0;

  // Consecutive plain slices are one node, not many: the renderer stays tiny
  // and the punctuation trimmed off a link joins the text around it.
  const pushText = (text: string) => {
    if (text === "") return;
    const previous = tokens.at(-1);
    if (previous?.kind === "text") {
      previous.text += text;
      return;
    }
    tokens.push({ kind: "text", text });
  };

  for (const match of line.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];

    if (start > lastIndex) pushText(line.slice(lastIndex, start));

    // Sentence punctuation after a URL is text, not part of the link.
    const value = raw.replace(TRAILING_PUNCTUATION, "");

    if (value.startsWith("http://") || value.startsWith("https://")) {
      tokens.push({ kind: "link", text: value, url: value });
    } else if (value.startsWith("t.me/")) {
      tokens.push({ kind: "link", text: value, url: `https://${value}` });
    } else if (value.startsWith("@")) {
      tokens.push({
        kind: "mention",
        text: value,
        url: `https://t.me/${value.slice(1)}`,
      });
    } else {
      tokens.push({ kind: "hashtag", text: value, tag: value });
    }

    pushText(raw.slice(value.length));

    lastIndex = start + raw.length;
  }

  if (lastIndex < line.length) pushText(line.slice(lastIndex));

  return tokens;
}

/** Search takes the tag with one leading `#`, e.g. `#недвижимость`. */
export function hashtagQuery(tag: string): string | null {
  const value = tag.trim().replace(/^#+/, "");
  return value === "" ? null : `#${value}`;
}

export function galleryIndex(
  scrollLeft: number,
  slideWidth: number,
  count: number,
): number {
  if (!Number.isFinite(scrollLeft) || slideWidth <= 0 || count <= 0) return 0;
  const index = Math.round(scrollLeft / slideWidth);
  return Math.min(count - 1, Math.max(0, index));
}

export function galleryLabel(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

/** Only hotlinked Telegram CDN photos render, same rule as the feed card. */
export function detailPhotoUrl(url: string): string | null {
  const value = url.trim();
  if (value === "") return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    if (
      parsed.hostname === "telesco.pe" ||
      parsed.hostname.endsWith(".telesco.pe")
    ) {
      return value;
    }
  } catch {
    return null;
  }

  return null;
}

export function galleryPhotos(photos: readonly CardPhoto[]): CardPhoto[] {
  return photos.filter((photo) => detailPhotoUrl(photo.url) !== null);
}

export interface SourceAction {
  label: string;
  actionable: boolean;
}

/**
 * The source row's status and whether it can open. Deleted wins over access:
 * a deleted message in an invite chat has nothing to open.
 */
export function sourceAction(source: DetailSourceRow): SourceAction {
  if (source.message_status === "deleted") {
    return { label: config.detail.sources.deleted, actionable: false };
  }
  if (source.access === "closed") {
    return { label: config.detail.sources.closed, actionable: false };
  }
  if (source.access === "invite") {
    return { label: config.detail.sources.invite, actionable: true };
  }
  return { label: config.detail.sources.public, actionable: true };
}

/** The earliest source the MainButton may open, or null when none can. */
export function earliestActionableSource(
  sources: readonly DetailSourceRow[],
): DetailSourceRow | null {
  return sources.find((source) => sourceAction(source).actionable) ?? null;
}

/** «первым, 2 ч» — the absolute earliest source keeps its marker when deleted. */
export function sourceMetaLabel(
  source: DetailSourceRow,
  now: Date,
): string {
  const time = relativeTime(source.published_at, now);
  const parts: string[] = [];
  if (source.is_first) parts.push(config.detail.firstSource);
  if (time !== "") parts.push(time);
  return parts.join(", ");
}

export function publishedInLabel(count: number): string {
  return `${config.detail.publishedIn} ${count} ${plural(count, config.detail.sourceForms)}`;
}

export function detailMetaLabel(card: CardDetail): string {
  if (card.section === "classifieds") {
    return categoryLabel(card.category) ?? config.feed.sections.classifieds;
  }
  return config.feed.sections[card.section];
}

/** Price, salary, or the event start; null when the slot is empty. */
export function detailPriceText(
  card: CardDetail,
  now: Date = new Date(),
): string | null {
  if (card.section === "events") {
    if (!card.event) return null;
    const label = formatEventDate(card.event.starts_at, now);
    return label === "" ? null : label;
  }

  const slot = card.section === "jobs" ? card.salary : card.price;
  const raw = slot?.raw.trim() ?? "";
  return raw === "" ? null : raw;
}
