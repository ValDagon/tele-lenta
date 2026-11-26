import { config } from "../config";
import { plural } from "../lib/plural";
import type { SearchState } from "./state";

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_PAGE_SIZE = 20;

/** One normalized query: trimmed, inner whitespace collapsed. */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * The server ignores queries shorter than two characters, so the screen does
 * too rather than sending a request that can only come back empty.
 */
export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= SEARCH_MIN_QUERY_LENGTH;
}

/** «12 результатов» with Russian pluralization. */
export function resultCountLabel(total: number): string {
  const count = Math.max(0, Math.trunc(total));
  return `${count} ${plural(count, config.search.results)}`;
}

/**
 * What the screen below the input shows. It is derived from the typed query and
 * the state of the *displayed* results, so a loading query keeps the previous
 * result list in place instead of flashing an empty state.
 */
export type SearchPhase =
  | "idle"
  | "tooShort"
  | "searching"
  | "results"
  | "empty"
  | "error";

export function searchPhase(input: string, state: SearchState): SearchPhase {
  const query = normalizeQuery(input);

  if (query === "") return "idle";
  if (query.length < SEARCH_MIN_QUERY_LENGTH) return "tooShort";

  if (state.cards.length > 0) return "results";
  if (state.loading) return "searching";
  if (state.error) return "error";
  if (state.initialized) return "empty";

  // A searchable query with nothing requested yet: the debounce is about to
  // fire. Showing the idle state would be a lie.
  return "searching";
}

/**
 * The single polite live region's text. Loading is deliberately not announced:
 * the thin progress bar is the visual signal and «Ищем» would only add noise.
 */
export function searchAnnouncement(
  input: string,
  state: SearchState,
): string {
  switch (searchPhase(input, state)) {
    case "results":
      return resultCountLabel(state.total);
    case "empty":
      return config.search.empty;
    case "error":
      return config.search.loadError;
    case "tooShort":
      return config.search.tooShort;
    default:
      return "";
  }
}
