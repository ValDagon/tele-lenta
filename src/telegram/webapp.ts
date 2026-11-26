import type { TelegramWebApp } from "./types";

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | undefined {
  return typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
}

/**
 * The platform signs `initData` and attaches it to every endpoint call. An
 * empty string means the page was opened in a normal browser, which the gate
 * reports as "open from Telegram".
 */
export function hasTelegramSession(
  webapp: TelegramWebApp | undefined,
): webapp is TelegramWebApp {
  return Boolean(webapp?.initData);
}

/** `ready()` and `expand()` belong as early as possible in boot. */
export function bootTelegram(webapp: TelegramWebApp | undefined): void {
  if (!webapp) return;
  webapp.ready();
  webapp.expand();
  webapp.MainButton?.hide();
}
