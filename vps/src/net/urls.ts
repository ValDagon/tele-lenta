/**
 * URL builders for the two public Telegram surfaces (ADR-0002):
 *
 * - channels are paginated HTML pages at `https://t.me/s/<username>`;
 * - groups are read one message at a time at
 *   `https://t.me/<username>/<message_id>?embed=1`.
 *
 * Pure functions: no network, no clock, no filesystem. A bad username or
 * message id throws instead of producing a URL the collector would request.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Accepts `montework` or `@montework`; trims whitespace. Rejects anything that
 * is not a plain Telegram username so a typo cannot turn into a different host
 * or path.
 */
export function normalizeSourceUsername(username: string): string {
  const trimmed = username.trim().replace(/^@/, '');
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new RangeError(`invalid Telegram source username: "${username}"`);
  }
  return trimmed;
}

function assertMessageId(messageId: number): number {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new RangeError(`invalid Telegram message id: ${String(messageId)}`);
  }
  return messageId;
}

export interface ChannelPageOptions {
  /** `?before=<min_post_id>`: the oldest id already seen on the previous page. */
  readonly before?: number | null;
}

/**
 * `https://t.me/s/<username>` — the channel page, up to 20 posts per response.
 * Passing `before` adds the `?before=` pagination parameter.
 */
export function channelPageUrl(
  username: string,
  options: ChannelPageOptions = {},
): string {
  const base = `https://t.me/s/${normalizeSourceUsername(username)}`;
  const before = options.before ?? null;
  if (before === null) {
    return base;
  }
  return `${base}?before=${assertMessageId(before)}`;
}

/** `https://t.me/<username>/<message_id>?embed=1` — one group message. */
export function messageEmbedUrl(username: string, messageId: number): string {
  return `https://t.me/${normalizeSourceUsername(username)}/${assertMessageId(messageId)}?embed=1`;
}
