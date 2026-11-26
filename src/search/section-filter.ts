import type { Section } from "../api/types";
import { config } from "../config";

/**
 * The search section selector is a superset of the feed sections: «Все» is the
 * default, and the three sections narrow the same cross-section query.
 */
export type SectionFilter = "all" | Section;

export const SECTION_FILTERS: ReadonlyArray<SectionFilter> = [
  "all",
  "classifieds",
  "jobs",
  "events",
];

export function sectionFilterLabel(filter: SectionFilter): string {
  return filter === "all"
    ? config.search.allSections
    : config.feed.sections[filter];
}

/** The `section` query parameter; «Все» means the server's cross-section mode. */
export function sectionFilterParam(filter: SectionFilter): Section | undefined {
  return filter === "all" ? undefined : filter;
}

/** A `<select>` value is a plain string, so an unknown value falls back to «Все». */
export function parseSectionFilter(value: string): SectionFilter {
  return (SECTION_FILTERS as ReadonlyArray<string>).includes(value)
    ? (value as SectionFilter)
    : "all";
}
