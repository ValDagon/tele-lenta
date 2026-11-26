import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";

import type { ApiClient } from "../api/client";
import {
  isSearchable,
  normalizeQuery,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
} from "./model";
import { rememberQuery } from "./recents";
import {
  sectionFilterParam,
  type SectionFilter,
} from "./section-filter";
import {
  createSearchState,
  searchReducer,
  type SearchState,
} from "./state";

export interface UseSearchOptions {
  client: ApiClient;
  /** The hashtag handoff and any previous query, read from the view form. */
  initialQuery: string;
}

export interface SearchController {
  input: string;
  setInput: (value: string) => void;
  section: SectionFilter;
  setSection: (value: SectionFilter) => void;
  state: SearchState;
  /** Enter / the keyboard's «Поиск» key: runs now and records the recent. */
  submit: () => void;
  /** A recent chip: fills the input and runs without waiting for debounce. */
  applyRecent: (query: string) => void;
  /** The clear button: empties the input and drops the results. */
  clear: () => void;
  /** Empty state's reset: clears both the query and the section filter. */
  reset: () => void;
  retry: () => void;
  loadMore: () => void;
  /** Records the displayed query when a result is opened. */
  rememberCurrent: () => void;
}

/**
 * Owns query state, the debounce, and paging for one search screen.
 *
 * `Serverless.call` cannot be aborted, so cancellation is logical, not
 * physical: every request takes the next `requestId`, and the reducer ignores
 * any response that is not the newest. Clearing the input bumps the id too, so
 * a slow answer for a query the reader already deleted never lands.
 */
export function useSearch({
  client,
  initialQuery,
}: UseSearchOptions): SearchController {
  const [input, setInput] = useState(() => normalizeQuery(initialQuery));
  const [section, setSectionState] = useState<SectionFilter>("all");
  const [state, dispatch] = useReducer(
    searchReducer,
    undefined,
    createSearchState,
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  const inputRef = useRef(input);
  inputRef.current = input;
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const previousSection = useRef(section);
  const requestId = useRef(0);
  /** The last `(query, section)` pair actually requested, to avoid doubles. */
  const lastRunKey = useRef<string | null>(null);
  const moreInFlight = useRef(false);

  const invalidate = useCallback(() => {
    const id = ++requestId.current;
    lastRunKey.current = null;
    dispatch({ type: "reset", requestId: id });
  }, []);

  const run = useCallback(
    (
      rawQuery: string,
      target: SectionFilter,
      kind: "replace" | "more",
      force = false,
    ) => {
      const query = normalizeQuery(rawQuery);
      if (!isSearchable(query)) {
        invalidate();
        return;
      }

      const key = `${query}\u0000${target}`;

      if (kind === "replace") {
        if (!force && lastRunKey.current === key) return;
        lastRunKey.current = key;
      } else {
        const current = stateRef.current;
        // Paging belongs to the results on screen. If a replace is already
        // pending, `lastRunKey` has moved ahead of `activeQuery` and a «more»
        // call now would supersede the query the reader just typed.
        const activeKey = `${current.activeQuery}\u0000${current.activeSection}`;
        if (
          moreInFlight.current ||
          lastRunKey.current !== activeKey ||
          current.loading ||
          current.loadingMore ||
          !current.hasMore ||
          current.nextCursor === null
        ) {
          return;
        }
        moreInFlight.current = true;
      }

      const id = ++requestId.current;
      dispatch(
        kind === "more"
          ? { type: "more-start", requestId: id }
          : { type: "start", requestId: id },
      );

      const sectionParam = sectionFilterParam(target);
      const cursor = kind === "more" ? stateRef.current.nextCursor : null;

      client
        .feed({
          q: query,
          limit: SEARCH_PAGE_SIZE,
          ...(sectionParam === undefined ? {} : { section: sectionParam }),
          ...(cursor === null ? {} : { cursor }),
        })
        .then((response) =>
          dispatch({
            type: "success",
            requestId: id,
            response,
            query,
            section: target,
            append: kind === "more",
          }),
        )
        .catch(() =>
          dispatch({
            type: "failure",
            requestId: id,
            append: kind === "more",
          }),
        )
        .finally(() => {
          if (kind === "more") moreInFlight.current = false;
        });
    },
    [client, invalidate],
  );

  // The hashtag handoff (or a restored form value) searches immediately; the
  // debounce effect below then sees the same key and does nothing.
  useEffect(() => {
    if (isSearchable(initialQuery)) run(initialQuery, "all", "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const query = normalizeQuery(input);
    const sectionChanged = previousSection.current !== section;
    previousSection.current = section;

    if (!isSearchable(query)) {
      invalidate();
      return;
    }

    // Switching the section is a deliberate action, not typing: it runs at
    // once. Typing waits for the debounce.
    if (sectionChanged) {
      run(query, section, "replace");
      return;
    }

    const timer = setTimeout(
      () => run(query, section, "replace"),
      SEARCH_DEBOUNCE_MS,
    );

    return () => clearTimeout(timer);
  }, [input, section, run, invalidate]);

  const setInputValue = useCallback((value: string) => {
    setInput(value);
  }, []);

  const setSection = useCallback((value: SectionFilter) => {
    setSectionState((current) => (current === value ? current : value));
  }, []);

  const submit = useCallback(() => {
    const query = normalizeQuery(inputRef.current);
    if (!isSearchable(query)) return;

    rememberQuery(query);
    run(query, sectionRef.current, "replace", true);
  }, [run]);

  const applyRecent = useCallback(
    (query: string) => {
      const normalized = normalizeQuery(query);
      if (!isSearchable(normalized)) return;

      setInput(normalized);
      rememberQuery(normalized);
      run(normalized, sectionRef.current, "replace");
    },
    [run],
  );

  const clear = useCallback(() => {
    setInput("");
  }, []);

  const reset = useCallback(() => {
    setInput("");
    setSectionState("all");
    previousSection.current = "all";
    invalidate();
  }, [invalidate]);

  const retry = useCallback(() => {
    run(inputRef.current, sectionRef.current, "replace", true);
  }, [run]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    run(current.activeQuery, current.activeSection, "more");
  }, [run]);

  const rememberCurrent = useCallback(() => {
    const query = stateRef.current.activeQuery;
    if (isSearchable(query)) rememberQuery(query);
  }, []);

  return {
    input,
    setInput: setInputValue,
    section,
    setSection,
    state,
    submit,
    applyRecent,
    clear,
    reset,
    retry,
    loadMore,
    rememberCurrent,
  };
}
