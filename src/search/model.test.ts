import { describe, expect, it } from "vitest";

import type { Card } from "../api/types";
import {
  isSearchable,
  normalizeQuery,
  resultCountLabel,
  searchAnnouncement,
  searchPhase,
} from "./model";
import {
  parseSectionFilter,
  sectionFilterLabel,
  sectionFilterParam,
  SECTION_FILTERS,
} from "./section-filter";
import { createSearchState, type SearchState } from "./state";

function card(id: number): Card {
  return {
    id,
    section: "classifieds",
    category: "goods",
    demand: "offer",
    title: `Объявление ${id}`,
    earliest_published_at: "2026-11-05T09:00:00.000Z",
    sources: [{ id: 1, username: "chat", name: "Чат", monogram: "Ч" }],
    source_count: 1,
  };
}

function state(overrides: Partial<SearchState> = {}): SearchState {
  return { ...createSearchState(), ...overrides };
}

describe("query normalization", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeQuery("  Подгорица   у  моря ")).toBe("Подгорица у моря");
  });

  it("needs two characters, as the server does", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("я")).toBe(false);
    expect(isSearchable(" я ")).toBe(false);
    expect(isSearchable("  ло ")).toBe(true);
    expect(isSearchable("лодка")).toBe(true);
  });
});

describe("section selector", () => {
  it("maps «Все» to no section parameter", () => {
    expect(sectionFilterParam("all")).toBeUndefined();
    expect(sectionFilterParam("jobs")).toBe("jobs");
  });

  it("labels every option", () => {
    expect(SECTION_FILTERS.map(sectionFilterLabel)).toEqual([
      "Все",
      "Объявления",
      "Вакансии",
      "Мероприятия",
    ]);
  });

  it("falls back to «Все» for an unknown select value", () => {
    expect(parseSectionFilter("events")).toBe("events");
    expect(parseSectionFilter("nope")).toBe("all");
  });
});

describe("result count copy", () => {
  it("pluralizes Russian counts", () => {
    expect(resultCountLabel(1)).toBe("1 результат");
    expect(resultCountLabel(2)).toBe("2 результата");
    expect(resultCountLabel(5)).toBe("5 результатов");
    expect(resultCountLabel(11)).toBe("11 результатов");
    expect(resultCountLabel(21)).toBe("21 результат");
    expect(resultCountLabel(112)).toBe("112 результатов");
  });

  it("never shows a negative or fractional count", () => {
    expect(resultCountLabel(-3)).toBe("0 результатов");
    expect(resultCountLabel(2.7)).toBe("2 результата");
  });
});

describe("search surface selection", () => {
  it("is idle with an empty query, whatever the old results were", () => {
    const loaded = state({ cards: [card(1)], initialized: true });

    expect(searchPhase("", loaded)).toBe("idle");
    expect(searchPhase("   ", loaded)).toBe("idle");
  });

  it("asks for two characters before searching", () => {
    expect(searchPhase("я", state())).toBe("tooShort");
  });

  it("keeps the results phase while the next query loads", () => {
    const loaded = state({
      cards: [card(1)],
      initialized: true,
      loading: true,
      activeQuery: "лодка",
    });

    expect(searchPhase("лодка с мотором", loaded)).toBe("results");
  });

  it("shows searching before the first answer", () => {
    expect(searchPhase("лодка", state({ loading: true }))).toBe("searching");
    expect(searchPhase("лодка", state())).toBe("searching");
  });

  it("distinguishes no results from a failed search", () => {
    expect(
      searchPhase("лодка", state({ initialized: true, activeQuery: "лодка" })),
    ).toBe("empty");
    expect(searchPhase("лодка", state({ error: true }))).toBe("error");
  });

  it("announces the count, the empty state, and errors; not loading", () => {
    expect(
      searchAnnouncement("лодка", state({ cards: [card(1)], total: 12 })),
    ).toBe("12 результатов");
    expect(
      searchAnnouncement("лодка", state({ initialized: true })),
    ).toContain("Ничего не нашлось");
    expect(searchAnnouncement("лодка", state({ error: true }))).toContain(
      "Не удалось выполнить поиск",
    );
    expect(searchAnnouncement("лодка", state({ loading: true }))).toBe("");
    expect(searchAnnouncement("", state())).toBe("");
  });
});
