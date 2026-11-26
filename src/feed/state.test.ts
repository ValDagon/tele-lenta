import { describe, expect, it } from "vitest";

import type { Card, FeedResponse } from "../api/types";
import {
  createFeedState,
  dedupeCards,
  feedReducer,
  type FeedState,
} from "./state";

function card(id: number): Card {
  return {
    id,
    section: "classifieds",
    category: "goods",
    demand: "offer",
    title: `Объявление ${id}`,
    earliest_published_at: "2026-11-05T09:00:00.000Z",
    sources: [{ id: 1, username: "chat", name: "Чат", monogram: "Ч" }],
    source_count: 1,
  };
}

function response(
  ids: number[],
  nextCursor: string | null,
  total = ids.length,
  updatedAt: string | null = "2026-11-05T10:50:00.000Z",
): FeedResponse {
  return { cards: ids.map(card), next_cursor: nextCursor, total, updated_at: updatedAt };
}

function loaded(ids: number[], nextCursor: string | null = "cursor-1"): FeedState {
  let state = createFeedState();
  state = feedReducer(state, {
    type: "load-start",
    section: "classifieds",
    requestId: 1,
  });
  state = feedReducer(state, {
    type: "load-success",
    section: "classifieds",
    requestId: 1,
    response: response(ids, nextCursor),
    mode: "replace",
  });
  return state;
}

describe("feed reducer", () => {
  it("fills a section from its first page", () => {
    const state = loaded([3, 2]);

    expect(state.classifieds.cards.map((item) => item.id)).toEqual([3, 2]);
    expect(state.classifieds.nextCursor).toBe("cursor-1");
    expect(state.classifieds.hasMore).toBe(true);
    expect(state.classifieds.total).toBe(2);
    expect(state.classifieds.initialized).toBe(true);
    expect(state.classifieds.loading).toBe(false);
    expect(state.jobs.cards).toEqual([]);
  });

  it("stops at the end of the feed", () => {
    const state = loaded([1], null);

    expect(state.classifieds.nextCursor).toBeNull();
    expect(state.classifieds.hasMore).toBe(false);
  });

  it("appends the next page and drops duplicate ids", () => {
    let state = loaded([5, 4]);
    state = feedReducer(state, {
      type: "more-start",
      section: "classifieds",
      requestId: 2,
    });
    state = feedReducer(state, {
      type: "more-success",
      section: "classifieds",
      requestId: 2,
      response: response([4, 3, 2], null),
    });

    expect(state.classifieds.cards.map((item) => item.id)).toEqual([5, 4, 3, 2]);
    expect(state.classifieds.hasMore).toBe(false);
    expect(state.classifieds.loadingMore).toBe(false);
  });

  it("merges a refresh at the top without losing loaded pages", () => {
    let state = loaded([5, 4]);
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 2,
    });
    state = feedReducer(state, {
      type: "load-success",
      section: "classifieds",
      requestId: 2,
      response: response([7, 6, 5], "cursor-1"),
      mode: "merge",
    });

    expect(state.classifieds.cards.map((item) => item.id)).toEqual([
      7, 6, 5, 4,
    ]);
    expect(state.classifieds.nextCursor).toBe("cursor-1");
    expect(state.classifieds.updatedAt).toBe("2026-11-05T10:50:00.000Z");
  });

  it("ignores a response from a superseded request", () => {
    let state = createFeedState();
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 1,
    });
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 2,
    });
    state = feedReducer(state, {
      type: "load-success",
      section: "classifieds",
      requestId: 1,
      response: response([9], null),
      mode: "replace",
    });

    expect(state.classifieds.cards).toEqual([]);
    expect(state.classifieds.loading).toBe(true);
  });

  it("shows an error when the first page fails", () => {
    let state = createFeedState();
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 1,
    });
    state = feedReducer(state, {
      type: "load-failure",
      section: "classifieds",
      requestId: 1,
    });

    expect(state.classifieds.error).toBe(true);
    expect(state.classifieds.stale).toBe(false);
    expect(state.classifieds.loading).toBe(false);
  });

  it("falls back to the stale line when a refresh fails with cards", () => {
    let state = loaded([2, 1]);
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 2,
    });
    state = feedReducer(state, {
      type: "load-failure",
      section: "classifieds",
      requestId: 2,
    });

    expect(state.classifieds.error).toBe(false);
    expect(state.classifieds.stale).toBe(true);
    expect(state.classifieds.staleAt).toBe("2026-11-05T10:50:00.000Z");
  });

  it("flags a failed next page without staling the whole feed", () => {
    let state = loaded([2, 1]);
    state = feedReducer(state, {
      type: "more-start",
      section: "classifieds",
      requestId: 2,
    });
    state = feedReducer(state, {
      type: "more-failure",
      section: "classifieds",
      requestId: 2,
    });

    expect(state.classifieds.moreError).toBe(true);
    expect(state.classifieds.stale).toBe(false);
  });

  it("hydrates a section from cache only while it is empty", () => {
    let state = createFeedState();
    state = feedReducer(state, {
      type: "hydrate",
      section: "events",
      cards: [card(1), card(2)],
      updatedAt: null,
      staleAt: "2026-11-05T10:00:00.000Z",
    });

    expect(state.events.cards).toHaveLength(2);
    expect(state.events.initialized).toBe(false);

    state = feedReducer(state, {
      type: "hydrate",
      section: "events",
      cards: [card(3)],
      updatedAt: null,
      staleAt: "2026-11-05T10:05:00.000Z",
    });
    expect(state.events.cards.map((item) => item.id)).toEqual([1, 2]);
  });

  it("resets a section and ignores responses from before the reset", () => {
    let state = loaded([5, 4]);

    // A request was in flight when the filters changed.
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 2,
    });

    state = feedReducer(state, {
      type: "reset",
      section: "classifieds",
      requestId: 3,
    });

    expect(state.classifieds.cards).toEqual([]);
    expect(state.classifieds.nextCursor).toBeNull();
    expect(state.classifieds.total).toBe(0);
    expect(state.classifieds.initialized).toBe(false);
    expect(state.classifieds.loading).toBe(false);

    // The old response must not repopulate the cleared section.
    state = feedReducer(state, {
      type: "load-success",
      section: "classifieds",
      requestId: 2,
      response: response([9], "cursor-old"),
      mode: "replace",
    });
    expect(state.classifieds.cards).toEqual([]);
    expect(state.classifieds.nextCursor).toBeNull();

    // The request that started after the reset is accepted.
    state = feedReducer(state, {
      type: "load-start",
      section: "classifieds",
      requestId: 4,
    });
    state = feedReducer(state, {
      type: "load-success",
      section: "classifieds",
      requestId: 4,
      response: response([7], null),
      mode: "replace",
    });

    expect(state.classifieds.cards.map((item) => item.id)).toEqual([7]);
    expect(state.classifieds.initialized).toBe(true);
  });

  it("dedupes without reordering", () => {
    expect(dedupeCards([card(1), card(2), card(1)]).map((item) => item.id)).toEqual([
      1, 2,
    ]);
  });
});
