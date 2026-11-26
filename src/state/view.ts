import type { Section } from "../api/types";

export const VIEWS = [
  "gate",
  "feed",
  "detail",
  "search",
  "saved",
  "settings",
] as const;

export type ViewName = (typeof VIEWS)[number];

export const SHEETS = ["filters", "save-search", "about", "onboarding"] as const;

export type SheetName = (typeof SHEETS)[number];

export type ScrollKey = string;

export interface ViewState {
  current: ViewName;
  history: ViewName[];
  sheets: SheetName[];
  /** Scroll offset per list instance, e.g. `feed:classifieds`. */
  scroll: Record<ScrollKey, number>;
  /** Draft form values per surface; never reset by navigation. */
  forms: Record<string, Record<string, unknown>>;
  section: Section;
  /** The card the detail view renders; kept across back/forward. */
  selectedCardId: number | null;
  /** One short message the feed shows, e.g. a card that disappeared. */
  notice: string | null;
}

export type ViewAction =
  | { type: "go"; view: ViewName }
  | { type: "open-card"; cardId: number }
  | { type: "back" }
  | { type: "open-sheet"; sheet: SheetName }
  | { type: "close-sheet" }
  | { type: "remember-scroll"; key: ScrollKey; y: number }
  | { type: "set-form"; key: string; values: Record<string, unknown> }
  | { type: "set-section"; section: Section }
  | { type: "show-notice"; message: string }
  | { type: "dismiss-notice" };

export function createViewState(
  overrides: Partial<ViewState> = {},
): ViewState {
  return {
    current: "gate",
    history: [],
    sheets: [],
    scroll: {},
    forms: {},
    section: "classifieds",
    selectedCardId: null,
    notice: null,
    ...overrides,
  };
}

export function feedScrollKey(section: Section): ScrollKey {
  return `feed:${section}`;
}

export function currentSheet(state: ViewState): SheetName | null {
  return state.sheets.at(-1) ?? null;
}

/**
 * Back order: the top sheet first, then the previous view. The feed is the
 * root, so back on the feed is a no-op (Telegram hides the button there).
 */
export function canGoBack(state: ViewState): boolean {
  if (state.current === "gate") return false;
  return (
    state.sheets.length > 0 ||
    state.history.length > 0 ||
    state.current !== "feed"
  );
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "go": {
      if (action.view === state.current) return state;
      const history =
        action.view === "feed"
          ? []
          : state.current === "gate"
            ? []
            : [...state.history, state.current];
      return { ...state, current: action.view, history, sheets: [] };
    }

    case "open-card": {
      // Activating a card from the feed (or a digest) always lands on detail.
      // Re-opening while already there only swaps the id.
      const append = state.current !== "gate" && state.current !== "detail";
      return {
        ...state,
        current: "detail",
        history: append ? [...state.history, state.current] : state.history,
        sheets: [],
        selectedCardId: action.cardId,
        notice: null,
      };
    }

    case "back": {
      if (state.sheets.length > 0) {
        return { ...state, sheets: state.sheets.slice(0, -1) };
      }
      if (state.history.length > 0) {
        const history = state.history.slice(0, -1);
        const current = state.history.at(-1) ?? "feed";
        return { ...state, current, history };
      }
      if (state.current !== "feed" && state.current !== "gate") {
        return { ...state, current: "feed", history: [] };
      }
      return state;
    }

    case "open-sheet": {
      if (state.sheets.at(-1) === action.sheet) return state;
      return { ...state, sheets: [...state.sheets, action.sheet] };
    }

    case "close-sheet": {
      if (state.sheets.length === 0) return state;
      return { ...state, sheets: state.sheets.slice(0, -1) };
    }

    case "remember-scroll": {
      const y = Math.max(0, Math.round(action.y));
      if (state.scroll[action.key] === y) return state;
      return { ...state, scroll: { ...state.scroll, [action.key]: y } };
    }

    case "set-form": {
      return {
        ...state,
        forms: {
          ...state.forms,
          [action.key]: { ...state.forms[action.key], ...action.values },
        },
      };
    }

    case "set-section": {
      if (state.section === action.section) return state;
      return { ...state, section: action.section };
    }

    case "show-notice": {
      return { ...state, notice: action.message };
    }

    case "dismiss-notice": {
      if (state.notice === null) return state;
      return { ...state, notice: null };
    }
  }
}

export function scrollFor(state: ViewState, key: ScrollKey): number {
  return state.scroll[key] ?? 0;
}

export function formFor<T extends Record<string, unknown>>(
  state: ViewState,
  key: string,
): Partial<T> {
  return (state.forms[key] ?? {}) as Partial<T>;
}
