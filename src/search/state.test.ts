import { describe, expect, it } from "vitest";

import type { Card, FeedResponse } from "../api/types";
import { createSearchState, searchReducer } from "./state";

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
  nextCursor: string | null = null,
  total = ids.length,
): FeedResponse {
  return {
    cards: ids.map(card),
    next_cursor: nextCursor,
    total,
    updated_at: "2026-11-05T10:50:00.000Z",
  };
}

describe("search reducer", () => {
  it("starts pristine", () => {
    const state = createSearchState();

    expect(state.cards).toEqual([]);
    expect(state.activeQuery).toBe("");
    expect(state.activeSection).toBe("all");
    expect(state.initialized).toBe(false);
    expect(state.requestId).toBe(0);
  });

  it("keeps the previous results visible while the next query loads", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, {
      type: "success",
      requestId: 1,
      response: response([3, 2], "cursor-1", 12),
      query: "лодка",
      section: "all",
      append: false,
    });

    state = searchReducer(state, { type: "start", requestId: 2 });

    expect(state.cards.map((item) => item.id)).toEqual([3, 2]);
    expect(state.total).toBe(12);
    expect(state.activeQuery).toBe("лодка");
    expect(state.loading).toBe(true);
    expect(state.error).toBe(false);
  });

  it("records the query and the section only when results land", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, {
      type: "success",
      requestId: 1,
      response: response([4], null, 1),
      query: "машина",
      section: "jobs",
      append: false,
    });

    expect(state.activeQuery).toBe("машина");
    expect(state.activeSection).toBe("jobs");
    expect(state.total).toBe(1);
    expect(state.hasMore).toBe(false);
    expect(state.initialized).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("ignores a success from a superseded request", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, { type: "start", requestId: 2 });
    state = searchReducer(state, {
      type: "success",
      requestId: 1,
      response: response([9]),
      query: "старое",
      section: "all",
      append: false,
    });

    expect(state.cards).toEqual([]);
    expect(state.activeQuery).toBe("");
    expect(state.loading).toBe(true);

    state = searchReducer(state, {
      type: "success",
      requestId: 2,
      response: response([8]),
      query: "новое",
      section: "all",
      append: false,
    });

    expect(state.cards.map((item) => item.id)).toEqual([8]);
    expect(state.activeQuery).toBe("новое");
  });

  it("ignores a failure from a superseded request", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, { type: "start", requestId: 2 });
    state = searchReducer(state, {
      type: "failure",
      requestId: 1,
      append: false,
    });

    expect(state.error).toBe(false);
    expect(state.loading).toBe(true);

    state = searchReducer(state, {
      type: "failure",
      requestId: 2,
      append: false,
    });

    expect(state.error).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("appends the next page and drops duplicate ids", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, {
      type: "success",
      requestId: 1,
      response: response([5, 4], "cursor-1", 4),
      query: "квартира",
      section: "classifieds",
      append: false,
    });

    state = searchReducer(state, { type: "more-start", requestId: 2 });
    state = searchReducer(state, {
      type: "success",
      requestId: 2,
      response: response([4, 3], null, 4),
      query: "квартира",
      section: "classifieds",
      append: true,
    });

    expect(state.cards.map((item) => item.id)).toEqual([5, 4, 3]);
    expect(state.hasMore).toBe(false);
    expect(state.loadingMore).toBe(false);
    expect(state.total).toBe(4);
  });

  it("flags a failed next page without replacing the results", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, {
      type: "success",
      requestId: 1,
      response: response([2, 1], "cursor-1", 9),
      query: "лодка",
      section: "all",
      append: false,
    });

    state = searchReducer(state, { type: "more-start", requestId: 2 });
    state = searchReducer(state, {
      type: "failure",
      requestId: 2,
      append: true,
    });

    expect(state.cards.map((item) => item.id)).toEqual([2, 1]);
    expect(state.moreError).toBe(true);
    expect(state.error).toBe(false);
  });

  it("clears everything and invalidates a request in flight", () => {
    let state = createSearchState();
    state = searchReducer(state, { type: "start", requestId: 1 });
    state = searchReducer(state, { type: "reset", requestId: 2 });
    state = searchReducer(state, {
      type: "success",
      requestId: 1,
      response: response([7]),
      query: "уже стёрто",
      section: "all",
      append: false,
    });

    expect(state.cards).toEqual([]);
    expect(state.activeQuery).toBe("");
    expect(state.initialized).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.requestId).toBe(2);
  });
});
