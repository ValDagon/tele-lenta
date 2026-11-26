/**
 * The slice of the Telegram Mini Apps SDK this app uses. The SDK is injected
 * by telegram-web-app.js and is not an npm dependency; keeping the shape here
 * means the app and its tests share one definition.
 */

export interface TelegramThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  subtitle_text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  [key: string]: string | undefined;
}

export interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

export interface TelegramMainButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
  is_progress_visible?: boolean;
}

export interface TelegramMainButton {
  setText(text: string): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  setParams(params: TelegramMainButtonParams): void;
}

export interface TelegramServerless {
  call(
    name: string,
    input: Record<string, unknown>,
    callback: (error: unknown, result?: unknown) => void,
  ): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { id: number };
  };
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  version: string;
  isExpanded: boolean;
  BackButton?: TelegramBackButton;
  MainButton?: TelegramMainButton;
  Serverless?: TelegramServerless;
  ready(): void;
  expand(): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  openLink?(url: string): void;
  HapticFeedback?: {
    selectionChanged(): void;
    notificationOccurred?(type: "error" | "success" | "warning"): void;
  };
}
