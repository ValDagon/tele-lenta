/**
 * The live result count for the filter sheet. A pure state machine, in the
 * shape of `src/search/state.ts`.
 *
 * `Telegram.WebApp.Serverless` offers no abort, so supersession is request-id
 * based: every count request carries a growing id, and a response whose id is
 * not the latest is dropped. A slow first request cannot overwrite the answer
 * to a newer filter set.
 */

import type { Section } from "../api/types";
import type { FeedFilters } from "./model";

export const FILTER_COUNT_DEBOUNCE_MS = 250;

export interface CountState {
  /** `null` means «no honest count»: still counting, or the last try failed. */
  total: number | null;
  loading: boolean;
  failed: boolean;
  requestId: number;
}

export type CountAction =
  | { type: "start"; requestId: number }
  | { type: "success"; requestId: number; total: number }
  | { type: "failure"; requestId: number }
  | { type: "reset" };

export function createCountState(): CountState {
  return { total: null, loading: false, failed: false, requestId: 0 };
}

export function countReducer(
  state: CountState,
  action: CountAction,
): CountState {
  switch (action.type) {
    case "start":
      // The old total stays; the button keeps its number instead of flashing
      // «Показать» between two requests.
      return {
        ...state,
        loading: true,
        failed: false,
        requestId: action.requestId,
      };

    case "success": {
      if (state.requestId !== action.requestId) return state;
      return {
        ...state,
        total: action.total,
        loading: false,
        failed: false,
      };
    }

    case "failure": {
      if (state.requestId !== action.requestId) return state;
      // Not zero: zero is a real answer and would be a lie here.
      return { ...state, total: null, loading: false, failed: true };
    }

    case "reset":
      return createCountState();
  }
}

/**
 * A stable key for deduplicating count requests. Sources are sorted
 * numerically, so `[3, 1]` and `[1, 3]` are the same query.
 */
export function countRequestKey(
  section: Section,
  filters: FeedFilters,
): string {
  const sources = [...filters.sources].sort((a, b) => a - b).join(",");
  return [
    section,
    filters.category ?? "",
    filters.demand ?? "",
    sources,
  ].join("|");
}
