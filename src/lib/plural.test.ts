import { describe, expect, it } from "vitest";

import { plural } from "./plural";

const FORMS = ["объявление", "объявления", "объявлений"] as const;

describe("Russian pluralization", () => {
  it("uses the singular for 1, 21, 101", () => {
    for (const n of [1, 21, 101, 1001]) {
      expect(plural(n, FORMS)).toBe("объявление");
    }
  });

  it("uses the few form for 2–4 and 22–24", () => {
    for (const n of [2, 3, 4, 22, 24, 102]) {
      expect(plural(n, FORMS)).toBe("объявления");
    }
  });

  it("uses the many form for 0, 5–20 and 11–14", () => {
    for (const n of [0, 5, 10, 11, 12, 14, 20, 25, 111]) {
      expect(plural(n, FORMS)).toBe("объявлений");
    }
  });
});
