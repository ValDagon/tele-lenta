/**
 * The filter model. Pure types and functions: no Preact, no network.
 *
 * A section is not stored inside `FeedFilters`. Filters live per section,
 * keyed by `Section` (`Record<Section, FeedFilters>`), so switching tabs never
 * carries a category from one section into another.
 */

import type {
  FeedInput,
  FeedResponse,
  Section,
  SourceListItem,
} from "../api/types";
import { config } from "../config";
import { plural } from "../lib/plural";

export interface FeedFilters {
  category: string | null;
  demand: "offer" | "wanted" | null;
  sources: number[];
}

export interface FilterOption<T> {
  value: T;
  label: string;
}

export type FilterChipKey = "category" | "demand" | `source:${number}`;

export interface FilterChip {
  key: FilterChipKey;
  label: string;
}

/** Category ids, in the order the sheet shows them. */
const CLASSIFIEDS_CATEGORIES = [
  "real_estate",
  "auto",
  "goods",
  "services",
  "other",
] as const;

export function emptyFilters(): FeedFilters {
  return { category: null, demand: null, sources: [] };
}

export function clearFilters(): FeedFilters {
  return emptyFilters();
}

export function isFiltered(filters: FeedFilters): boolean {
  return (
    filters.category !== null ||
    filters.demand !== null ||
    filters.sources.length > 0
  );
}

/**
 * The badge on the filter button. Each source counts as one, so the badge
 * number matches the number of chips under the tabs.
 */
export function activeFilterCount(filters: FeedFilters): number {
  return (
    (filters.category === null ? 0 : 1) +
    (filters.demand === null ? 0 : 1) +
    filters.sources.length
  );
}

/**
 * The feed query for this filter set. `sources` is omitted when nothing is
 * selected: an empty array is `invalid_request` on the server, while an absent
 * parameter means «all sources».
 */
export function toFeedInput(
  section: Section,
  filters: FeedFilters,
): Pick<FeedInput, "section" | "category" | "demand" | "sources"> {
  return {
    section,
    ...(filters.category === null ? {} : { category: filters.category }),
    ...(filters.demand === null ? {} : { demand: filters.demand }),
    ...(filters.sources.length === 0
      ? {}
      : { sources: [...filters.sources] }),
  };
}

export function categoryOptions(
  section: Section,
): ReadonlyArray<FilterOption<string>> {
  if (section !== "classifieds") return [];

  return CLASSIFIEDS_CATEGORIES.map((value) => ({
    value,
    label: config.feed.categories[value],
  }));
}

export function demandOptions(
  section: Section,
): ReadonlyArray<FilterOption<"offer" | "wanted">> {
  if (section === "classifieds") {
    const { offer, wanted } = config.filters.demand.classifieds;
    return [
      { value: "offer", label: offer },
      { value: "wanted", label: wanted },
    ];
  }

  if (section === "jobs") {
    const { offer, wanted } = config.filters.demand.jobs;
    return [
      { value: "offer", label: offer },
      { value: "wanted", label: wanted },
    ];
  }

  return [];
}

function categoryLabel(category: string): string | undefined {
  return (config.feed.categories as Record<string, string>)[category];
}

/**
 * The chips under the tabs, in a stable order: category, demand, then sources
 * in the order of `sources` (which is the order the sheet renders them in).
 * A selected source that is no longer in the list is not rendered.
 */
export function activeChips(
  section: Section,
  filters: FeedFilters,
  sources: readonly SourceListItem[],
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.category !== null) {
    const label = categoryLabel(filters.category);
    if (label !== undefined) chips.push({ key: "category", label });
  }

  if (filters.demand !== null) {
    const option = demandOptions(section).find(
      (candidate) => candidate.value === filters.demand,
    );
    if (option !== undefined) chips.push({ key: "demand", label: option.label });
  }

  for (const source of sources) {
    if (!filters.sources.includes(source.id)) continue;
    chips.push({ key: `source:${source.id}`, label: source.name });
  }

  return chips;
}

export function removeChip(
  _section: Section,
  filters: FeedFilters,
  key: FilterChipKey,
): FeedFilters {
  if (key === "category") return { ...filters, category: null };
  if (key === "demand") return { ...filters, demand: null };

  const id = Number(key.slice("source:".length));
  return {
    ...filters,
    sources: filters.sources.filter((sourceId) => sourceId !== id),
  };
}

/** Keeps the apply button arithmetic out of the UI. */
export function applyCountResponse(
  response: Pick<FeedResponse, "total">,
): number {
  const total = Math.trunc(response.total);
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

/**
 * The primary button's label. A `null` total means «the count is unavailable»:
 * the number is omitted rather than faked.
 */
export function applyLabel(total: number | null, section: Section): string {
  if (total === null || !Number.isFinite(total)) return config.filters.apply;

  const count = Math.max(0, Math.trunc(total));
  return `${config.filters.apply} ${count} ${plural(
    count,
    config.filters.applyAccusative[section],
  )}`;
}

/**
 * The polite live region. `null` means «no honest count yet»; the hook's
 * `failed` flag is what renders «Не удалось посчитать» in that case. This
 * function never says «0» for an unknown total.
 */
export function countAnnouncement(
  total: number | null,
  section: Section,
): string {
  if (total === null || !Number.isFinite(total)) return "";

  const count = Math.max(0, Math.trunc(total));
  return `${config.filters.found} ${count} ${plural(
    count,
    config.filters.applyNouns[section],
  )}`;
}
