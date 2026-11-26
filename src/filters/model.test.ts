import { describe, expect, it } from "vitest";

import type { SourceListItem } from "../api/types";
import {
  activeChips,
  activeFilterCount,
  applyCountResponse,
  applyLabel,
  categoryOptions,
  clearFilters,
  countAnnouncement,
  demandOptions,
  emptyFilters,
  isFiltered,
  removeChip,
  toFeedInput,
  type FeedFilters,
} from "./model";

function source(id: number, name: string): SourceListItem {
  return {
    id,
    username: `chat_${id}`,
    name,
    monogram: name.slice(0, 1),
    kind: "group",
    section: "classifieds",
  };
}

function filters(patch: Partial<FeedFilters> = {}): FeedFilters {
  return { ...emptyFilters(), ...patch };
}

describe("emptyFilters", () => {
  it("starts with nothing selected", () => {
    const state = emptyFilters();

    expect(state.category).toBeNull();
    expect(state.demand).toBeNull();
    expect(state.sources).toEqual([]);
    expect(isFiltered(state)).toBe(false);
    expect(activeFilterCount(state)).toBe(0);
  });

  it("clearFilters is the same empty state", () => {
    expect(clearFilters()).toEqual(emptyFilters());
  });
});

describe("categoryOptions", () => {
  it("offers the five categories for classifieds with their labels", () => {
    const options = categoryOptions("classifieds");

    expect(options.map((option) => option.value)).toEqual([
      "real_estate",
      "auto",
      "goods",
      "services",
      "other",
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "Недвижимость",
      "Авто",
      "Вещи",
      "Услуги",
      "Другое",
    ]);
  });

  it("hides categories in jobs and events", () => {
    expect(categoryOptions("jobs")).toEqual([]);
    expect(categoryOptions("events")).toEqual([]);
  });
});

describe("demandOptions", () => {
  it("uses the classifieds wording", () => {
    expect(demandOptions("classifieds")).toEqual([
      { value: "offer", label: "Предлагаю" },
      { value: "wanted", label: "Куплю/Ищу" },
    ]);
  });

  it("uses the jobs wording", () => {
    expect(demandOptions("jobs")).toEqual([
      { value: "offer", label: "Предлагаю работу" },
      { value: "wanted", label: "Ищу работу" },
    ]);
  });

  it("hides demand in events", () => {
    expect(demandOptions("events")).toEqual([]);
  });
});

describe("toFeedInput", () => {
  it("sends only the section when nothing is narrowed", () => {
    const input = toFeedInput("classifieds", emptyFilters());

    expect(input).toEqual({ section: "classifieds" });
    expect("category" in input).toBe(false);
    expect("demand" in input).toBe(false);
    expect("sources" in input).toBe(false);
  });

  it("sends every selected narrow", () => {
    const input = toFeedInput(
      "jobs",
      filters({ category: "auto", demand: "wanted", sources: [7] }),
    );

    expect(input).toEqual({
      section: "jobs",
      category: "auto",
      demand: "wanted",
      sources: [7],
    });
  });

  it("never sends an empty sources array", () => {
    const input = toFeedInput("events", filters({ sources: [] }));

    expect("sources" in input).toBe(false);
    expect(input).toEqual({ section: "events" });
  });
});

describe("activeFilterCount", () => {
  it("counts category, demand, and each source separately", () => {
    expect(activeFilterCount(filters({ category: "goods" }))).toBe(1);
    expect(
      activeFilterCount(filters({ category: "goods", demand: "offer" })),
    ).toBe(2);
    expect(
      activeFilterCount(
        filters({ category: "goods", demand: "offer", sources: [1, 2, 3] }),
      ),
    ).toBe(5);
  });
});

