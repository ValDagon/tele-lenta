import { describe, expect, it } from "vitest";

import {
  clockTime,
  dayDividerLabel,
  dayKey,
  formatEventDate,
  freshnessLabel,
  relativeTime,
  shortDate,
  staleLabel,
} from "./time";

// 2026-11-05 12:00 in Podgorica (CET, UTC+1).
const NOW = new Date("2026-11-05T11:00:00.000Z");

describe("relative time", () => {
  it("says «только что» under a minute and for a future date", () => {
    expect(relativeTime("2026-11-05T10:59:30.000Z", NOW)).toBe("только что");
    expect(relativeTime("2026-11-05T12:30:00.000Z", NOW)).toBe("только что");
  });

  it("counts minutes and hours", () => {
    expect(relativeTime("2026-11-05T10:55:00.000Z", NOW)).toBe("5 мин");
    expect(relativeTime("2026-11-05T09:00:00.000Z", NOW)).toBe("2 ч");
  });

  it("says «вчера» for the previous calendar day and keeps counting days", () => {
    expect(relativeTime("2026-11-04T11:00:00.000Z", NOW)).toBe("вчера");
    expect(relativeTime("2026-11-01T11:00:00.000Z", NOW)).toBe("4 дн");
  });

  it("falls back to a short date after a week", () => {
    expect(relativeTime("2026-10-20T11:00:00.000Z", NOW)).toBe("20 окт");
  });

  it("returns an empty label for an unparseable date", () => {
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("day dividers", () => {
  it("labels today and yesterday in the feed time zone", () => {
    expect(dayDividerLabel("2026-11-05T00:30:00.000Z", NOW)).toBe("Сегодня");
    expect(dayDividerLabel("2026-11-04T22:30:00.000Z", NOW)).toBe("Вчера");
  });

  it("uses the genitive day and month for older days", () => {
    expect(dayDividerLabel("2026-11-01T10:00:00.000Z", NOW)).toBe("1 ноября");
  });

  it("keeps the year only when it differs", () => {
    expect(dayDividerLabel("2025-12-31T10:00:00.000Z", NOW)).toBe(
      "31 декабря 2025",
    );
  });

  it("compares days in Podgorica, not UTC", () => {
    // 23:30 UTC on 4 November is already 00:30 on 5 November in Podgorica.
    expect(dayKey("2026-11-04T23:30:00.000Z")).toBe("2026-11-05");
  });
});

describe("event dates", () => {
  it("formats a start in Europe/Podgorica", () => {
    expect(formatEventDate("2026-11-14T19:00:00.000Z", NOW)).toBe(
      "Сб, 14 ноя, 20:00",
    );
  });

  it("adds the year when it is not the current one", () => {
    expect(formatEventDate("2027-01-10T18:30:00.000Z", NOW)).toBe(
      "Вс, 10 янв 2027, 19:30",
    );
  });
});

describe("feed clock labels", () => {
  it("formats the freshness and stale lines", () => {
    expect(freshnessLabel("2026-11-05T13:20:00.000Z")).toBe(
      "Обновлено в 14:20",
    );
    expect(staleLabel("2026-11-05T13:20:00.000Z")).toBe("Нет связи, 14:20");
  });

  it("falls back to the bare stale label without a usable time", () => {
    expect(staleLabel("nope")).toBe("Нет связи");
  });

  it("formats clock times and short dates", () => {
    expect(clockTime("2026-11-05T13:05:00.000Z")).toBe("14:05");
    expect(shortDate("2026-10-20T11:00:00.000Z", NOW)).toBe("20 окт");
  });
});
