/**
 * Quiet hours for the Дайджест (spec «Bot and digest»).
 *
 * Quiet hours are wall-clock times in the user's zone, not a fixed UTC offset.
 * Podgorica switches between CET and CEST, so every check resolves the local
 * time through `Intl.DateTimeFormat` for the requested instant. A hardcoded
 * `+01:00` would shift the window by an hour for half the year.
 *
 * The module is pure: no network, no database, no clock of its own.
 */

/** The digest time zone; v1 has one region, so this is a constant. */
export const DIGEST_TIME_ZONE = 'Europe/Podgorica';

const MINUTES_PER_DAY = 24 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Minutes from local midnight for `iso` in `timeZone`.
 *
 * `hour12: false` is specified because it is the documented switch for the
 * 24-hour clock, but some ICU builds still render midnight as `24:00`; the
 * `% 24` fold normalizes that to `0`.
 */
export function localMinutes(iso: string, timeZone: string = DIGEST_TIME_ZONE): number {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`invalid ISO timestamp: ${iso}`);
  }

  let hour = 0;
  let minute = 0;
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }

  return (hour % 24) * 60 + minute;
}

/** Parses a stored `HH:MM` setting; malformed values disable the window. */
function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * True when `iso` falls inside the `[start, end)` quiet window.
 *
 * `start > end` crosses midnight (23:00-08:00), so 23:00 through 07:59 is
 * quiet and 08:00 is not. `start === end` is an empty window, never a
 * whole-day silence.
 */
export function isQuietTime(
  start: string,
  end: string,
  iso: string,
  timeZone: string = DIGEST_TIME_ZONE,
): boolean {
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return false;

  const minutes = localMinutes(iso, timeZone);
  if (minutes < 0 || minutes >= MINUTES_PER_DAY) return false;

  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  return minutes >= startMinutes || minutes < endMinutes;
}
