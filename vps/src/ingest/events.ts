/**
 * Deterministic event start parsing for event sources.
 *
 * An event is a listing only when a start date AND a start time parse. A post
 * in an events source without a time is not silently downgraded to a
 * classified: the caller records it in `parser_failures` and keeps it out of
 * the feed.
 *
 * Supported shapes:
 *
 * - `5 ноября в 19:00`, `5 ноября 19:00`, `5 ноября 2026 в 19:00`
 * - `05.11 19:00`, `05.11.2026 19:00`, `5.11.26 19.00`
 * - `2026-11-05 19:00`, `2026-11-05T19:00:00+01:00`
 * - the same with Montenegrin month names (`5. novembra u 19:00`)
 *
 * Months are Russian genitive/nominative forms plus abbreviations, and the
 * Serbian/Montenegrin names in both scripts. The year is inferred from the
 * publish date and rolled forward one year only when the parsed start is more
 * than 180 days in the past. Wall-clock times are Europe/Podgorica; the result
 * is ISO 8601 UTC.
 */

const MONTHS: Readonly<Record<string, number>> = {
  // Russian
  январь: 1, января: 1, янв: 1,
  февраль: 2, февраля: 2, фев: 2, февр: 2,
  март: 3, марта: 3, мар: 3,
  апрель: 4, апреля: 4, апр: 4,
  май: 5, мая: 5,
  июнь: 6, июня: 6, июн: 6,
  июль: 7, июля: 7, июл: 7,
  август: 8, августа: 8, авг: 8,
  сентябрь: 9, сентября: 9, сен: 9, сент: 9,
  октябрь: 10, октября: 10, окт: 10,
  ноябрь: 11, ноября: 11, ноя: 11, нояб: 11,
  декабрь: 12, декабря: 12, дек: 12,
  // Serbian / Montenegrin, Latin and Cyrillic
  januar: 1, januara: 1, јануар: 1, јануара: 1,
  februar: 2, februara: 2, фебруар: 2, фебруара: 2,
  mart: 3, marta: 3,
  april: 4, aprila: 4, април: 4, априла: 4,
  maj: 5, maja: 5, мај: 5, маја: 5,
  jun: 6, juna: 6, јун: 6, јуна: 6,
  jul: 7, jula: 7, јул: 7, јула: 7,
  avgust: 8, avgusta: 8,
  septembar: 9, septembra: 9, септембар: 9, септембра: 9,
  oktobar: 10, oktobra: 10, октобар: 10, октобра: 10,
  novembar: 11, novembra: 11, новембар: 11, новембра: 11,
  decembar: 12, decembra: 12, децембар: 12, децембра: 12,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** More than this many days in the past means the year was meant as next year. */
export const EVENT_YEAR_ROLL_DAYS = 180;

const TIME_ZONE = 'Europe/Podgorica';

export type EventParseResult =
  | { kind: 'parsed'; startsAt: string }
  | { kind: 'unparseable'; error: string };

interface DateMatch {
  index: number;
  end: number;
  year: number | null;
  month: number;
  day: number;
  /** When the date form itself carries a time (ISO), keep it. */
  time?: { hour: number; minute: number };
}

interface TimeMatch {
  index: number;
  end: number;
  hour: number;
  minute: number;
}

function validDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function findIsoDate(text: string): DateMatch | null {
  const pattern = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!validDay(year, month, day)) continue;
    const hour = match[4] === undefined ? undefined : Number(match[4]);
    const minute = match[5] === undefined ? undefined : Number(match[5]);
    const time = hour !== undefined && minute !== undefined && hour <= 23 && minute <= 59
      ? { hour, minute }
      : undefined;
    const result: DateMatch = {
      index: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
    };
    if (time !== undefined) result.time = time;
    return result;
  }
  return null;
}

function findNumericDate(text: string): DateMatch | null {
  const pattern = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const rawYear = match[3];
    const year = rawYear === undefined ? null : rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    if (!validDay(year ?? 2000, month, day)) continue;
    return {
      index: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
    };
  }
  return null;
}

