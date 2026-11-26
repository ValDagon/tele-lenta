import type { TelegramWebApp } from "./types";

export interface MainButtonAction {
  text: string;
  onClick: () => void;
}

/**
 * Binds the native MainButton to one action and returns the cleanup that
 * detaches it and hides the button. Detail is the only screen that shows it,
 * so a null action means "hidden" and leaves nothing behind on the feed.
 */
export function bindMainButton(
  webapp: TelegramWebApp | undefined,
  action: MainButtonAction | null,
): () => void {
  const button = webapp?.MainButton;
  if (!button) return () => undefined;

  const hide = () => {
    try {
      button.hide();
    } catch {
      /* older clients expose the object but reject calls */
    }
  };

  if (action === null) {
    hide();
    return hide;
  }

  try {
    button.setText(action.text);
    button.setParams({ text: action.text, is_active: true });
    button.onClick(action.onClick);
    button.enable();
    button.show();
  } catch {
    hide();
    return hide;
  }

  return () => {
    try {
      button.offClick(action.onClick);
    } catch {
      /* the handler may already be gone on an older client */
    }
    hide();
  };
}
