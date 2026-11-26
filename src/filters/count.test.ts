import { describe, expect, it } from "vitest";

import type { FeedFilters } from "./model";
import {
  countReducer,
  countRequestKey,
  createCountState,
  FILTER_COUNT_DEBOUNCE_MS,
} from "./count";

function filters(patch: Partial<FeedFilters> = {}): FeedFilters {
  return { category: null, demand: null, sources: [], ...patch };
}

describe("createCountState", () => {
  it("starts with no total and no request in flight", () => {
    expect(createCountState()).toEqual({
      total: null,
      loading: false,
      failed: false,
      requestId: 0,
    });
  });
});

describe("countReducer", () => {
  it("starts loading but keeps the previous total on screen", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 1 });
    state = countReducer(state, { type: "success", requestId: 1, total: 12 });

    state = countReducer(state, { type: "start", requestId: 2 });

    expect(state.total).toBe(12);
    expect(state.loading).toBe(true);
    expect(state.failed).toBe(false);
    expect(state.requestId).toBe(2);
  });

  it("applies the response of the current request", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 1 });
    state = countReducer(state, { type: "success", requestId: 1, total: 42 });

    expect(state).toEqual({
      total: 42,
      loading: false,
      failed: false,
      requestId: 1,
    });
  });

  it("ignores a response from a superseded request", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 1 });
    state = countReducer(state, { type: "success", requestId: 1, total: 99 });
    state = countReducer(state, { type: "start", requestId: 2 });

    const next = countReducer(state, {
      type: "success",
      requestId: 1,
      total: 7,
    });

    expect(next).toBe(state);
    expect(next.total).toBe(99);
    expect(next.loading).toBe(true);
  });

  it("drops the total to null on failure, never to zero", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 1 });
    state = countReducer(state, { type: "success", requestId: 1, total: 12 });
    state = countReducer(state, { type: "start", requestId: 2 });

    state = countReducer(state, { type: "failure", requestId: 2 });

    expect(state.total).toBeNull();
    expect(state.total).not.toBe(0);
    expect(state.loading).toBe(false);
    expect(state.failed).toBe(true);
  });

  it("ignores a failure from a superseded request", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 1 });
    state = countReducer(state, { type: "start", requestId: 2 });

    const next = countReducer(state, { type: "failure", requestId: 1 });

    expect(next).toBe(state);
    expect(next.loading).toBe(true);
    expect(next.failed).toBe(false);
  });

  it("clears a previous failure when the next request succeeds", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 1 });
    state = countReducer(state, { type: "failure", requestId: 1 });
    state = countReducer(state, { type: "start", requestId: 2 });
    state = countReducer(state, { type: "success", requestId: 2, total: 3 });

    expect(state.failed).toBe(false);
    expect(state.total).toBe(3);
  });

  it("resets to the initial state", () => {
    let state = createCountState();
    state = countReducer(state, { type: "start", requestId: 4 });
    state = countReducer(state, { type: "success", requestId: 4, total: 8 });

    state = countReducer(state, { type: "reset" });

    expect(state).toEqual(createCountState());
  });
});

describe("countRequestKey", () => {
  it("is stable when sources arrive in a different order", () => {
    const first = countRequestKey(
      "classifieds",
      filters({ category: "auto", sources: [3, 1, 2] }),
    );
    const second = countRequestKey(
      "classifieds",
      filters({ category: "auto", sources: [1, 2, 3] }),
    );

    expect(first).toBe(second);
  });

  it("changes with the section, category, demand, and sources", () => {
    const base = countRequestKey("classifieds", filters());
    const keys = new Set([
      base,
      countRequestKey("jobs", filters()),
      countRequestKey("classifieds", filters({ category: "auto" })),
      countRequestKey("classifieds", filters({ demand: "wanted" })),
      countRequestKey("classifieds", filters({ sources: [1] })),
    ]);

    expect(keys.size).toBe(5);
  });

  it("is a debounced constant the sheet can rely on", () => {
    expect(FILTER_COUNT_DEBOUNCE_MS).toBe(250);
  });
});
