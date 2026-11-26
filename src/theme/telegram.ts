import type { TelegramThemeParams } from "../telegram/types";
import { contrastRatio, parseHexColor, pickReadable } from "./contrast";
import { brandTokens } from "./tokens";

export interface ResolvedColors {
  canvas: string;
  surface: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  line: string;
  accent: string;
  onAccent: string;
}

function valid(value: string | undefined): string | undefined {
  return parseHexColor(value) ? value?.trim() : undefined;
}

/**
 * Maps Telegram `themeParams` onto the app's neutral layer, then applies the
 * design system's contrast guard: text below 4.5:1 falls back to brand ink,
 * and the accent stays verdigris instead of an arbitrary `link_color`.
 */
export function resolveTelegramTheme(
  params: TelegramThemeParams | undefined,
  scheme: "light" | "dark",
): ResolvedColors {
  const brand = brandTokens[scheme];
  const other = brandTokens[scheme === "light" ? "dark" : "light"];

  const canvas = valid(params?.bg_color) ?? brand.canvas;
  const surface =
    valid(params?.section_bg_color) ??
    valid(params?.secondary_bg_color) ??
    brand.surface;

  const ink = pickReadable(canvas, [valid(params?.text_color), brand.ink]);
  const inkSecondary = pickReadable(canvas, [
    valid(params?.subtitle_text_color),
    brand.inkSecondary,
    brand.ink,
  ]);
  const inkMuted = pickReadable(canvas, [
    valid(params?.hint_color),
    brand.inkMuted,
    brand.inkSecondary,
    brand.ink,
  ]);

  // The accent is always the brand verdigris; if a custom background makes it
  // unreadable, the other scheme's variant is the next try, then ink.
  const accent = pickReadable(
    canvas,
    [brand.accent, other.accent, brand.ink],
    4.5,
  );
  const onAccent = pickReadable(accent, [
    brand.onAccent,
    "#FFFFFF",
    brand.ink,
  ]);

  // Hairlines are boundaries, not text: 3:1 is enough. Muted ink is the
  // readable substitute when Telegram's neutral surface is unusual.
  const line =
    contrastRatio(brand.line, canvas) >= 3 ? brand.line : inkMuted;

  return {
    canvas,
    surface,
    ink,
    inkSecondary,
    inkMuted,
    line,
    accent,
    onAccent,
  };
}