function findWordDate(text: string): DateMatch | null {
  const pattern = /(\d{1,2})\.?\s+([\p{L}]+)(?:\s+(\d{4}))?/gu;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const day = Number(match[1]);
    const word = match[2]?.toLowerCase();
    if (word === undefined) continue;
    const month = MONTHS[word];
    if (month === undefined) continue;
    const rawYear = match[3];
    const year = rawYear === undefined ? null : Number(rawYear);
    if (!validDay(year ?? 2000, month, day)) continue;
    return {
      index: match.index,
      end: match.index + match[0].length,
      year,
      month,
      day,
    };
  }
  return null;
}

function findDates(text: string): DateMatch[] {
  const dates = [findIsoDate(text), findNumericDate(text), findWordDate(text)].filter(
    (date): date is DateMatch => date !== null,
  );
  dates.sort((a, b) => a.index - b.index);
  return dates;
}

function findTimes(text: string, date: DateMatch): TimeMatch[] {
  if (date.time !== undefined) {
    return [{ index: date.index, end: date.end, hour: date.time.hour, minute: date.time.minute }];
  }

  const pattern = /(\d{1,2})[:.](\d{2})(?!\d)/g;
  const times: TimeMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const index = match.index;
    const end = index + match[0].length;
    // The numeric date form itself looks like a time (`05.11`), so skip any
    // time match that overlaps the date span.
    if (index < date.end && end > date.index) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    times.push({ index, end, hour, minute });
  }
  return times;
}

function zoneOffsetMs(utcMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - utcMs;
}

/** Wall-clock Europe/Podgorica → UTC epoch milliseconds. */
function zonedToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMs(guess);
  let timestamp = guess - firstOffset;
  const secondOffset = zoneOffsetMs(timestamp);
  if (secondOffset !== firstOffset) timestamp = guess - secondOffset;
  return timestamp;
}

/**
 * Parses an event start from the post text relative to its publication time.
 * Returns an explicit `unparseable` result — never a classified fallback — when
 * the date, the time, or both are missing or invalid.
 */
export function parseEventStart(text: string, publishedAt: string): EventParseResult {
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) {
    return { kind: 'unparseable', error: `invalid publish time "${publishedAt}"` };
  }

  const dates = findDates(text);
  const date = dates[0];
  if (date === undefined) {
    return { kind: 'unparseable', error: 'event start date is missing or unrecognised' };
  }

  const times = findTimes(text, date);
  if (times.length === 0) {
    return { kind: 'unparseable', error: 'event start time is missing or unrecognised' };
  }

  const time = times.reduce((closest, candidate) => {
    const distance = Math.abs(candidate.index - date.end);
    const bestDistance = Math.abs(closest.index - date.end);
    return distance < bestDistance ? candidate : closest;
  });

  const publishedDate = new Date(publishedMs);
  const year = date.year ?? publishedDate.getUTCFullYear();
  if (!validDay(year, date.month, date.day)) {
    return { kind: 'unparseable', error: `invalid event date ${date.day}.${date.month}.${year}` };
  }

  let startsAt = zonedToUtcMs(year, date.month, date.day, time.hour, time.minute);

  // The roll-forward is a fix for an inferred year only. An explicit year
  // (including a two-digit one) is the author's statement and is kept as is,
  // even when it lies in the past.
  if (date.year === null && startsAt < publishedMs - EVENT_YEAR_ROLL_DAYS * DAY_MS) {
    const rolledYear = year + 1;
    if (!validDay(rolledYear, date.month, date.day)) {
      return { kind: 'unparseable', error: `invalid event date after year rollover` };
    }
    startsAt = zonedToUtcMs(rolledYear, date.month, date.day, time.hour, time.minute);
  }

  return { kind: 'parsed', startsAt: new Date(startsAt).toISOString() };
}
