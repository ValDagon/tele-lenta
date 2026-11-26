import { describe, expect, it } from "vitest";

import type { SavedSearch } from "../api/types";
import {
  createSavedState,
  isBusy,
  savedReducer,
  type SavedState,
} from "./state";

function saved(id: number): SavedSearch {
  return {
    id,
    name: `Поиск ${id}`,
    query: "",
    section: null,
    categories: [],
    demand: null,
    sources: [],
    enabled: true,
    last_checked_at: "2026-11-05T10:00:00.000Z",
    last_sent_at: null,
    created_at: "2026-11-01T10:00:00.000Z",
  };
}

function loaded(): SavedState {
  return savedReducer(createSavedState(), {
    type: "load-success",
    items: [saved(1), saved(2)],
  });
}

describe("savedReducer", () => {
  it("starts idle and empty", () => {
    expect(createSavedState()).toEqual({
      phase: "idle",
      items: [],
      busy: {},
      error: null,
    });
  });

  it("loads a list into the ready phase", () => {
    const state = loaded();

    expect(state.phase).toBe("ready");
    expect(state.items.map((item) => item.id)).toEqual([1, 2]);
    expect(state.error).toBeNull();
  });

  it("keeps the old items when a load fails", () => {
    const state = savedReducer(loaded(), {
      type: "load-failure",
      error: "Нет связи",
    });

    expect(state.phase).toBe("error");
    expect(state.error).toBe("Нет связи");
    expect(state.items.map((item) => item.id)).toEqual([1, 2]);
  });

  it("replaces one row by id", () => {
    const state = savedReducer(loaded(), {
      type: "replace",
      item: { ...saved(2), name: "Новое имя", enabled: false },
    });

    expect(state.items[0]?.name).toBe("Поиск 1");
    expect(state.items[1]?.name).toBe("Новое имя");
    expect(state.items[1]?.enabled).toBe(false);
  });

  it("removes a row by id", () => {
    const state = savedReducer(loaded(), { type: "remove", id: 1 });

    expect(state.items.map((item) => item.id)).toEqual([2]);
  });

  it("tracks one busy action per row", () => {
    let state = savedReducer(loaded(), {
      type: "busy-start",
      id: 1,
      kind: "toggle",
    });

    expect(isBusy(state, 1)).toBe(true);
    expect(isBusy(state, 2)).toBe(false);

    state = savedReducer(state, { type: "busy-end", id: 1 });
    expect(isBusy(state, 1)).toBe(false);
  });

  it("sets and clears the row error", () => {
    let state = savedReducer(loaded(), {
      type: "error-set",
      error: "Сбой",
    });
    expect(state.error).toBe("Сбой");

    state = savedReducer(state, { type: "error-clear" });
    expect(state.error).toBeNull();
  });
});
