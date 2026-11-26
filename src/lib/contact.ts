import { config } from "../config";
import type { TelegramWebApp } from "../telegram/types";

interface Preventable {
  preventDefault(): void;
}

/**
 * One owner-contact path for the gate and Settings. Inside Telegram the link
 * opens through `openLink`; everywhere else the anchor keeps its own target so
 * the browser or webview handles it.
 */
export function openOwnerContact(
  webapp: TelegramWebApp | undefined,
  event?: Preventable,
): void {
  if (!webapp?.openLink) return;
  event?.preventDefault();
  webapp.openLink(config.ownerContactUrl);
}
