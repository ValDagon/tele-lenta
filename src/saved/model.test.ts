import { describe, expect, it } from "vitest";

import { ApiError } from "../api/errors";
import type { SavedSearch, SourceListItem } from "../api/types";
import {
  digestTimeLabel,
  draftFromFilters,
  draftFromSearch,
  draftIsEmpty,
  draftIsValid,
  generateName,
  MAX_SAVED_SEARCHES,
  saveErrorFor,
  summaryLine,
  type SavedSearchDraft,
} from "./model";

function source(id: number, name: string): SourceListItem {
  return {
    id,
    name,
    username: `source_${id}`,
    monogram: name.charAt(0),
    kind: "group",
    section: "classifieds",
  };
}

const SOURCES: SourceListItem[] = [
  source(1, "Baraholka"),
  source(2, "Sale ME"),
  source(3, "Nekretnine"),
  source(4, "Auto ME"),
  source(5, "Jobs ME"),
];

function draft(patch: Partial<SavedSearchDraft> = {}): SavedSearchDraft {
  return {
    query: "",
    section: null,
    categories: [],
    demand: null,
    sources: [],
    ...patch,
  };
}

function saved(patch: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 1,
    name: "Поиск",
    query: "",
    section: null,
    categories: [],
    demand: null,
    sources: [],
    enabled: true,
    last_checked_at: "2026-11-05T10:00:00.000Z",
    last_sent_at: null,
    created_at: "2026-11-01T10:00:00.000Z",
    ...patch,
  };
}

describe("draftFromSearch", () => {
  it("normalizes the query and maps «Все» to no section", () => {
    expect(draftFromSearch("  лодка   в Баре ", "all")).toEqual({
      query: "лодка в Баре",
      section: null,
      categories: [],
      demand: null,
      sources: [],
    });
  });

  it("keeps a concrete section", () => {
    expect(draftFromSearch("лодка", "jobs").section).toBe("jobs");
  });
});

describe("draftFromFilters", () => {
  it("turns a single category into an array and copies the sources", () => {
    const filters = {
      category: "real_estate",
      demand: "wanted" as const,
      sources: [2, 1],
    };
    const result = draftFromFilters("classifieds", filters);

    expect(result).toEqual({
      query: "",
      section: "classifieds",
      categories: ["real_estate"],
      demand: "wanted",
      sources: [2, 1],
    });

    result.sources.push(9);
    expect(filters.sources).toEqual([2, 1]);
  });

  it("leaves an empty category out", () => {
    expect(
      draftFromFilters("jobs", {
        category: null,
        demand: null,
        sources: [],
      }).categories,
    ).toEqual([]);
  });
});

describe("draft emptiness and validity", () => {
  it("treats a bare section as a legitimate saved search", () => {
    const section = draft({ section: "jobs" });
    expect(draftIsEmpty(section)).toBe(false);
    expect(draftIsValid(section)).toBe(true);
  });

  it("rejects a draft with nothing in it", () => {
    expect(draftIsEmpty(draft())).toBe(true);
    expect(draftIsValid(draft())).toBe(false);
  });

  it("rejects a one-character query", () => {
    expect(draftIsValid(draft({ query: "a" }))).toBe(false);
    expect(draftIsValid(draft({ query: " ab " }))).toBe(true);
  });
});

describe("generateName", () => {
  it("uses the query alone", () => {
    expect(generateName(draftFromSearch("лодка", "all"), SOURCES)).toBe(
      "лодка",
    );
  });

  it("joins category, demand, and source in that order", () => {
    const result = generateName(
      draftFromFilters("classifieds", {
        category: "real_estate",
        demand: "wanted",
        sources: [1],
      }),
      SOURCES,
    );

    expect(result).toBe("Недвижимость, Куплю/Ищу, Baraholka");
  });

  it("puts the query first in a combination", () => {
    const result = generateName(
      draft({
        query: "лодка",
        section: "classifieds",
        categories: ["auto"],
        demand: "offer",
        sources: [2],
      }),
      SOURCES,
    );

    expect(result).toBe("лодка, Авто, Предлагаю, Sale ME");
  });

  it("lists two or three source names and counts more", () => {
    expect(
      generateName(
        draft({ section: "classifieds", sources: [1, 2, 3] }),
        SOURCES,
      ),
    ).toBe("Baraholka, Sale ME, Nekretnine");

    expect(
      generateName(
        draft({ section: "classifieds", sources: [1, 2, 3, 4] }),
        SOURCES,
      ),
    ).toBe("4 источника");
  });

  it("uses the section meaning for demand labels", () => {
    expect(
      generateName(
        draft({ section: "jobs", demand: "offer" }),
        SOURCES,
      ),
    ).toBe("Предлагаю работу");
  });

  it("skips a source id it does not know", () => {
    expect(
      generateName(draft({ section: "classifieds", sources: [99, 1] }), SOURCES),
    ).toBe("Baraholka");
  });

  it("falls back to the section, then to the whole feed", () => {
    expect(generateName(draft({ section: "classifieds" }), SOURCES)).toBe(
      "Объявления",
    );
    expect(generateName(draft(), SOURCES)).toBe("Вся лента");
  });

  it("caps the name at 80 characters with an ellipsis", () => {
    const name = generateName(draft({ query: "я".repeat(100) }), SOURCES);

    expect(name).toHaveLength(80);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("summaryLine", () => {
  it("quotes the query and joins the filters", () => {
    const line = summaryLine(
      saved({
        query: "лодка",
        section: "classifieds",
        categories: ["auto"],
        demand: "offer",
        sources: [1, 2],
      }),
      SOURCES,
    );

    expect(line).toBe("«лодка», Авто, Предлагаю, 2 источника");
  });

  it("falls back to the whole feed when nothing is set", () => {
    expect(summaryLine(saved(), SOURCES)).toBe("Вся лента");
  });
});

describe("digestTimeLabel", () => {
  const now = Date.parse("2026-11-05T11:00:00.000Z");

  it("says the digest has not arrived yet", () => {
    expect(digestTimeLabel(null, now)).toBe("Дайджест ещё не приходил");
  });

  it("prefixes the relative time", () => {
    expect(digestTimeLabel("2026-11-05T10:30:00.000Z", now)).toBe(
      "Дайджест: 30 мин",
    );
  });

  it("does not show a bare prefix for an unparseable date", () => {
    expect(digestTimeLabel("not a date", now)).toBe(
      "Дайджест ещё не приходил",
    );
  });
});

describe("saveErrorFor", () => {
  it("calls an invalid request at the limit a limit error", () => {
    expect(
      saveErrorFor(
        new ApiError("invalid_request"),
        MAX_SAVED_SEARCHES,
      ),
    ).toBe("limit");
  });

  it("keeps other invalid requests as invalid", () => {
    expect(saveErrorFor(new ApiError("invalid_request"), 3)).toBe("invalid");
  });

  it("maps everything else to a network error", () => {
    expect(saveErrorFor(new ApiError("upstream_unavailable"), 3)).toBe(
      "network",
    );
    expect(saveErrorFor(new Error("boom"), 3)).toBe("network");
  });
});
