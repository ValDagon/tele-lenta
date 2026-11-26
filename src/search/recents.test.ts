import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRecents,
  mergeRecent,
  parseRecents,
  readRecents,
  rememberQuery,
  SEARCH_RECENTS_KEY,
} from "./recents";

beforeEach(() => {
  window.localStorage.clear();
});

describe("recent searches", () => {
  it("puts the newest query first", () => {
    expect(mergeRecent(["лодка"], "квартира")).toEqual(["квартира", "лодка"]);
  });

  it("dedupes regardless of case and spacing", () => {
    const list = ["Лодка  с мотором", "квартира"];

    expect(mergeRecent(list, " лодка с мотором ")).toEqual([
      "лодка с мотором",
      "квартира",
    ]);
  });

  it("caps the list at five", () => {
    let list: string[] = [];
    for (const query of ["один", "два", "три", "четыре", "пять", "шесть"]) {
      list = mergeRecent(list, query);
    }

    expect(list).toHaveLength(5);
    expect(list[0]).toBe("шесть");
    expect(list).not.toContain("один");
  });

  it("never stores a one-character or empty query", () => {
    expect(mergeRecent(["лодка"], "я")).toEqual(["лодка"]);
    expect(mergeRecent(["лодка"], "   ")).toEqual(["лодка"]);
  });

  it("normalizes the stored query", () => {
    expect(mergeRecent([], "  две   комнаты ")).toEqual(["две комнаты"]);
  });

  it("persists, reads back, and clears", () => {
    rememberQuery("Подгорица");
    rememberQuery("лодка");

    expect(readRecents()).toEqual(["лодка", "Подгорица"]);

    clearRecents();

    expect(readRecents()).toEqual([]);
    expect(window.localStorage.getItem(SEARCH_RECENTS_KEY)).toBeNull();
  });

  it("survives a corrupt or foreign payload", () => {
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents('["лодка", 3, "", "я", "Лодка"]')).toEqual(["лодка"]);
  });
});
