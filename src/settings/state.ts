/**
 * Settings screen state. A save is optimistic: the draft jumps to the next
 * value immediately, and a failure puts the previous draft back. The reducer
 * is pure, so `savedAt` arrives from the caller rather than the clock.
 */

import { config } from "../config";
import type { SettingsDraft } from "./model";

export type SettingsPhase = "loading" | "ready" | "error";

export interface SettingsState {
  phase: SettingsPhase;
  draft: SettingsDraft | null;
  saving: boolean;
  error: string | null;
  savedAt: number | null;
}

export type SettingsAction =
  | { type: "load-start" }
  | { type: "load-success"; draft: SettingsDraft }
  | { type: "load-failure"; error?: string }
  | { type: "draft-set"; draft: SettingsDraft }
  | { type: "save-start"; draft: SettingsDraft }
  | { type: "save-success"; draft: SettingsDraft; savedAt: number }
  | { type: "save-failure"; previous: SettingsDraft; error?: string };

export function createSettingsState(
  overrides: Partial<SettingsState> = {},
): SettingsState {
  return {
    phase: "loading",
    draft: null,
    saving: false,
    error: null,
    savedAt: null,
    ...overrides,
  };
}

export function settingsReducer(
  state: SettingsState,
  action: SettingsAction,
): SettingsState {
  switch (action.type) {
    case "load-start": {
      return { ...state, phase: "loading", error: null };
    }

    case "load-success": {
      return {
        ...state,
        phase: "ready",
        draft: action.draft,
        saving: false,
        error: null,
        savedAt: null,
      };
    }

    case "load-failure": {
      // Theme lives on without `/v1/me`, so the draft, if any, stays put.
      return {
        ...state,
        phase: "error",
        saving: false,
        error: action.error ?? config.settings.loadError,
      };
    }

    case "draft-set": {
      return { ...state, draft: action.draft, error: null };
    }

    case "save-start": {
      return {
        ...state,
        saving: true,
        draft: action.draft,
        error: null,
      };
    }

    case "save-success": {
      return {
        ...state,
        saving: false,
        draft: action.draft,
        error: null,
        savedAt: action.savedAt,
      };
    }

    case "save-failure": {
      return {
        ...state,
        saving: false,
        draft: action.previous,
        error: action.error ?? config.settings.saveError,
      };
    }
  }
}
