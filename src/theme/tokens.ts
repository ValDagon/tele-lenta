/**
 * Brand token snapshot for the JavaScript contrast guard. The CSS layer is the
 * source of truth for rendering; these values exist so the guard can choose a
 * readable fallback without reading the computed style.
 */

export interface BrandTokens {
  canvas: string;
  surface: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  line: string;
  accent: string;
  onAccent: string;
  signal: string;
}

export const brandTokens: Record<"light" | "dark", BrandTokens> = {
  light: {
    canvas: "#F2F3EE",
    surface: "#FFFFFF",
    ink: "#14201B",
    inkSecondary: "#3F4B45",
    inkMuted: "#5F6A64",
    line: "#DCE0D8",
    accent: "#1F6F5C",
    onAccent: "#FFFFFF",
    signal: "#A8441F",
  },
  dark: {
    canvas: "#0E1512",
    surface: "#151E1A",
    ink: "#E8EEE9",
    inkSecondary: "#B3BDB6",
    inkMuted: "#7E8A83",
    line: "#26332C",
    accent: "#5FBFA5",
    onAccent: "#0E1512",
    signal: "#E58A62",
  },
};
