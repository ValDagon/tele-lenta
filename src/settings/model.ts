/**
 * Settings model. The five fields the API accepts are the only ones the screen
 * can change; identity and access are read-only and never travel back.
 */

import type { MeResponse } from "../api/types";
import { config } from "../config";

export interface SettingsDraft {
  digest_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  spam_filter: boolean;
  ad_filter: boolean;
}

/** Wall-clock `HH:MM`, 00:00–23:59. Mirrors the VPS validator. */
const QUIET_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isQuietTime(value: string): boolean {
  return QUIET_TIME.test(value);
}

/**
 * The quiet-hours picker offers half hours. A native `input[type=time]` follows
 * the browser locale and shows «11:00 PM» in an English-locale webview, which
 * contradicts the Russian copy; a controlled 24-hour list cannot drift.
 */
export const TIME_SLOTS: ReadonlyArray<string> = Array.from(
  { length: 48 },
  (_, index) => {
    const hours = Math.floor(index / 2);
    const minutes = index % 2 === 0 ? "00" : "30";
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  },
);

/** Slots plus the current value when the server stored an off-grid minute. */
export function timeOptions(current: string): string[] {
  const options = [...TIME_SLOTS];
  if (isQuietTime(current) && !options.includes(current)) options.push(current);
  return options.sort();
}

/** Exactly the five editable fields, whatever else the response carries. */
export function draftFromMe(me: MeResponse): SettingsDraft {
  return {
    digest_enabled: me.digest_enabled,
    quiet_start: me.quiet_start,
    quiet_end: me.quiet_end,
    spam_filter: me.spam_filter,
    ad_filter: me.ad_filter,
  };
}

/**
 * A response is usable only when the user is admitted and all five fields are
 * present and well formed. A `/v1/me` that fails this is treated as a failed
 * load instead of rendering half a screen.
 */
export function settingsLoaded(
  me: MeResponse | null | undefined,
): me is MeResponse {
  if (me === null || me === undefined) return false;
  if (me.allowed === false) return false;

  return (
    typeof me.digest_enabled === "boolean" &&
    typeof me.spam_filter === "boolean" &&
    typeof me.ad_filter === "boolean" &&
    isQuietTime(me.quiet_start) &&
    isQuietTime(me.quiet_end)
  );
}

/**
 * Applies a partial edit and returns both the next draft and the patch that
 * actually changed. An unchanged field never leaves the client.
 */
export function patchFor(
  draft: SettingsDraft,
  next: Partial<SettingsDraft>,
): { draft: SettingsDraft; patch: Partial<SettingsDraft> } {
  const merged: SettingsDraft = { ...draft };
  const patch: Partial<SettingsDraft> = {};

  const apply = <K extends keyof SettingsDraft>(
    field: K,
    value: SettingsDraft[K] | undefined,
  ) => {
    if (value === undefined || value === draft[field]) return;
    merged[field] = value;
    patch[field] = value;
  };

  apply("digest_enabled", next.digest_enabled);
  apply("quiet_start", next.quiet_start);
  apply("quiet_end", next.quiet_end);
  apply("spam_filter", next.spam_filter);
  apply("ad_filter", next.ad_filter);

  return { draft: merged, patch };
}

/**
 * Inline validation for both inputs. An equal start and end is rejected here
 * as well, so the screen never sends a window the user cannot see.
 */
export function quietHoursError(draft: SettingsDraft): string | null {
  if (!isQuietTime(draft.quiet_start) || !isQuietTime(draft.quiet_end)) {
    return config.settings.quiet.timeError;
  }
  if (draft.quiet_start === draft.quiet_end) {
    return config.settings.quiet.sameError;
  }
  return null;
}

export function digestSummary(enabled: boolean): string {
  return enabled
    ? config.settings.digest.on
    : config.settings.digest.off;
}

export function quietSummary(start: string, end: string): string {
  return `${config.settings.quiet.summaryLabel}: ${start}–${end} (${config.settings.quiet.summaryZone})`;
}
