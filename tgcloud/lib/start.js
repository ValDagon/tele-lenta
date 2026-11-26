/**
 * The bot's `/start` landing: pure text, command parsing, and the `web_app`
 * reply.
 *
 * The bot is only the Mini App entry point (ADR-0003). It carries no allowlist
 * logic and writes no product state: access is enforced by the Mini App's
 * session check. This module therefore imports nothing but the settings key
 * list, so Node can load it in tests and the handler stays thin.
 */

import { SETTINGS_KEYS } from './settings-keys.js';

/** Greeting shown by `/start`. Two sentences, sentence case, no emoji, no `!`. */
export const START_TEXT =
  'Это лента объявлений и вакансий из открытых чатов Черногории. ' +
  'Контакты остаются в исходном чате, а кнопка ниже открывает приложение.';

/** The single inline `web_app` button. */
export const START_BUTTON_TEXT = 'Открыть ленту';

/** Shown instead of the button when no valid Mini App URL is configured. */
export const START_UNAVAILABLE_TEXT = 'Приложение ещё не настроено. Напишите владельцу.';

/** Environment fallback for the Mini App URL. */
export const MINI_APP_URL_ENV = 'MINI_APP_URL';

/**
 * `/start`, `/start@bot_username`, optionally followed by a payload. Telegram
 * sends commands lowercase; the trailing boundary prevents `/starter`.
 */
const START_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * True only for a `/start` message in a private chat.
 *
 * @param {unknown} message an Update.message payload, or anything else
 * @returns {boolean}
 */
export function isStartCommand(message) {
  if (!isRecord(message)) return false;
  const chat = message.chat;
  if (!isRecord(chat) || chat.type !== 'private') return false;
  if (typeof message.text !== 'string') return false;
  return START_PATTERN.test(message.text);
}

/**
 * The deep-link payload after the command, or null when there is none.
 * `/start card_42` and `/start@bot card_42` both yield `card_42`.
 *
 * @param {unknown} message
 * @returns {string | null}
 */
export function startCommandPayload(message) {
  if (!isStartCommand(message)) return null;
  const match = START_PATTERN.exec(message.text);
  if (!match) return null;
  const payload = message.text.slice(match[0].length).trim();
  return payload === '' ? null : payload;
}

/**
 * Telegram requires HTTPS for a `web_app` button. A URL with no host is not a
 * usable target.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWebAppUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * The `/start` reply. With a valid URL: greeting plus one inline `web_app`
 * button. Otherwise: the fallback text and no keyboard.
 *
 * @param {{ miniappUrl?: unknown }} [input]
 * @returns {{ text: string, reply_markup?: { inline_keyboard: Array<Array<{ text: string, web_app: { url: string } }>> } }}
 */
export function startReply(input = {}) {
  const url = input && input.miniappUrl;
  if (!isWebAppUrl(url)) return { text: START_UNAVAILABLE_TEXT };

  return {
    text: START_TEXT,
    reply_markup: {
      inline_keyboard: [[{ text: START_BUTTON_TEXT, web_app: { url: url.trim() } }]],
    },
  };
}

function settingsValue(settings, key) {
  if (!settings) return undefined;

  if (typeof settings.get === 'function') {
    const value = settings.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  if (Array.isArray(settings)) {
    for (const row of settings) {
      if (row && row.key === key && typeof row.value === 'string') return row.value;
    }
    return undefined;
  }

  if (typeof settings === 'object') {
    const value = settings[key];
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function firstValidUrl(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '' && isWebAppUrl(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Resolves the Mini App URL: the `miniapp_url` settings row first, then
 * `env.MINI_APP_URL`, else null. An invalid value falls through to the next
 * source rather than masking a working one.
 *
 * @param {{
 *   settings?: Map<string, string> | Array<{ key: string, value: string }> | Record<string, string>,
 *   env?: Record<string, string | undefined>,
 * }} [input]
 * @returns {string | null}
 */
export function miniAppUrl(input = {}) {
  const settings = input && input.settings;
  const env = input && input.env;
  return firstValidUrl([
    settingsValue(settings, SETTINGS_KEYS.MINIAPP_URL),
    env ? env[MINI_APP_URL_ENV] : undefined,
  ]);
}
