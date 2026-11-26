/**
 * Pure parser for the public Telegram HTML surfaces the collector reads:
 *
 * - channel pages: `https://t.me/s/<channel>`
 * - single group messages: `https://t.me/<group>/<id>?embed=1`
 *
 * Both use the same message widget markup, so one extraction path serves both.
 * The parser is deliberately dependency-free: it needs a small, predictable
 * subset of the markup, not a general DOM. It never fetches anything, never
 * touches the database, and never reads a file.
 */

export interface ParsedMessage {
  /** Telegram message id, taken from `data-post-id` or `data-post`. */
  id: number;
  /** Visible text with line breaks preserved. Empty for image/video-only posts. */
  text: string;
  /** Publication time from the widget `<time datetime>`, normalised to ISO UTC. */
  datetime: string;
  /**
   * True when the widget is marked as edited. Telegram's embed carries only the
   * publication timestamp, not a separate edit time, so the collector derives
   * `edited_at` from when it first observes a changed content hash.
   */
  edited: boolean;
  /** Photo URLs in widget order; only `cdn*.telesco.pe` is accepted. */
  photos: string[];
  /** True when the widget carries a video player. */
  hasVideo: boolean;
}

export type ParseResult =
  | { kind: 'messages'; messages: ParsedMessage[] }
  | { kind: 'not_found' }
  | { kind: 'parse_error'; error: string };

export interface ParseOptions {
  /**
   * When false, an HTML document without a single message widget is accepted
   * as an empty result. Defaults to true: an empty-looking page is HTML drift
   * until proven otherwise, and silently returning `[]` is how a feed dies.
   */
  requireMessages?: boolean;
}

const MESSAGE_START = /<div\b[^>]*\bclass="[^"]*\btgme_widget_message\b[^"]*"[^>]*>/g;
const MESSAGE_TEXT =
  /<div\b[^>]*\bclass="[^"]*\btgme_widget_message_text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const PHOTO_WRAP =
  /<a\b[^>]*\bclass="[^"]*\btgme_widget_message_photo_wrap\b[^"]*"[^>]*>[\s\S]*?<\/a>/g;
const BACKGROUND_IMAGE = /\bbackground-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;
const CDN_PHOTO = /^https:\/\/cdn[0-9a-z-]*\.telesco\.pe\//i;
const SERVICE_MESSAGE =
  /class="[^"]*\btgme_widget_message_service\b[^"]*"|message_media_not_supported_label"[^>]*>\s*Service message\s*</i;
const NOT_FOUND = /class="[^"]*\btgme_widget_message_error\b[^"]*"[^>]*>\s*Post not found\s*</i;
const DATE = /<time\b[^>]*\bdatetime="([^"]+)"/;
const POST_ID = /\bdata-post-id="(\d+)"/;
const DATA_POST = /\bdata-post="[^"/]+\/(\d+)"/;
const EDITED = /\bedited\b/;

/** Decodes the handful of entities Telegram emits in text and URLs. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/**
 * Converts a text widget body to plain text. `<br>` is a real line break;
 * formatting tags are dropped; source formatting whitespace collapses to one
 * space so the output is stable against indentation in the HTML.
 */
export function extractText(inner: string): string {
  const withBreaks = inner.replace(/<br\s*\/?>/gi, '\u0000');
  const withoutTags = withBreaks.replace(/<[^>]*>/g, '');
  const decoded = decodeEntities(withoutTags);
  return decoded
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/\u0000/g, '\n')
    .trim();
}

function extractPhotoUrls(widget: string): string[] {
  const urls: string[] = [];
  for (const match of widget.matchAll(PHOTO_WRAP)) {
    const tag = match[0];
    const background = BACKGROUND_IMAGE.exec(tag);
    if (background?.[1] === undefined) continue;

    let url = decodeEntities(background[1]).trim();
    if (url.startsWith('//')) url = `https:${url}`;
    if (!CDN_PHOTO.test(url)) continue; // emoji and Telegram static assets are not photos
    urls.push(url);
  }
  return urls;
}

function extractId(widget: string): number | null {
  const match = POST_ID.exec(widget) ?? DATA_POST.exec(widget);
  if (match?.[1] === undefined) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

function hasVideo(widget: string): boolean {
  return /\btgme_widget_message_video\b/.test(widget) || /<video\b/.test(widget);
}

function isEdited(widget: string): boolean {
  const meta = widget.indexOf('tgme_widget_message_meta');
  if (meta === -1) return false;
  const footer = widget.indexOf('tgme_widget_message_footer', meta);
  return EDITED.test(widget.slice(meta, footer === -1 ? meta + 1_000 : footer));
}

function parseWidget(widget: string): ParsedMessage | { error: string } {
  const id = extractId(widget);
  if (id === null) {
    return { error: 'message widget is missing a message id (data-post-id / data-post)' };
  }

  const date = DATE.exec(widget);
  if (date?.[1] === undefined) {
    return { error: `message ${id} is missing its <time datetime>` };
  }
  const parsedDate = new Date(date[1]);
  if (Number.isNaN(parsedDate.getTime())) {
    return { error: `message ${id} carries an invalid datetime "${date[1]}"` };
  }
  const datetime = parsedDate.toISOString();

  const textMatch = MESSAGE_TEXT.exec(widget);
  const text = textMatch?.[1] === undefined ? '' : extractText(textMatch[1]);

  return {
    id,
    text,
    datetime,
    edited: isEdited(widget),
    photos: extractPhotoUrls(widget),
    hasVideo: hasVideo(widget),
  };
}

/**
 * Parses saved Telegram HTML. Returns a discriminated result so a genuine
 * "Post not found" is never confused with an HTTP/parse failure: the collector
 * marks a listing deleted only for `not_found`, and treats `parse_error` as an
 * alert-worthy drift rather than an empty feed.
 */
export function parseTelegramHtml(html: string, options: ParseOptions = {}): ParseResult {
  if (html.trim() === '') {
    return { kind: 'parse_error', error: 'empty HTML document' };
  }

  if (NOT_FOUND.test(html)) {
    return { kind: 'not_found' };
  }

  const starts = [...html.matchAll(MESSAGE_START)].map((match) => match.index);
  if (starts.length === 0) {
    if (options.requireMessages === false) {
      return { kind: 'messages', messages: [] };
    }
    return {
      kind: 'parse_error',
      error: 'no tgme_widget_message widgets found; Telegram markup may have changed',
    };
  }

  const messages: ParsedMessage[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    if (start === undefined) continue;
    const end = starts[index + 1] ?? html.length;
    const widget = html.slice(start, end);

    if (SERVICE_MESSAGE.test(widget)) continue;

    const parsed = parseWidget(widget);
    if ('error' in parsed) {
      return { kind: 'parse_error', error: parsed.error };
    }
    messages.push(parsed);
  }

  return { kind: 'messages', messages };
}
