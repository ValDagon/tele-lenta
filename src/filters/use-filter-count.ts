import { useEffect, useReducer, useRef } from "preact/hooks";

import type { ApiClient } from "../api/client";
import type { Section } from "../api/types";
import {
  countReducer,
  countRequestKey,
  createCountState,
  FILTER_COUNT_DEBOUNCE_MS,
} from "./count";
import { applyCountResponse, toFeedInput, type FeedFilters } from "./model";

export interface UseFilterCountInput {
  client: ApiClient;
  /** The sheet is open and the reader is allowed in. */
  enabled: boolean;
  section: Section;
  filters: FeedFilters;
}

export interface FilterCount {
  total: number | null;
  loading: boolean;
  failed: boolean;
}

/**
 * Thin wiring around `count.ts`: debounce, one in-flight count at a time
 * (request-id, no AbortController), and no rejection escaping to the caller.
 * A closed sheet resets the state, so reopening always asks again.
 */
export function useFilterCount({
  client,
  enabled,
  section,
  filters,
}: UseFilterCountInput): FilterCount {
  const [state, dispatch] = useReducer(countReducer, undefined, createCountState);
  const requestId = useRef(0);
  // The key captures section and filters, so an equal filter set does not
  // trigger a second request on a re-render.
  const key = countRequestKey(section, filters);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "reset" });
      return;
    }

    const id = ++requestId.current;

    const timer = setTimeout(() => {
      dispatch({ type: "start", requestId: id });

      client
        .feed({ ...toFeedInput(section, filters), limit: 0 })
        .then((response) => {
          dispatch({
            type: "success",
            requestId: id,
            total: applyCountResponse(response),
          });
        })
        .catch(() => {
          dispatch({ type: "failure", requestId: id });
        });
    }, FILTER_COUNT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `key` already covers `section` and `filters`; `filters` is read from the
    // render that created this effect, so it cannot go stale.
  }, [client, enabled, key]);

  return { total: state.total, loading: state.loading, failed: state.failed };
}
