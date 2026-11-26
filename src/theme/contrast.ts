export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parses `#rgb` and `#rrggbb`. Returns null for anything else, so a Telegram
 * theme value the client did not normalise can never enter a CSS variable.
 */
export function parseHexColor(value: string | undefined | null): Rgb | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) {
    const expanded = hex
      .split("")
      .map((part) => part + part)
      .join("");
    return parseHexColor(`#${expanded}`);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG 2.1 contrast ratio. Invalid colours return 0, which fails every check. */
export function contrastRatio(foreground: string, background: string): number {
  const a = parseHexColor(foreground);
  const b = parseHexColor(background);
  if (!a || !b) return 0;

  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns the first candidate with enough contrast against the background, or
 * the last candidate when none passes. The last candidate is the caller's
 * final fallback, so this never returns an arbitrary colour.
 */
export function pickReadable(
  background: string,
  candidates: ReadonlyArray<string | undefined>,
  minimum = 4.5,
): string {
  const usable = candidates.filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const fallback = usable.at(-1);
  if (!fallback) {
    throw new Error("pickReadable needs at least one candidate");
  }
  for (const candidate of usable) {
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return fallback;
}
