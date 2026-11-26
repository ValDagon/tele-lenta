import { describe, expect, it } from "vitest";

import { config } from "../config";
import type { SettingsDraft } from "./model";
import {
  createSettingsState,
  settingsReducer,
  type SettingsState,
} from "./state";

const DRAFT: SettingsDraft = {
  digest_enabled: true,
  quiet_start: "23:00",
  quiet_end: "08:00",
  spam_filter: true,
  ad_filter: false,
};

const NEXT: SettingsDraft = { ...DRAFT, digest_enabled: false };

function ready(overrides: Partial<SettingsState> = {}): SettingsState {
  return createSettingsState({
    phase: "ready",
    draft: DRAFT,
    ...overrides,
  });
}

describe("createSettingsState", () => {
  it("starts loading with no draft", () => {
    expect(createSettingsState()).toEqual({
      phase: "loading",
      draft: null,
      saving: false,
      error: null,
      savedAt: null,
    });
  });
});

describe("settingsReducer", () => {
  it("stores the draft when loading succeeds", () => {
    const state = settingsReducer(createSettingsState(), {
      type: "load-success",
      draft: DRAFT,
    });

    expect(state.phase).toBe("ready");
    expect(state.draft).toEqual(DRAFT);
    expect(state.error).toBeNull();
  });

  it("keeps the draft on a load failure and exposes the error", () => {
    const state = settingsReducer(ready(), { type: "load-failure" });

    expect(state.phase).toBe("error");
    expect(state.draft).toEqual(DRAFT);
    expect(state.error).toBe(config.settings.loadError);
  });

  it("applies a draft edit without touching the server copy", () => {
    const state = settingsReducer(ready(), {
      type: "draft-set",
      draft: NEXT,
    });

    expect(state.draft).toEqual(NEXT);
    expect(state.saving).toBe(false);
    expect(state.phase).toBe("ready");
  });

  it("shows the optimistic draft and clears errors when saving starts", () => {
    const state = settingsReducer(
      ready({ error: "старая ошибка" }),
      { type: "save-start", draft: NEXT },
    );

    expect(state.saving).toBe(true);
    expect(state.draft).toEqual(NEXT);
    expect(state.error).toBeNull();
  });

  it("adopts the server draft and stamps the save time on success", () => {
    const server: SettingsDraft = { ...DRAFT, quiet_start: "22:15" };
    const state = settingsReducer(ready({ saving: true, draft: NEXT }), {
      type: "save-success",
      draft: server,
      savedAt: 1_700_000_000_000,
    });

    expect(state.saving).toBe(false);
    expect(state.draft).toEqual(server);
    expect(state.savedAt).toBe(1_700_000_000_000);
    expect(state.error).toBeNull();
  });

  it("rolls back to the previous draft on a failed save", () => {
    const state = settingsReducer(ready({ saving: true, draft: NEXT }), {
      type: "save-failure",
      previous: DRAFT,
    });

    expect(state.saving).toBe(false);
    expect(state.draft).toEqual(DRAFT);
    expect(state.error).toBe(config.settings.saveError);
  });

  it("keeps an explicit failure message", () => {
    const state = settingsReducer(ready({ saving: true, draft: NEXT }), {
      type: "save-failure",
      previous: DRAFT,
      error: "Нет связи",
    });

    expect(state.error).toBe("Нет связи");
  });
});
