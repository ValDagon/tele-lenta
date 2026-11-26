/**
 * Saved-search model. Pure functions only: the draft lives in the view form,
 * the network lives in the components, and everything here is testable
 * without a client.
 */

import { toApiError } from "../api/errors";
import type { SavedSearch, Section, SourceListItem } from "../api/types";
import { config } from "../config";
import { plural } from "../lib/plural";
import { relativeTime } from "../lib/time";
import { normalizeQuery } from "../search/model";
import type { SectionFilter } from "../search/section-filter";

export const MAX_SAVED_SEARCHES = 10;
export const MAX_SAVED_SEARCH_NAME = 80;

export interface SavedSearchDraft {
  query: string;
  section: Section | null;
  categories: string[];
  demand: string | null;
  sources: number[];
}

export type SaveError = "limit" | "invalid" | "network";

const categories = config.feed.categories as Record<string, string>;

const SOURCE_FORMS = [
  config.feed.sources.one,
  config.feed.sources.few,
  config.feed.sources.many,
] as const;

function demandLabel(demand: string | null, section: Section | null): string | null {
  if (demand === null) return null;
  const key = demand === "wanted" ? "wanted" : "offer";

  if (section === "jobs") return config.filters.demand.jobs[key];
  if (section === "classifieds") {
    return config.filters.demand.classifieds[key];
  }
  return config.saved.demand[key];
}

function categoryLabel(category: string | undefined): string | null {
  if (category === undefined) return null;
  return categories[category] ?? null;
}

export function draftFromSearch(
  query: string,
  section: SectionFilter,
): SavedSearchDraft {
  return {
    query: normalizeQuery(query),
    section: section === "all" ? null : section,
    categories: [],
    demand: null,
    sources: [],
  };
}

export function draftFromFilters(
  section: Section,
  filters: {
    category: string | null;
    demand: "offer" | "wanted" | null;
    sources: number[];
  },
): SavedSearchDraft {
  return {
    query: "",
    section,
    categories: filters.category === null ? [] : [filters.category],
    demand: filters.demand,
    sources: [...filters.sources],
  };
}

/**
 * A section on its own is a legitimate saved search («the jobs feed»), so
 * empty means no query and no filter at all.
 */
export function draftIsEmpty(draft: SavedSearchDraft): boolean {
  return (
    normalizeQuery(draft.query) === "" &&
    draft.categories.length === 0 &&
    draft.demand === null &&
    draft.sources.length === 0 &&
    draft.section === null
  );
}

/** An empty query is allowed, a one-character query is not. */
export function draftIsValid(draft: SavedSearchDraft): boolean {
  const query = normalizeQuery(draft.query);
  if (query !== "" && query.length < 2) return false;
  return !draftIsEmpty(draft);
}

function resolvedSourceNames(
  ids: readonly number[],
  sources: readonly SourceListItem[],
): string[] {
  const byId = new Map(sources.map((source) => [source.id, source.name]));
  const names: string[] = [];
  for (const id of ids) {
    const name = byId.get(id);
    if (name !== undefined) names.push(name);
  }
  return names;
}

function sourcesPart(
  ids: readonly number[],
  sources: readonly SourceListItem[],
): string | null {
  if (ids.length === 0) return null;

  const names = resolvedSourceNames(ids, sources);
  if (names.length === 0) return null;
  if (names.length <= 3) return names.join(", ");
  return `${names.length} ${plural(names.length, SOURCE_FORMS)}`;
}

function partsOf(
  draft: SavedSearchDraft,
  sources: readonly SourceListItem[],
): string[] {
  const parts: string[] = [];

  const query = normalizeQuery(draft.query);
  if (query !== "") parts.push(query);

  const category = categoryLabel(draft.categories[0]);
  if (category !== null) parts.push(category);

  const demand = demandLabel(draft.demand, draft.section);
  if (demand !== null) parts.push(demand);

  const sourcesLabel = sourcesPart(draft.sources, sources);
  if (sourcesLabel !== null) parts.push(sourcesLabel);

  return parts;
}

function truncateName(name: string): string {
  if (name.length <= MAX_SAVED_SEARCH_NAME) return name;
  return `${name.slice(0, MAX_SAVED_SEARCH_NAME - 1)}…`;
}

/** The auto-generated name; the sheet pre-fills it and the user may rename. */
export function generateName(
  draft: SavedSearchDraft,
  sources: readonly SourceListItem[],
): string {
  const parts = partsOf(draft, sources);
  if (parts.length > 0) return truncateName(parts.join(", "));

  return draft.section === null
    ? config.saved.allFeed
    : config.feed.sections[draft.section];
}

/** The filter line the save sheet shows for the draft about to be saved. */
export function draftSummary(
  draft: SavedSearchDraft,
  sources: readonly SourceListItem[],
): string {
  const parts = partsOf(draft, sources);
  if (parts.length === 0) return config.saved.allFeed;

  const query = normalizeQuery(draft.query);
  if (query !== "") {
    parts[0] = `${config.saved.quotes[0]}${query}${config.saved.quotes[1]}`;
  }

  return parts.join(", ");
}

/** The compact filter line under a saved-search row. */
export function summaryLine(
  saved: SavedSearch,
  _sources: readonly SourceListItem[],
): string {
  const parts: string[] = [];

  const query = normalizeQuery(saved.query ?? "");
  if (query !== "") {
    parts.push(`${config.saved.quotes[0]}${query}${config.saved.quotes[1]}`);
  }

  const category = categoryLabel(saved.categories[0]);
  if (category !== null) parts.push(category);

  const demand = demandLabel(saved.demand, saved.section);
  if (demand !== null) parts.push(demand);

  if (saved.sources.length > 0) {
    parts.push(
      `${saved.sources.length} ${plural(saved.sources.length, SOURCE_FORMS)}`,
    );
  }

  return parts.length > 0 ? parts.join(", ") : config.saved.allFeed;
}

/** «Дайджест: 5 мин» or «Дайджест ещё не приходил». */
export function digestTimeLabel(lastSentAt: string | null, now: number): string {
  if (lastSentAt === null) return config.saved.digestNever;

  const label = relativeTime(lastSentAt, new Date(now));
  if (label === "") return config.saved.digestNever;

  return `${config.saved.digestPrefix} ${label}`;
}

/**
 * A create that fails validation after client-side checks is the per-user
 * limit in practice; the count decides only which copy the sheet shows.
 */
export function saveErrorFor(
  error: unknown,
  currentCount: number,
): SaveError {
  const apiError = toApiError(error);
  if (apiError.code !== "invalid_request") return "network";
  return currentCount >= MAX_SAVED_SEARCHES ? "limit" : "invalid";
}
