import { config } from "../config";

/**
 * Feed dates are read in Europe/Podgorica, the product's home time zone. Every
 * label here is pure: the caller passes "now", so tests never depend on the
 * machine clock.
 */
export const FEED_TIME_ZONE = "Europe/Podgorica";

export interface ZonedDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: FEED_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(date: Date): ZonedDate {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function parse(iso: string): ZonedDate | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return partsOf(new Date(ms));
}

/** Days since 1970-01-01 in the feed time zone; used to compare calendar days. */
function ordinal(parts: ZonedDate): number {
  return Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000,
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function dayKey(iso: string): string | null {
  const parts = parse(iso);
  if (!parts) return null;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function clockTime(iso: string): string {
  const parts = parse(iso);
  if (!parts) return "";
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** «только что», «5 мин», «2 ч», «вчера», «4 дн», «20 окт». */
export function relativeTime(iso: string, now: Date): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";

  const diff = now.getTime() - ms;
  if (diff <= 0) return config.calendar.justNow;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return config.calendar.justNow;
  if (minutes < 60) return `${minutes} ${config.calendar.minutes}`;

  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours} ${config.calendar.hours}`;

  const then = parse(iso);
  if (!then) return "";

  const days = ordinal(partsOf(now)) - ordinal(then);
  if (days <= 1) return config.calendar.yesterdayRelative;
  if (days < 7) return `${days} ${config.calendar.days}`;

  return shortDate(iso, now);
}

/** «Сегодня», «Вчера», «5 ноября» (and the year only when it differs). */
export function dayDividerLabel(iso: string, now: Date): string {
  const then = parse(iso);
  if (!then) return "";

  const nowParts = partsOf(now);
  const days = ordinal(nowParts) - ordinal(then);

  if (days === 0) return config.calendar.today;
  if (days === 1) return config.calendar.yesterday;

  const month = config.calendar.monthsGenitive[then.month - 1] ?? "";
  const base = `${then.day} ${month}`.trim();
  return then.year === nowParts.year ? base : `${base} ${then.year}`;
}

/** «5 ноя» — the compact date used on older cards. */
export function shortDate(iso: string, now: Date): string {
  const then = parse(iso);
  if (!then) return "";

  const month = config.calendar.monthsShort[then.month - 1] ?? "";
  const base = `${then.day} ${month}`.trim();
  return then.year === partsOf(now).year ? base : `${base} ${then.year}`;
}

/** «Сб, 15 ноя, 20:00» — an event start in Europe/Podgorica. */
export function formatEventDate(iso: string, now: Date = new Date()): string {
  const parts = parse(iso);
  if (!parts) return "";

  const weekday =
    config.calendar.weekdaysShort[
      (((ordinal(parts) + 4) % 7) + 7) % 7
    ] ?? "";
  const month = config.calendar.monthsShort[parts.month - 1] ?? "";
  const year =
    parts.year === partsOf(now).year ? "" : ` ${parts.year}`;

  return `${capitalize(weekday)}, ${parts.day} ${month}${year}, ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** «Обновлено в 14:20». */
export function freshnessLabel(updatedAt: string): string {
  const time = clockTime(updatedAt);
  if (time === "") return "";
  return `${config.feed.status.updatedAt} ${time}`;
}

/** «Нет связи, 14:20» — the time is the last known update. */
export function staleLabel(at: string): string {
  const time = clockTime(at);
  if (time === "") return config.feed.status.stale;
  return `${config.feed.status.stale}, ${time}`;
}
