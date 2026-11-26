import { useCallback, useEffect, useMemo, useReducer, useRef } from "preact/hooks";

import type { ApiClient } from "../api/client";
import type { Section } from "../api/types";
import { countRequestKey } from "../filters/count";
import { isFiltered, toFeedInput, type FeedFilters } from "../filters/model";
import { readFeedCache, writeFeedCache } from "./cache";
import {
  createFeedState,
  FEED_SECTIONS,
  feedReducer,
  type FeedState,
} from "./state";

export const FEED_PAGE_SIZE = 20;
export const FEED_REFRESH_MS = 5 * 60 * 1000;

export interface UseFeedOptions {
  client: ApiClient;
  enabled: boolean;
  section: Section;
  /** Applied filters per section; a section's query always uses its own. */
  filters: Record<Section, FeedFilters>;
}

export interface FeedController {
  state: FeedState;
  refresh: (section: Section) => void;
  loadMore: (section: Section) => void;
}

function initFeedState(filters: Record<Section, FeedFilters>): FeedState {
  const state = createFeedState();
  const cache = readFeedCache();
  if (cache === null) return state;
  // The cache holds an unfiltered feed. Restoring it under active filters
  // would show cards the reader just excluded.
  if (isFiltered(filters[cache.section])) return state;

  return feedReducer(state, {
    type: "hydrate",
    section: cache.section,
    cards: cache.cards,
    updatedAt: cache.updated_at,
    staleAt: cache.saved_at,
  });
}

/**
 * Owns the feed for all three sections. It lives above the views so a trip to
 * the card and back does not throw the list away.
 *
 * Refresh rhythm: first page on first view, on visibilitychange to visible,
 * every five minutes while visible, and on tap (the caller invokes `refresh`).
 * The interval is cleared on hide and before unmount; nothing polls in the
 * background.
 */
export function useFeed({
  client,
  enabled,
  section,
  filters,
}: UseFeedOptions): FeedController {
  // Filters at mount decide the cache hydration, so `filters` is read once.
  const initial = useMemo(() => initFeedState(filters), []);
  const [state, dispatch] = useReducer(feedReducer, initial);

  const stateRef = useRef(state);
  stateRef.current = state;
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const requestId = useRef(0);
  // Synchronous concurrency guard: state updates land on the next render, so
  // two calls in one tick would both see `loading: false` without this set.
  // The value is the request id: a filter change starts a new request while
  // the old one is still in flight, and only the new one owns the slot.
  const inFlight = useRef<Map<Section, number>>(new Map());

  const load = useCallback(
    (
      target: Section,
      kind: "initial" | "refresh" | "more",
      force = false,
    ) => {
      const current = stateRef.current[target];

      if (!force && inFlight.current.has(target)) return;
      if (kind === "more") {
        if (!force && (!current.hasMore || current.loading || current.loadingMore))
          return;
      } else if (!force && (current.loading || current.loadingMore)) {
        return;
      }

      const id = ++requestId.current;
      inFlight.current.set(target, id);
      const cursor = kind === "more" ? current.nextCursor : null;

      dispatch(
        kind === "more"
          ? { type: "more-start", section: target, requestId: id }
          : { type: "load-start", section: target, requestId: id },
      );

      client
        .feed({
          ...toFeedInput(target, filtersRef.current[target]),
          limit: FEED_PAGE_SIZE,
          ...(cursor === null ? {} : { cursor }),
        })
        .then((response) => {
          if (kind === "more") {
            dispatch({
              type: "more-success",
              section: target,
              requestId: id,
              response,
            });
            return;
          }

          dispatch({
            type: "load-success",
            section: target,
            requestId: id,
            response,
            mode: stateRef.current[target].initialized ? "merge" : "replace",
          });
        })
        .catch(() => {
          dispatch(
            kind === "more"
              ? { type: "more-failure", section: target, requestId: id }
              : { type: "load-failure", section: target, requestId: id },
          );
        })
        .finally(() => {
          // A filter change may have replaced this request; the newer one
          // keeps ownership of the slot.
          if (inFlight.current.get(target) === id) inFlight.current.delete(target);
        });
    },
    [client],
  );

  const refresh = useCallback(
    (target: Section) => load(target, "refresh"),
    [load],
  );

  const loadMore = useCallback(
    (target: Section) => load(target, "more"),
    [load],
  );

  // One key per section, so an equal filter set does not reset anything.
  const filterKeys = useMemo(
    () => ({
      classifieds: countRequestKey("classifieds", filters.classifieds),
      jobs: countRequestKey("jobs", filters.jobs),
      events: countRequestKey("events", filters.events),
    }),
    [filters],
  );
  const previousKeys = useRef(filterKeys);

  // A filter change invalidates the section's whole timeline: the old cards
  // no longer match, the old cursor belonged to the old query, and any
  // response still in flight must be ignored. The current section reloads at
  // once; the others reload on their next visit through the effect below.
  useEffect(() => {
    if (!enabled) {
      previousKeys.current = filterKeys;
      return;
    }

    const previous = previousKeys.current;
    previousKeys.current = filterKeys;

    for (const target of FEED_SECTIONS) {
      if (previous[target] === filterKeys[target]) continue;

      dispatch({
        type: "reset",
        section: target,
        requestId: ++requestId.current,
      });

      if (target === sectionRef.current) {
        // Bypass the `loading` guard: the previous request is superseded, not
        // finished. `force` also replaces the in-flight slot, so the old
        // request cannot block or clear this one.
        load(target, "initial", true);
      }
    }
  }, [enabled, filterKeys, load]);

  // First view of a section loads its own first page. A section hydrated from
  // the cache still asks the network right away.
  useEffect(() => {
    if (!enabled) return;
    const current = stateRef.current[section];
    if (!current.initialized && !current.loading && !current.loadingMore) {
      load(section, "initial");
    }
  }, [enabled, section, load]);

  // Persist the last viewed section: newest 50 cards plus updated_at. A
  // filtered feed is never cached; it would overwrite the honest cache.
  const current = state[section];
  useEffect(() => {
    if (!enabled) return;
    if (current.cards.length === 0) return;
    if (isFiltered(filters[section])) return;
    writeFeedCache(section, current.cards, current.updatedAt);
  }, [enabled, section, current.cards, current.updatedAt, filters]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") {
          load(sectionRef.current, "refresh");
        }
      }, FEED_REFRESH_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        load(sectionRef.current, "refresh");
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, load]);

  return { state, refresh, loadMore };
}
