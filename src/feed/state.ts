import type { Card, FeedResponse, Section } from "../api/types";

/**
 * Per-section feed state. Each section keeps its own cards, cursor, and load
 * flags, so switching tabs never refetches a section the reader already has.
 *
 * Every request carries a `requestId`; a response whose id no longer matches
 * the section's latest request is ignored. That is the concurrency guard:
 * a slow first page cannot land on top of a refresh or a newer section load.
 */
export interface SectionState {
  cards: Card[];
  nextCursor: string | null;
  total: number;
  updatedAt: string | null;
  /** Last known data time, used for «Нет связи, HH:MM» when updatedAt is null. */
  staleAt: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  moreError: boolean;
  stale: boolean;
  hasMore: boolean;
  initialized: boolean;
  requestId: number;
}

export type FeedState = Record<Section, SectionState>;

export const FEED_SECTIONS: ReadonlyArray<Section> = [
  "classifieds",
  "jobs",
  "events",
];

export function emptySectionState(): SectionState {
  return {
    cards: [],
    nextCursor: null,
    total: 0,
    updatedAt: null,
    staleAt: null,
    loading: false,
    loadingMore: false,
    error: false,
    moreError: false,
    stale: false,
    hasMore: false,
    initialized: false,
    requestId: 0,
  };
}

export function createFeedState(): FeedState {
  return {
    classifieds: emptySectionState(),
    jobs: emptySectionState(),
    events: emptySectionState(),
  };
}

/** Keeps the first occurrence of each id, preserving order. */
export function dedupeCards(cards: readonly Card[]): Card[] {
  const seen = new Set<number>();
  const result: Card[] = [];

  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    result.push(card);
  }

  return result;
}

export type FeedAction =
  | { type: "load-start"; section: Section; requestId: number }
  | {
      type: "load-success";
      section: Section;
      requestId: number;
      response: FeedResponse;
      mode: "replace" | "merge";
    }
  | { type: "load-failure"; section: Section; requestId: number }
  | { type: "more-start"; section: Section; requestId: number }
  | {
      type: "more-success";
      section: Section;
      requestId: number;
      response: FeedResponse;
    }
  | { type: "more-failure"; section: Section; requestId: number }
  | { type: "reset"; section: Section; requestId: number }
  | {
      type: "hydrate";
      section: Section;
      cards: readonly Card[];
      updatedAt: string | null;
      staleAt: string | null;
    };

function withSection(
  state: FeedState,
  section: Section,
  next: SectionState,
): FeedState {
  return { ...state, [section]: next };
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  const current = state[action.section];

  switch (action.type) {
    case "load-start":
      return withSection(state, action.section, {
        ...current,
        loading: true,
        loadingMore: false,
        error: false,
        moreError: false,
        requestId: action.requestId,
      });

    case "load-success": {
      if (current.requestId !== action.requestId) return state;

      const incoming = dedupeCards(action.response.cards);
      const merging = action.mode === "merge" && current.cards.length > 0;
      const cards = merging
        ? dedupeCards([...incoming, ...current.cards])
        : incoming;

      // A refresh merges new cards at the top and keeps the reader's loaded
      // pages and cursor; an initial load replaces the list.
      const nextCursor = merging
        ? current.nextCursor
        : action.response.next_cursor;
      const hasMore = merging ? current.hasMore : nextCursor !== null;

      return withSection(state, action.section, {
        ...current,
        cards,
        nextCursor,
        total: action.response.total,
        updatedAt: action.response.updated_at,
        loading: false,
        loadingMore: false,
        error: false,
        moreError: false,
        stale: false,
        hasMore,
        initialized: true,
      });
    }

    case "load-failure": {
      if (current.requestId !== action.requestId) return state;

      const hasCards = current.cards.length > 0;
      return withSection(state, action.section, {
        ...current,
        loading: false,
        loadingMore: false,
        error: !hasCards,
        stale: hasCards,
        staleAt: current.updatedAt ?? current.staleAt,
        initialized: true,
      });
    }

    case "more-start":
      return withSection(state, action.section, {
        ...current,
        loadingMore: true,
        moreError: false,
        requestId: action.requestId,
      });

    case "more-success": {
      if (current.requestId !== action.requestId) return state;

      const cards = dedupeCards([...current.cards, ...action.response.cards]);
      const nextCursor = action.response.next_cursor;

      return withSection(state, action.section, {
        ...current,
        cards,
        nextCursor,
        total: action.response.total,
        updatedAt: action.response.updated_at,
        loadingMore: false,
        moreError: false,
        hasMore: nextCursor !== null,
        initialized: true,
      });
    }

    case "more-failure": {
      if (current.requestId !== action.requestId) return state;

      return withSection(state, action.section, {
        ...current,
        loadingMore: false,
        moreError: true,
      });
    }

    case "reset": {
      // Filters changed: drop everything, including the cached cards that were
      // hydrated for the old filter set. The new request id makes every
      // response that started before the reset ineligible.
      return withSection(state, action.section, {
        ...emptySectionState(),
        requestId: action.requestId,
      });
    }

    case "hydrate": {
      if (current.initialized || current.cards.length > 0) return state;

      return withSection(state, action.section, {
        ...current,
        cards: dedupeCards(action.cards),
        updatedAt: action.updatedAt,
        staleAt: action.staleAt,
      });
    }
  }
}
