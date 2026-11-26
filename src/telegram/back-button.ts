import type { TelegramWebApp } from "./types";

/**
 * The native BackButton follows the view state machine: visible whenever there
 * is somewhere to go back to, hidden at the feed root.
 */
export function setBackButton(
  webapp: TelegramWebApp | undefined,
  visible: boolean,
): void {
  const button = webapp?.BackButton;
  if (!button) return;
  try {
    if (visible) button.show();
    else button.hide();
  } catch {
    /* older clients expose the object but reject calls */
  }
}

export function onBackButton(
  webapp: TelegramWebApp | undefined,
  handler: () => void,
): () => void {
  const button = webapp?.BackButton;
  if (!button) return () => undefined;
  button.onClick(handler);
  return () => button.offClick(handler);
}
