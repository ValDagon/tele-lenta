import { describe, expect, it } from "vitest";

import {
  canGoBack,
  createViewState,
  currentSheet,
  feedScrollKey,
  formFor,
  scrollFor,
  viewReducer,
} from "./view";

describe("view state machine", () => {
  it("starts at the gate with no back action", () => {
    const state = createViewState();
    expect(state.current).toBe("gate");
    expect(canGoBack(state)).toBe(false);
  });

  it("closes the top sheet before leaving the view", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, { type: "go", view: "detail" });
    state = viewReducer(state, { type: "open-sheet", sheet: "filters" });
    state = viewReducer(state, { type: "open-sheet", sheet: "about" });

    expect(canGoBack(state)).toBe(true);

    state = viewReducer(state, { type: "back" });
    expect(currentSheet(state)).toBe("filters");
    expect(state.current).toBe("detail");

    state = viewReducer(state, { type: "back" });
    expect(currentSheet(state)).toBeNull();
    expect(state.current).toBe("detail");

    state = viewReducer(state, { type: "back" });
    expect(state.current).toBe("feed");
    expect(canGoBack(state)).toBe(false);
  });

  it("returns to the previous view", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, { type: "go", view: "settings" });
    state = viewReducer(state, { type: "go", view: "saved" });

    state = viewReducer(state, { type: "back" });
    expect(state.current).toBe("settings");

    state = viewReducer(state, { type: "back" });
    expect(state.current).toBe("feed");
  });

  it("clears history when going to the root feed", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, { type: "go", view: "settings" });
    state = viewReducer(state, { type: "go", view: "feed" });

    expect(state.current).toBe("feed");
    expect(state.history).toEqual([]);
    expect(canGoBack(state)).toBe(false);
  });

  it("preserves scroll per list instance across navigation", () => {
    const key = feedScrollKey("classifieds");
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, { type: "remember-scroll", key, y: 120 });
    state = viewReducer(state, { type: "go", view: "detail" });
    state = viewReducer(state, { type: "back" });

    expect(scrollFor(state, key)).toBe(120);
  });

  it("keeps a separate scroll offset per section", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, {
      type: "remember-scroll",
      key: feedScrollKey("classifieds"),
      y: 120,
    });
    state = viewReducer(state, {
      type: "remember-scroll",
      key: feedScrollKey("jobs"),
      y: 340,
    });

    expect(scrollFor(state, feedScrollKey("classifieds"))).toBe(120);
    expect(scrollFor(state, feedScrollKey("jobs"))).toBe(340);
  });

  it("preserves draft form values across navigation", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, {
      type: "set-form",
      key: "search",
      values: { q: "лодка" },
    });
    state = viewReducer(state, { type: "go", view: "detail" });
    state = viewReducer(state, { type: "back" });

    expect(formFor<{ q: string }>(state, "search").q).toBe("лодка");
  });

  it("does not move on back at the root", () => {
    const state = createViewState({ current: "feed" });
    expect(viewReducer(state, { type: "back" })).toBe(state);
  });

  it("opens a card by id and keeps it across back", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, { type: "open-card", cardId: 42 });

    expect(state.current).toBe("detail");
    expect(state.selectedCardId).toBe(42);

    state = viewReducer(state, { type: "back" });
    expect(state.current).toBe("feed");
    expect(state.selectedCardId).toBe(42);

    state = viewReducer(state, { type: "open-card", cardId: 7 });
    expect(state.selectedCardId).toBe(7);
  });

  it("opens a deep-linked card from the gate without adding history", () => {
    let state = createViewState();
    state = viewReducer(state, { type: "open-card", cardId: 42 });

    expect(state.current).toBe("detail");
    expect(state.selectedCardId).toBe(42);
    expect(state.history).toEqual([]);

    state = viewReducer(state, { type: "back" });
    expect(state.current).toBe("feed");
    expect(state.history).toEqual([]);
    expect(canGoBack(state)).toBe(false);
  });

  it("remembers the feed behind a card opened from it", () => {
    let state = createViewState({ current: "feed" });
    state = viewReducer(state, { type: "open-card", cardId: 42 });

    expect(state.history).toEqual(["feed"]);

    state = viewReducer(state, { type: "back" });
    expect(state.current).toBe("feed");
    expect(state.history).toEqual([]);
  });

  it("carries one notice back to the feed until it is dismissed", () => {
    let state = createViewState({ current: "detail", selectedCardId: 1 });
    state = viewReducer(state, {
      type: "show-notice",
      message: "Объявление больше недоступно.",
    });
    state = viewReducer(state, { type: "go", view: "feed" });

    expect(state.current).toBe("feed");
    expect(state.notice).toBe("Объявление больше недоступно.");

    state = viewReducer(state, { type: "dismiss-notice" });
    expect(state.notice).toBeNull();
  });

  it("drops a stale notice when another card opens", () => {
    let state = createViewState({ current: "feed", notice: "старое" });
    state = viewReducer(state, { type: "open-card", cardId: 3 });
    expect(state.notice).toBeNull();
  });
});
