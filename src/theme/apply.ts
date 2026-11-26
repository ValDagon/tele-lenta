import { readString, writeString } from "../lib/storage";
import type { TelegramWebApp } from "../telegram/types";
import { parseHexColor } from "./contrast";
import { resolveTelegramTheme, type ResolvedColors } from "./telegram";
import { brandTokens } from "./tokens";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tele_lenta.theme";

const THEME_MODES: ReadonlyArray<ThemeMode> = ["auto", "light", "dark"];

const OVERRIDE_VARS = [
  "--canvas",
  "--surface",
  "--ink",
  "--ink-secondary",
  "--ink-muted",
  "--line",
  "--accent",
  "--on-accent",
] as const;

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export function readThemeMode(): ThemeMode {
  const stored = readString(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : "auto";
}

export function writeThemeMode(mode: ThemeMode): void {
  writeString(THEME_STORAGE_KEY, mode);
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(
  mode: ThemeMode,
  telegramScheme: "light" | "dark" | undefined,
  prefersDark: boolean,
): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  if (telegramScheme === "light" || telegramScheme === "dark") {
    return telegramScheme;
  }
  return prefersDark ? "dark" : "light";
}

function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

function clearOverrides(): void {
  for (const name of OVERRIDE_VARS) {
    document.documentElement.style.removeProperty(name);
  }
}

function syncChrome(
  webapp: TelegramWebApp | undefined,
  mode: ThemeMode,
  colors: ResolvedColors,
): void {
  if (!webapp) return;

  const params = webapp.themeParams;
  const surface =
    mode === "auto"
      ? (validHex(params?.section_bg_color) ??
        validHex(params?.secondary_bg_color) ??
        colors.surface)
      : brandTokens[resolveTheme(mode, webapp.colorScheme, systemPrefersDark())]
          .surface;

  try {
    webapp.setHeaderColor?.(colors.canvas);
    webapp.setBackgroundColor?.(colors.canvas);
    webapp.setBottomBarColor?.(surface);
  } catch {
    /* older Telegram clients expose the methods but reject colours */
  }
}

function validHex(value: string | undefined): string | undefined {
  return value && parseHexColor(value) ? value.trim() : undefined;
}

/**
 * Applies the resolved theme to the root. In auto mode the Telegram neutral
 * layer is written as inline custom properties; in manual mode those
 * properties are removed so the `[data-theme]` token block wins.
 */
export function applyTheme(
  mode: ThemeMode,
  webapp: TelegramWebApp | undefined,
): ResolvedTheme {
  const theme = resolveTheme(
    mode,
    webapp?.colorScheme,
    systemPrefersDark(),
  );

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  clearOverrides();

  let colors: ResolvedColors;
  if (mode === "auto") {
    colors = resolveTelegramTheme(webapp?.themeParams, theme);
    setVar("--canvas", colors.canvas);
    setVar("--surface", colors.surface);
    setVar("--ink", colors.ink);
    setVar("--ink-secondary", colors.inkSecondary);
    setVar("--ink-muted", colors.inkMuted);
    setVar("--line", colors.line);
    setVar("--accent", colors.accent);
    setVar("--on-accent", colors.onAccent);
  } else {
    const brand = brandTokens[theme];
    colors = {
      canvas: brand.canvas,
      surface: brand.surface,
      ink: brand.ink,
      inkSecondary: brand.inkSecondary,
      inkMuted: brand.inkMuted,
      line: brand.line,
      accent: brand.accent,
      onAccent: brand.onAccent,
    };
  }

  syncChrome(webapp, mode, colors);
  return theme;
}
