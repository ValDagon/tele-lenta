import { describe, expect, it } from "vitest";

import type { MeResponse } from "../api/types";
import { config } from "../config";
import {
  digestSummary,
  timeOptions,
  draftFromMe,
  patchFor,
  quietHoursError,
  quietSummary,
  settingsLoaded,
  type SettingsDraft,
} from "./model";

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    telegram_user_id: 42,
    username: "reader",
    first_name: "Reader",
    allowed: true,
    digest_enabled: true,
    quiet_start: "23:00",
    quiet_end: "08:00",
    spam_filter: true,
    ad_filter: false,
    ...overrides,
  };
}

const DRAFT: SettingsDraft = {
  digest_enabled: true,
  quiet_start: "23:00",
  quiet_end: "08:00",
  spam_filter: true,
  ad_filter: false,
};

describe("draftFromMe", () => {
  it("copies only the five editable settings", () => {
    const draft = draftFromMe(me());

    expect(draft).toEqual(DRAFT);
    expect(Object.keys(draft).sort()).toEqual([
      "ad_filter",
      "digest_enabled",
      "quiet_end",
      "quiet_start",
      "spam_filter",
    ]);
  });

  it("ignores identity, access, and unknown fields", () => {
    const draft = draftFromMe(
      me({
        telegram_user_id: 7,
        allowed: false,
        first_name: "Someone else",
        extra: "ignored",
      } as Partial<MeResponse>),
    );

    expect(draft).toEqual(DRAFT);
  });
});

describe("patchFor", () => {
  it("returns an empty patch when nothing changed", () => {
    const result = patchFor(DRAFT, {});

    expect(result.patch).toEqual({});
    expect(result.draft).toEqual(DRAFT);
  });

  it("sends only the field that changed", () => {
    const result = patchFor(DRAFT, { digest_enabled: false });

    expect(result.patch).toEqual({ digest_enabled: false });
    expect(result.draft.digest_enabled).toBe(false);
    expect(result.draft.ad_filter).toBe(false);
  });

  it("does not resend unchanged values mixed into a multi-field change", () => {
    const result = patchFor(DRAFT, {
      ad_filter: true,
      spam_filter: true,
      quiet_end: "09:30",
    });

    expect(result.patch).toEqual({ ad_filter: true, quiet_end: "09:30" });
    expect(result.draft).toEqual({
      ...DRAFT,
      ad_filter: true,
      quiet_end: "09:30",
    });
  });

  it("can change all five fields at once", () => {
    const next: SettingsDraft = {
      digest_enabled: false,
      quiet_start: "00:00",
      quiet_end: "07:00",
      spam_filter: false,
      ad_filter: true,
    };

    expect(patchFor(DRAFT, next).patch).toEqual(next);
  });
});

describe("quietHoursError", () => {
  it("accepts the default overnight window", () => {
    expect(quietHoursError(DRAFT)).toBeNull();
  });

  it("accepts midnight", () => {
    expect(
      quietHoursError({ ...DRAFT, quiet_start: "00:00", quiet_end: "07:30" }),
    ).toBeNull();
  });

  it.each(["7:00", "23:60", "24:00", "23:00:00", "", "ab:cd"])(
    "rejects %s",
    (value) => {
      expect(
        quietHoursError({ ...DRAFT, quiet_start: value }),
      ).toBe(config.settings.quiet.timeError);
      expect(
        quietHoursError({ ...DRAFT, quiet_end: value }),
      ).toBe(config.settings.quiet.timeError);
    },
  );

  it("rejects equal start and end", () => {
    expect(
      quietHoursError({ ...DRAFT, quiet_start: "08:00", quiet_end: "08:00" }),
    ).toBe(config.settings.quiet.sameError);
  });

  it("reports a bad time before an equal window", () => {
    expect(
      quietHoursError({ ...DRAFT, quiet_start: "25:00", quiet_end: "25:00" }),
    ).toBe(config.settings.quiet.timeError);
  });
});

describe("settingsLoaded", () => {
  it("accepts a complete allowed response", () => {
    expect(settingsLoaded(me())).toBe(true);
  });

  it("rejects a denied user, a missing response, and a malformed time", () => {
    expect(settingsLoaded(me({ allowed: false }))).toBe(false);
    expect(settingsLoaded(null)).toBe(false);
    expect(settingsLoaded(undefined)).toBe(false);
    expect(settingsLoaded(me({ quiet_start: "8:00" }))).toBe(false);
  });
});

describe("summaries", () => {
  it("names the digest state", () => {
    expect(digestSummary(true)).toBe("Дайджест включён");
    expect(digestSummary(false)).toBe("Дайджест выключен");
  });

  it("describes quiet hours with the feed time zone", () => {
    expect(quietSummary("23:00", "08:00")).toBe(
      "Тихие часы: 23:00–08:00 (Черногория)",
    );
  });
});

describe("timeOptions", () => {
  it("offers 24 hours in half-hour steps", () => {
    const options = timeOptions("23:00");
    expect(options.at(0)).toBe("00:00");
    expect(options.at(-1)).toBe("23:30");
    expect(options).toHaveLength(48);
  });

  it("keeps an off-grid stored minute instead of silently changing it", () => {
    expect(timeOptions("23:15")).toContain("23:15");
    expect(timeOptions("23:15")).toHaveLength(49);
  });
});