describe("activeChips", () => {
  const sources = [source(3, "Барахолка"), source(1, "Продажа"), source(2, "Авто")];

  it("orders category, demand, then sources in list order", () => {
    const chips = activeChips(
      "classifieds",
      filters({ category: "auto", demand: "wanted", sources: [1, 2] }),
      sources,
    );

    expect(chips).toEqual([
      { key: "category", label: "Авто" },
      { key: "demand", label: "Куплю/Ищу" },
      { key: "source:1", label: "Продажа" },
      { key: "source:2", label: "Авто" },
    ]);
  });

  it("skips a selected source that is not in the list", () => {
    const chips = activeChips(
      "classifieds",
      filters({ sources: [1, 99] }),
      sources,
    );

    expect(chips.map((chip) => chip.key)).toEqual(["source:1"]);
  });

  it("uses the section wording for demand", () => {
    const chips = activeChips("jobs", filters({ demand: "offer" }), sources);

    expect(chips).toEqual([{ key: "demand", label: "Предлагаю работу" }]);
  });

  it("is empty when nothing is narrowed", () => {
    expect(activeChips("classifieds", emptyFilters(), sources)).toEqual([]);
  });
});

describe("removeChip", () => {
  it("removes only the named source and leaves the rest", () => {
    const before = filters({ category: "auto", sources: [1, 2, 3] });
    const after = removeChip("classifieds", before, "source:2");

    expect(after).toEqual({ category: "auto", demand: null, sources: [1, 3] });
    expect(before.sources).toEqual([1, 2, 3]);
  });

  it("clears the category or demand on their own key", () => {
    const before = filters({ category: "auto", demand: "offer" });

    expect(removeChip("classifieds", before, "category").category).toBeNull();
    expect(removeChip("classifieds", before, "demand").demand).toBeNull();
    expect(before.category).toBe("auto");
    expect(before.demand).toBe("offer");
  });
});

describe("applyLabel", () => {
  it("omits the number when the count is unavailable", () => {
    expect(applyLabel(null, "classifieds")).toBe("Показать");
    expect(applyLabel(null, "jobs")).toBe("Показать");
    expect(applyLabel(null, "events")).toBe("Показать");
  });

  it("pluralizes classifieds", () => {
    expect(applyLabel(0, "classifieds")).toBe("Показать 0 объявлений");
    expect(applyLabel(1, "classifieds")).toBe("Показать 1 объявление");
    expect(applyLabel(2, "classifieds")).toBe("Показать 2 объявления");
    expect(applyLabel(5, "classifieds")).toBe("Показать 5 объявлений");
    expect(applyLabel(11, "classifieds")).toBe("Показать 11 объявлений");
    expect(applyLabel(21, "classifieds")).toBe("Показать 21 объявление");
  });

  it("pluralizes jobs", () => {
    expect(applyLabel(1, "jobs")).toBe("Показать 1 вакансию");
    expect(applyLabel(3, "jobs")).toBe("Показать 3 вакансии");
    expect(applyLabel(12, "jobs")).toBe("Показать 12 вакансий");
  });

  it("pluralizes events", () => {
    expect(applyLabel(1, "events")).toBe("Показать 1 мероприятие");
    expect(applyLabel(4, "events")).toBe("Показать 4 мероприятия");
    expect(applyLabel(22, "events")).toBe("Показать 22 мероприятия");
    expect(applyLabel(25, "events")).toBe("Показать 25 мероприятий");
  });
});

describe("applyCountResponse", () => {
  it("passes a normal total through", () => {
    expect(applyCountResponse({ total: 128 })).toBe(128);
  });

  it("clamps a negative total to zero", () => {
    expect(applyCountResponse({ total: -5 })).toBe(0);
  });

  it("truncates a fractional total", () => {
    expect(applyCountResponse({ total: 12.9 })).toBe(12);
  });

  it("treats a non-finite total as zero", () => {
    expect(applyCountResponse({ total: Number.NaN })).toBe(0);
  });
});

describe("countAnnouncement", () => {
  it("says nothing while the count is unavailable", () => {
    expect(countAnnouncement(null, "classifieds")).toBe("");
  });

  it("announces the found total with the section noun", () => {
    expect(countAnnouncement(1, "classifieds")).toBe("Найдено 1 объявление");
    expect(countAnnouncement(5, "classifieds")).toBe("Найдено 5 объявлений");
    expect(countAnnouncement(21, "jobs")).toBe("Найдено 21 вакансия");
    expect(countAnnouncement(3, "events")).toBe("Найдено 3 мероприятия");
  });
});
