import type { Card, FeedResponse } from "../api/types";
import { dedupeCards } from "../feed/state";
import type { SectionFilter } from "./section-filter";

/**
 * The search screen's state. Unlike the feed, this is one list, not one per
 * section: a new query replaces the list, but the previous cards stay on
 * screen until the new response lands.
 *
 * Supersession is the whole concurrency model. `Telegram.WebApp.Serverless`
 * offers no abort, so every request carries a monotonically growing
 * `requestId`; a response whose id is not the latest is dropped here. The same
 * guard covers clearing the input while a request is still in flight.
 */
export interface SearchState {
  /** The query whose results are on screen; updated only on success. */
  activeQuery: string;
  /** The section whose results are on screen; updated only on success. */
  activeSection: SectionFilter;
  cards: Card[];
  nextCursor: string | null;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  moreError: boolean;
  hasMore: boolean;
  initialized: boolean;
  requestId: number;
}

export function createSearchState(): SearchState {
  return {
    activeQuery: "",
    activeSection: "all",
    cards: [],
    nextCursor: null,
    total: 0,
    loading: false,
    loadingMore: false,
    error: false,
    moreError: false,
    hasMore: false,
    initialized: false,
    requestId: 0,
  };
}

export type SearchAction =
  | { type: "start"; requestId: number }
  | { type: "more-start"; requestId: number }
  | {
      type: "success";
      requestId: number;
      response: FeedResponse;
      query: string;
      section: SectionFilter;
      append: boolean;
    }
  | { type: "failure"; requestId: number; append: boolean }
  | { type: "reset"; requestId: number };

export function searchReducer(
  state: SearchState,
  action: SearchAction,
): SearchState {
  switch (action.type) {
    case "start":
      // The old cards stay visible; only the flags change. This is what keeps
      // the screen from jumping while the next query loads.
      return {
        ...state,
        loading: true,
        loadingMore: false,
        error: false,
        moreError: false,
        requestId: action.requestId,
      };

    case "more-start":
      return {
        ...state,
        loadingMore: true,
        moreError: false,
        requestId: action.requestId,
      };

    case "success": {
      if (state.requestId !== action.requestId) return state;

      const incoming = dedupeCards(action.response.cards);
      const cards = action.append
        ? dedupeCards([...state.cards, ...incoming])
        : incoming;

      return {
        ...state,
        activeQuery: action.query,
        activeSection: action.section,
        cards,
        nextCursor: action.response.next_cursor,
        total: action.response.total,
        loading: false,
        loadingMore: false,
        error: false,
        moreError: false,
        hasMore: action.response.next_cursor !== null,
        initialized: true,
      };
    }

    case "failure": {
      if (state.requestId !== action.requestId) return state;

      return action.append
        ? { ...state, loadingMore: false, moreError: true }
        : { ...state, loading: false, error: true };
    }

    case "reset":
      // A fresh id is the only way to invalidate a request already in flight.
      return { ...createSearchState(), requestId: action.requestId };
  }
}
