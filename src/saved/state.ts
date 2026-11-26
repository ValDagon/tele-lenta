/**
 * Saved-search list state. The reducer is pure so the screen stays thin and
 * the network lives in the component.
 */

import type { SavedSearch } from "../api/types";

export type SavedBusy = "toggle" | "rename" | "delete";

export interface SavedState {
  phase: "idle" | "loading" | "ready" | "error";
  items: SavedSearch[];
  busy: Record<number, SavedBusy>;
  error: string | null;
}

export type SavedAction =
  | { type: "load-start" }
  | { type: "load-success"; items: SavedSearch[] }
  | { type: "load-failure"; error?: string }
  | { type: "replace"; item: SavedSearch }
  | { type: "remove"; id: number }
  | { type: "busy-start"; id: number; kind: SavedBusy }
  | { type: "busy-end"; id: number }
  | { type: "error-set"; error: string }
  | { type: "error-clear" };

export function createSavedState(
  overrides: Partial<SavedState> = {},
): SavedState {
  return {
    phase: "idle",
    items: [],
    busy: {},
    error: null,
    ...overrides,
  };
}

export function savedReducer(
  state: SavedState,
  action: SavedAction,
): SavedState {
  switch (action.type) {
    case "load-start": {
      return { ...state, phase: "loading", error: null };
    }

    case "load-success": {
      return { ...state, phase: "ready", items: [...action.items], error: null };
    }

    case "load-failure": {
      // Keep whatever was already on screen: a failed refresh must not empty
      // the list the reader was looking at.
      return {
        ...state,
        phase: "error",
        error: action.error ?? null,
      };
    }

    case "replace": {
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.item.id ? action.item : item,
        ),
      };
    }

    case "remove": {
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
      };
    }

    case "busy-start": {
      return {
        ...state,
        busy: { ...state.busy, [action.id]: action.kind },
      };
    }

    case "busy-end": {
      if (state.busy[action.id] === undefined) return state;
      const busy = { ...state.busy };
      delete busy[action.id];
      return { ...state, busy };
    }

    case "error-set": {
      return { ...state, error: action.error };
    }

    case "error-clear": {
      if (state.error === null) return state;
      return { ...state, error: null };
    }
  }
}

/** True while any action on this row is in flight. */
export function isBusy(state: SavedState, id: number): boolean {
  return state.busy[id] !== undefined;
}
