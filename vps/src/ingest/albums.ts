/**
 * Album collapse, pure over parsed messages of one source.
 *
 * Telegram delivers an album as several message widgets that share the caption
 * and the photo set. The collector must store one listing, not one per widget,
 * and the surviving listing takes the lowest message id so a cross-post and a
 * later re-check agree on identity.
 *
 * The rule: same normalized text, same first photo, publication times within
 * two minutes. Ids do not have to be consecutive, so a deleted middle message
 * cannot split an album. The photo set is merged once, in id order, and the
 * survivors carry it; inputs are never mutated.
 */

import type { ParsedMessage } from '../parser/telegram-html.js';

import { normalizeText } from './text.js';

/** Two album members further apart than this are separate posts. */
export const ALBUM_WINDOW_MS = 2 * 60 * 1000;

export interface AlbumGroup {
  /**
   * The surviving message: the lowest id in the group, with the merged photo
   * set. This is the message the collector classifies and stores.
   */
  survivor: ParsedMessage;
  /** Absorbed message ids, ascending, excluding the survivor. */
  collapsedIds: number[];
  /** The merged photo set, stored once on the surviving listing. */
  photos: string[];
}

export interface AlbumOptions {
  windowMs?: number;
}

function sameFirstPhoto(a: ParsedMessage, b: ParsedMessage): boolean {
  const first = a.photos[0];
  return first !== undefined && first === b.photos[0];
}

function withinWindow(a: ParsedMessage, b: ParsedMessage, windowMs: number): boolean {
  const aMs = Date.parse(a.datetime);
  const bMs = Date.parse(b.datetime);
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return false;
  return Math.abs(aMs - bMs) <= windowMs;
}

function canCollapse(a: ParsedMessage, b: ParsedMessage, windowMs: number): boolean {
  if (!sameFirstPhoto(a, b)) return false;
  if (!withinWindow(a, b, windowMs)) return false;
  return normalizeText(a.text) === normalizeText(b.text);
}

/**
 * Groups messages into albums. Returns one entry per surviving message, in
 * ascending id order. Absorbed messages appear only inside `collapsedIds`, so
 * the caller can iterate the result directly and never stores a duplicate.
 */
export function collapseAlbums(
  messages: readonly ParsedMessage[],
  options: AlbumOptions = {},
): AlbumGroup[] {
  const windowMs = options.windowMs ?? ALBUM_WINDOW_MS;
  const sorted = [...messages].sort((a, b) => a.id - b.id);
  const absorbed = new Set<number>();
  const groups: AlbumGroup[] = [];

  for (const message of sorted) {
    if (absorbed.has(message.id)) continue;

    const collapsedIds: number[] = [];
    const photos = [...message.photos];

    for (const candidate of sorted) {
      if (candidate.id <= message.id) continue;
      if (absorbed.has(candidate.id)) continue;
      if (!canCollapse(message, candidate, windowMs)) continue;

      absorbed.add(candidate.id);
      collapsedIds.push(candidate.id);
      for (const photo of candidate.photos) {
        if (!photos.includes(photo)) photos.push(photo);
      }
    }

    groups.push({
      survivor: { ...message, photos },
      collapsedIds,
      photos,
    });
  }

  return groups;
}
