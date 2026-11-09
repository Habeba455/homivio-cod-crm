import { describe, expect, it } from "vitest";

import { MAX_RANGE_DAYS, parseReportRange, REPORT_TIME_ZONE, zonedDayStartUtc } from "./date-range";

/**
 * Tests check the property that matters: each boundary is local midnight in Casablanca.
 * They do not hard-code the UTC offset, because the offset comes from the time-zone database and can change.
 */
function casablancaWallClock(iso: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

describe("zonedDayStartUtc", () => {
  it("returns an instant that is local midnight on the requested Casablanca day", () => {
    const instant = zonedDayStartUtc({ y: 2026, m: 11, d: 9 }, REPORT_TIME_ZONE);
    expect(casablancaWallClock(instant)).toEqual({ date: "2026-11-09", hour: 0, minute: 0 });
  });
});

describe("parseReportRange", () => {
  it("treats two empty inputs as all time", () => {
    expect(parseReportRange("", "")).toEqual({
      ok: true,
      range: { startUtc: null, endUtc: null, fromDate: null, toDate: null },
    });
  });

  it("uses local midnight of the start day and of the day after the end day", () => {
    const result = parseReportRange("2026-11-01", "2026-11-09");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(casablancaWallClock(result.range.startUtc ?? "")).toEqual({ date: "2026-11-01", hour: 0, minute: 0 });
    expect(casablancaWallClock(result.range.endUtc ?? "")).toEqual({ date: "2026-11-10", hour: 0, minute: 0 });
  });

  it("allows an open-ended range", () => {
    const result = parseReportRange("2026-11-01", "");
    expect(result).toMatchObject({ ok: true, range: { endUtc: null, fromDate: "2026-11-01", toDate: null } });
  });

  it("rejects dates that do not exist or are not in YYYY-MM-DD form", () => {
    expect(parseReportRange("2026-02-30", "")).toMatchObject({ ok: false });
    expect(parseReportRange("2026-13-01", "")).toMatchObject({ ok: false });
    expect(parseReportRange("09/11/2026", "")).toMatchObject({ ok: false });
  });

  it("rejects an end date before the start date", () => {
    expect(parseReportRange("2026-11-09", "2026-11-01")).toMatchObject({ ok: false });
  });

  it("rejects a span longer than the maximum and accepts the maximum itself", () => {
    expect(parseReportRange("2026-01-01", "2027-01-02")).toMatchObject({ ok: false });
    expect(MAX_RANGE_DAYS).toBe(366);
    expect(parseReportRange("2026-01-01", "2027-01-01")).toMatchObject({ ok: true });
  });

  it("accepts a single-day range that starts and ends on the same local day", () => {
    const result = parseReportRange("2026-11-09", "2026-11-09");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(casablancaWallClock(result.range.startUtc ?? "")).toEqual({ date: "2026-11-09", hour: 0, minute: 0 });
    expect(casablancaWallClock(result.range.endUtc ?? "")).toEqual({ date: "2026-11-10", hour: 0, minute: 0 });
  });
});
