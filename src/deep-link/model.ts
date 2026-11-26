/**
 * The deep-link payload Telegram hands back in `initData.start_param`.
 * The string is opaque to the platform; the Mini App owns the format. A card
 * link is `card_<id>`, everything else is not ours and is ignored.
 */
export const CARD_START_PREFIX = "card_";

const CARD_ID_PATTERN = /^\d{1,15}$/;

/**
 * Reads a card id out of a `start_param`. Strict by design: no trimming, no
 * case folding, no numeric coercion. A payload that is not exactly
 * `card_<positive safe integer>` returns null and the caller shows the feed.
 */
export function parseStartParam(
  value: string | null | undefined,
): number | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(CARD_START_PREFIX)) return null;

  const digits = value.slice(CARD_START_PREFIX.length);
  if (!CARD_ID_PATTERN.test(digits)) return null;

  const id = Number(digits);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  // The format is the canonical decimal form; `card_01` is not a link we make.
  if (String(id) !== digits) return null;

  return id;
}

/**
 * Builds the deep-link payload for a card. Used by tests today and by the
 * digest links once they are generated; it only accepts an id that
 * `parseStartParam` will read back unchanged.
 */
export function startParamForCard(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError(`card id must be a positive safe integer: ${id}`);
  }
  return `${CARD_START_PREFIX}${id}`;
}
