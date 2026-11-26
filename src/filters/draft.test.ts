import { describe, expect, it } from "vitest";

import type { SourceListItem } from "../api/types";
import {
  createDraft,
  draftFilters,
  resetDraft,
  setDraftSection,
  toggleCategory,
  toggleDemand,
  toggleSource,
} from "./draft";
import type { FeedFilters } from "./model";

function source(
  id: number,
  section: SourceListItem["section"],
): SourceListItem {
  return {
    id,
    username: `chat_${id}`,
    name: `Чат ${id}`,
    monogram: "Ч",
    kind: "group",
    section,
  };
}

const SOURCES: SourceListItem[] = [
  source(1, "classifieds"),
  source(2, "jobs"),
  source(3, "classifieds"),
  source(4, "events"),
];

const filters: FeedFilters = {
  category: "real_estate",
  demand: "offer",
  sources: [1, 2, 3],
};

describe("filter draft", () => {
  it("copies the applied filters instead of aliasing the source array", () => {
    const draft = createDraft("classifieds", filters);

    draft.filters.sources.push(99);

    expect(filters.sources).toEqual([1, 2, 3]);
    expect(draft.filters.category).toBe("real_estate");
    expect(draft.filters.demand).toBe("offer");
  });

  it("prunes the category, demand, and foreign sources on a section change", () => {
    const classifieds = createDraft("classifieds", filters);

    const jobs = setDraftSection(classifieds, "jobs", SOURCES);
    expect(jobs.section).toBe("jobs");
    expect(jobs.filters.category).toBeNull();
    expect(jobs.filters.demand).toBe("offer");
    expect(jobs.filters.sources).toEqual([2]);

    const events = setDraftSection(jobs, "events", SOURCES);
    expect(events.filters.category).toBeNull();
    expect(events.filters.demand).toBeNull();
    expect(events.filters.sources).toEqual([]);
  });

  it("keeps a demand choice only where the section offers demand options", () => {
    const wanted = createDraft("jobs", {
      category: null,
      demand: "wanted",
      sources: [],
    });

    expect(setDraftSection(wanted, "jobs", SOURCES).filters.demand).toBe(
      "wanted",
    );
    expect(setDraftSection(wanted, "events", SOURCES).filters.demand).toBeNull();
  });

  it("clears the category when the new section has no categories", () => {
    const draft = createDraft("classifieds", {
      category: "auto",
      demand: null,
      sources: [],
    });

    expect(setDraftSection(draft, "jobs", SOURCES).filters.category).toBeNull();
    expect(
      setDraftSection(draft, "classifieds", SOURCES).filters.category,
    ).toBe("auto");
  });

  it("toggles a category off on a second click", () => {
    const draft = toggleCategory(createDraft("classifieds", filters), "auto");
    expect(draft.filters.category).toBe("auto");

    expect(toggleCategory(draft, "auto").filters.category).toBeNull();
  });

  it("toggles demand off on a second click", () => {
    const draft = toggleDemand(createDraft("jobs", filters), "wanted");
    expect(draft.filters.demand).toBe("wanted");

    expect(toggleDemand(draft, "wanted").filters.demand).toBeNull();
  });

  it("keeps selected sources in ascending id order", () => {
    let draft = createDraft("classifieds", {
      category: null,
      demand: null,
      sources: [],
    });

    draft = toggleSource(draft, 9);
    draft = toggleSource(draft, 2);
    draft = toggleSource(draft, 5);

    expect(draft.filters.sources).toEqual([2, 5, 9]);
    expect(toggleSource(draft, 5).filters.sources).toEqual([2, 9]);
    expect(toggleSource(draft, 5).filters.sources).toEqual([2, 9]);
  });

  it("resets filters but keeps the chosen section", () => {
    const draft = resetDraft(createDraft("jobs", filters));

    expect(draft.section).toBe("jobs");
    expect(draft.filters).toEqual({ category: null, demand: null, sources: [] });
  });

  it("hands out a copy of the draft filters", () => {
    const draft = createDraft("classifieds", filters);
    const applied = draftFilters(draft);

    applied.sources.push(42);

    expect(draft.filters.sources).toEqual([1, 2, 3]);
  });
});
