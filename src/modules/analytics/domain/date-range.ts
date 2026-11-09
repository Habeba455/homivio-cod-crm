/**
 * Reporting date range. Pure, so it is unit tested.
 *
 * Dates are calendar days in Africa/Casablanca (architecture §8 and §14). A day runs from local midnight to the next
 * local midnight, converted to UTC. The end date is inclusive in the UI and exclusive in the query.
 * The offset is read from the time-zone database for each date, not hard-coded, so the boundaries stay right
 * through clock changes.
 */

export const REPORT_TIME_ZONE = "Africa/Casablanca";
export const MAX_RANGE_DAYS = 366;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ReportRange = {
  /** UTC instant for the start of the first day, inclusive. Null when unbounded. */
  startUtc: string | null;
  /** UTC instant for the day after the last day, exclusive. Null when unbounded. */
  endUtc: string | null;
  /** Calendar days as entered, for display. */
  fromDate: string | null;
  toDate: string | null;
};

export type ParsedReportRange = { ok: true; range: ReportRange } | { ok: false; problem: string };

/** No bounds: every event counts. */
export const ALL_TIME_RANGE: ReportRange = { startUtc: null, endUtc: null, fromDate: null, toDate: null };

/** Parses YYYY-MM-DD and rejects dates that do not exist, such as 2026-02-30. */
function parseCalendarDay(value: string): { y: number; m: number; d: number } | null {
  if (!DATE_PATTERN.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

function addDays(day: { y: number; m: number; d: number }, count: number): { y: number; m: number; d: number } {
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d + count));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

/** Offset of a time zone from UTC, in minutes, at a given instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return Math.round((wallClockAsUtc - utcMs) / 60000);
}

/** UTC instant of local midnight at the start of a calendar day in the given time zone. */
export function zonedDayStartUtc(day: { y: number; m: number; d: number }, timeZone: string): string {
  const localAsUtc = Date.UTC(day.y, day.m - 1, day.d);
  // Two passes: the first guess can sit on the wrong side of an offset change near midnight.
  const firstGuess = localAsUtc - offsetMinutes(localAsUtc, timeZone) * 60000;
  const corrected = localAsUtc - offsetMinutes(firstGuess, timeZone) * 60000;
  return new Date(corrected).toISOString();
}

/**
 * Parses the two form values. Both empty means all time. One empty means that side is unbounded.
 * Invalid input returns a problem, not an unbounded range, so a typo never silently widens the report.
 */
export function parseReportRange(fromInput: string, toInput: string): ParsedReportRange {
  const from = fromInput.trim();
  const to = toInput.trim();
  if (from === "" && to === "") return { ok: true, range: ALL_TIME_RANGE };

  const fromDay = from === "" ? null : parseCalendarDay(from);
  const toDay = to === "" ? null : parseCalendarDay(to);
  if ((from !== "" && fromDay === null) || (to !== "" && toDay === null)) {
    return { ok: false, problem: "Enter dates as real calendar days." };
  }

  if (fromDay !== null && toDay !== null) {
    const spanDays = (Date.UTC(toDay.y, toDay.m - 1, toDay.d) - Date.UTC(fromDay.y, fromDay.m - 1, fromDay.d)) / 86400000 + 1;
    if (spanDays < 1) {
      return { ok: false, problem: "The end date must be on or after the start date." };
    }
    if (spanDays > MAX_RANGE_DAYS) {
      return { ok: false, problem: `The range can be at most ${MAX_RANGE_DAYS} days.` };
    }
  }

  return {
    ok: true,
    range: {
      startUtc: fromDay === null ? null : zonedDayStartUtc(fromDay, REPORT_TIME_ZONE),
      endUtc: toDay === null ? null : zonedDayStartUtc(addDays(toDay, 1), REPORT_TIME_ZONE),
      fromDate: from === "" ? null : from,
      toDate: to === "" ? null : to,
    },
  };
}
