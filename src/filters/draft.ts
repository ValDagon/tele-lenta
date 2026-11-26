/**
 * The filter sheet's draft. Pure functions only: the sheet keeps one draft
 * while it is open, and nothing reaches the feed until «Показать» applies it.
 *
 * Closing the sheet throws the draft away, so exploring a filter combination
 * is always safe.
 */

import type { Section, SourceListItem } from "../api/types";
import {
  categoryOptions,
  demandOptions,
  emptyFilters,
  type FeedFilters,
} from "./model";

export interface FilterDraft {
  section: Section;
  filters: FeedFilters;
}

export function createDraft(
  section: Section,
  filters: FeedFilters,
): FilterDraft {
  return {
    section,
    filters: {
      category: filters.category,
      demand: filters.demand,
      sources: [...filters.sources],
    },
  };
}

/**
 * Section carries category and demand meaning between sections: a category
 * that does not exist in the new section is dropped, demand survives only
 * where the section offers demand options, and a source selected in another
 * section is not a valid filter for this one.
 */
export function setDraftSection(
  draft: FilterDraft,
  section: Section,
  sources: readonly SourceListItem[],
): FilterDraft {
  const keepsCategory = categoryOptions(section).length > 0;
  const keepsDemand = demandOptions(section).length > 0;
  const allowed = new Set(
    sources.filter((source) => source.section === section).map(({ id }) => id),
  );

  return {
    section,
    filters: {
      category: keepsCategory ? draft.filters.category : null,
      demand: keepsDemand ? draft.filters.demand : null,
      sources: draft.filters.sources.filter((id) => allowed.has(id)),
    },
  };
}

function withFilters(draft: FilterDraft, filters: FeedFilters): FilterDraft {
  return { ...draft, filters };
}

export function toggleCategory(draft: FilterDraft, value: string): FilterDraft {
  const category = draft.filters.category === value ? null : value;
  return withFilters(draft, { ...draft.filters, category });
}

export function toggleDemand(
  draft: FilterDraft,
  value: "offer" | "wanted",
): FilterDraft {
  const demand = draft.filters.demand === value ? null : value;
  return withFilters(draft, { ...draft.filters, demand });
}

/**
 * Sources stay in ascending id order. The order is part of the request key, so
 * selecting the same set in a different order cannot trigger a second count.
 */
export function toggleSource(draft: FilterDraft, id: number): FilterDraft {
  const selected = draft.filters.sources.includes(id);
  const sources = selected
    ? draft.filters.sources.filter((sourceId) => sourceId !== id)
    : [...draft.filters.sources, id].sort((a, b) => a - b);

  return withFilters(draft, { ...draft.filters, sources });
}

export function resetDraft(draft: FilterDraft): FilterDraft {
  return { section: draft.section, filters: emptyFilters() };
}

export function draftFilters(draft: FilterDraft): FeedFilters {
  return {
    category: draft.filters.category,
    demand: draft.filters.demand,
    sources: [...draft.filters.sources],
  };
}
