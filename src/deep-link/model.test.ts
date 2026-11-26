import { describe, expect, it } from "vitest";

import {
  CARD_START_PREFIX,
  parseStartParam,
  startParamForCard,
} from "./model";

describe("parseStartParam", () => {
  it("reads a card id from the card_ prefix", () => {
    expect(parseStartParam("card_42")).toBe(42);
    expect(parseStartParam("card_1")).toBe(1);
  });

  it("accepts the largest safe integer within the digit cap", () => {
    expect(parseStartParam("card_900719925474099")).toBe(900719925474099);
  });

  it.each([
    ["zero", "card_0"],
    ["negative", "card_-1"],
    ["empty payload", "card_"],
    ["non-numeric", "card_abc"],
    ["missing prefix", "42"],
    ["trailing text", "card_1x"],
    ["leading space", "card_ 1"],
    ["leading zero", "card_01"],
    ["uppercase prefix", "Card_1"],
    ["too many digits", "card_999999999999999999"],
    ["unsafe integer", "card_9007199254740992"],
    ["padded value", " card_1"],
    ["another payload", "search_1"],
  ])("rejects %s", (_label, value) => {
    expect(parseStartParam(value)).toBeNull();
  });

  it("rejects a missing or non-string value", () => {
    expect(parseStartParam(undefined)).toBeNull();
    expect(parseStartParam(null)).toBeNull();
    expect(parseStartParam("")).toBeNull();
    expect(parseStartParam(42 as unknown as string)).toBeNull();
    expect(parseStartParam({} as unknown as string)).toBeNull();
  });

  it("round-trips a card id", () => {
    for (const id of [1, 42, 123456, 900719925474099]) {
      expect(parseStartParam(startParamForCard(id))).toBe(id);
    }
  });
});

describe("startParamForCard", () => {
  it("builds the opaque payload Telegram carries", () => {
    expect(CARD_START_PREFIX).toBe("card_");
    expect(startParamForCard(7)).toBe("card_7");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the invalid id %s",
    (id) => {
      expect(() => startParamForCard(id)).toThrow(RangeError);
    },
  );

  it("refuses an id outside the safe integer range", () => {
    expect(() => startParamForCard(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });
});
