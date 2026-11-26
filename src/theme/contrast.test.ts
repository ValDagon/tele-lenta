import { describe, expect, it } from "vitest";

import { resolveTheme } from "./apply";
import { contrastRatio, pickReadable } from "./contrast";
import { resolveTelegramTheme } from "./telegram";
import { brandTokens } from "./tokens";

describe("contrast", () => {
  it("knows black on white is 21:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("returns 0 for an invalid colour", () => {
    expect(contrastRatio("not-a-colour", "#FFFFFF")).toBe(0);
  });

  it("picks the first readable candidate", () => {
    expect(pickReadable("#FFFFFF", ["#EEEEEE", "#000000"])).toBe("#000000");
  });
});

describe("Telegram theme guard", () => {
  it("keeps a readable Telegram pair", () => {
    const result = resolveTelegramTheme(
      {
        bg_color: "#F2F3EE",
        text_color: "#14201B",
        hint_color: "#5F6A64",
      },
      "light",
    );

    expect(result.canvas).toBe("#F2F3EE");
    expect(result.ink).toBe("#14201B");
    expect(result.inkMuted).toBe("#5F6A64");
  });

  it("falls back to brand ink when Telegram text fails 4.5:1", () => {
    const result = resolveTelegramTheme(
      {
        bg_color: "#FFFFFF",
        text_color: "#EEEEEE",
        hint_color: "#EEEEEE",
        link_color: "#FF0000",
      },
      "light",
    );

    expect(result.ink).toBe(brandTokens.light.ink);
    expect(result.inkMuted).toBe(brandTokens.light.inkMuted);
    expect(result.accent).toBe(brandTokens.light.accent);
  });
});

describe("theme mode resolution", () => {
  it("uses Telegram in auto mode", () => {
    expect(resolveTheme("auto", "dark", false)).toBe("dark");
  });

  it("uses the manual override over Telegram", () => {
    expect(resolveTheme("light", "dark", true)).toBe("light");
  });

  it("falls back to the OS preference without Telegram", () => {
    expect(resolveTheme("auto", undefined, true)).toBe("dark");
  });
});
