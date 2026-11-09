import { describe, expect, it } from "vitest";

import {
  buildDailySeries,
  casablancaDay,
  listDays,
  resolveOverviewPeriod,
  seriesBounds,
  shiftIsoDay,
  summarizeByActor,
  totalsFromEvents,
  type TerminalEvent,
} from "./daily";

const AGENT_A = "00000000-0000-4000-8000-00000000000a";
const AGENT_B = "00000000-0000-4000-8000-00000000000b";
const AGENT_OLD = "00000000-0000-4000-8000-00000000000c";
const OTHER = "00000000-0000-4000-8000-0000000000ff";

function event(createdAt: string, eventType: TerminalEvent["eventType"], actorId: string | null): TerminalEvent {
  return { createdAt, eventType, actorId };
}

describe("casablancaDay", () => {
  it("uses the Casablanca calendar day, not UTC", () => {
    // July is UTC+1 in Casablanca (the offset is read from the time-zone database, never hard-coded).
    expect(casablancaDay("2026-07-15T22:30:00Z")).toBe("2026-07-15");
    expect(casablancaDay("2026-07-15T23:30:00Z")).toBe("2026-07-16");
  });
});

describe("shiftIsoDay and listDays", () => {
  it("moves across month and year ends", () => {
    expect(shiftIsoDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("lists both ends inclusively, and a one-day range gives one day", () => {
    expect(listDays("2026-11-03", "2026-11-05")).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(listDays("2026-11-09", "2026-11-09")).toEqual(["2026-11-09"]);
  });

  it("returns nothing for a reversed or malformed range", () => {
    expect(listDays("2026-11-05", "2026-11-03")).toEqual([]);
    expect(listDays("bad", "2026-11-03")).toEqual([]);
  });
});

describe("buildDailySeries", () => {
  it("shows days with no activity as zero", () => {
    const series = buildDailySeries(
      [event("2026-11-03T10:00:00Z", "confirmed", AGENT_A)],
      "2026-11-02",
      "2026-11-04",
    );
    expect(series).toEqual([
      { date: "2026-11-02", confirmed: 0, cancelled: 0 },
      { date: "2026-11-03", confirmed: 1, cancelled: 0 },
      { date: "2026-11-04", confirmed: 0, cancelled: 0 },
    ]);
  });

  it("counts automatic cancellations as cancelled and ignores events outside the range", () => {
    const series = buildDailySeries(
      [
        event("2026-11-03T10:00:00Z", "cancelled", AGENT_A),
        event("2026-11-03T11:00:00Z", "auto_cancelled", AGENT_A),
        event("2026-10-01T10:00:00Z", "confirmed", AGENT_A),
      ],
      "2026-11-03",
      "2026-11-03",
    );
    expect(series).toEqual([{ date: "2026-11-03", confirmed: 0, cancelled: 2 }]);
  });

  it("the series totals equal the event totals inside the range", () => {
    const events = [
      event("2026-11-03T10:00:00Z", "confirmed", AGENT_A),
      event("2026-11-04T10:00:00Z", "cancelled", AGENT_B),
      event("2026-11-05T10:00:00Z", "confirmed", AGENT_B),
    ];
    const series = buildDailySeries(events, "2026-11-03", "2026-11-05");
    const confirmed = series.reduce((sum, point) => sum + point.confirmed, 0);
    const cancelled = series.reduce((sum, point) => sum + point.cancelled, 0);
    expect({ confirmed, cancelled }).toEqual(totalsFromEvents(events));
  });
});

describe("seriesBounds", () => {
  it("returns nothing to chart for all time with no events", () => {
    expect(seriesBounds([], null, null, "2026-11-09")).toBeNull();
  });

  it("starts all-time at the first event day and ends today", () => {
    const bounds = seriesBounds([event("2026-11-05T10:00:00Z", "confirmed", AGENT_A)], null, null, "2026-11-09");
    expect(bounds).toEqual({ from: "2026-11-05", to: "2026-11-09", clipped: false });
  });

  it("keeps the most recent days and reports clipping for very long periods", () => {
    const bounds = seriesBounds([], "2020-01-01", "2026-11-09", "2026-11-09");
    expect(bounds?.clipped).toBe(true);
    expect(bounds?.to).toBe("2026-11-09");
  });
});

describe("summarizeByActor", () => {
  const agents = [
    { id: AGENT_A, displayName: "Amina", isActive: true },
    { id: AGENT_B, displayName: "Basma", isActive: true },
    { id: AGENT_OLD, displayName: "Karim", isActive: false },
  ];

  it("shows every agent, including idle and deactivated ones, with a null rate when nothing was decided", () => {
    const lines = summarizeByActor([event("2026-11-03T10:00:00Z", "confirmed", AGENT_A)], agents);
    const idle = lines.find((line) => line.key === AGENT_OLD);
    expect(idle?.rate.decided).toBe(0);
    expect(idle?.rate.rate).toBeNull();
    expect(idle?.isActive).toBe(false);
    expect(lines.find((line) => line.key === AGENT_A)?.rate.rate).toBe(1);
  });

  it("attributes each terminal change to its actor and lines reconcile to the totals", () => {
    const events = [
      event("2026-11-03T10:00:00Z", "confirmed", AGENT_A),
      event("2026-11-03T11:00:00Z", "cancelled", AGENT_A),
      event("2026-11-04T10:00:00Z", "auto_cancelled", AGENT_B),
      event("2026-11-04T12:00:00Z", "confirmed", null),
      event("2026-11-04T13:00:00Z", "confirmed", OTHER),
    ];
    const lines = summarizeByActor(events, agents);
    const confirmed = lines.reduce((sum, line) => sum + line.confirmed, 0);
    const cancelled = lines.reduce((sum, line) => sum + line.cancelled, 0);
    expect({ confirmed, cancelled }).toEqual(totalsFromEvents(events));
    expect(lines.find((line) => line.key === AGENT_A)?.rate.rate).toBe(0.5);
    expect(lines.find((line) => line.kind === "unattributed")?.confirmed).toBe(1);
    expect(lines.find((line) => line.kind === "other")?.confirmed).toBe(1);
  });
});

describe("resolveOverviewPeriod", () => {
  const today = "2026-11-09";

  it("defaults to the last seven days, inclusive of today", () => {
    const period = resolveOverviewPeriod({ from: "", to: "", period: "" }, today);
    expect(period.fromDate).toBe("2026-11-03");
    expect(period.toDate).toBe("2026-11-09");
    expect(period.isAllTime).toBe(false);
    expect(period.notice).toBeNull();
  });

  it("supports explicit all time", () => {
    const period = resolveOverviewPeriod({ from: "", to: "", period: "all" }, today);
    expect(period.isAllTime).toBe(true);
    expect(period.range.startUtc).toBeNull();
  });

  it("handles a one-day range", () => {
    const period = resolveOverviewPeriod({ from: "2026-11-09", to: "2026-11-09", period: "" }, today);
    expect(period.fromDate).toBe("2026-11-09");
    expect(period.toDate).toBe("2026-11-09");
    expect(period.range.endUtc).not.toBeNull();
  });

  it("falls back to the last seven days with a notice for an invalid range, never a wider one", () => {
    const period = resolveOverviewPeriod({ from: "2026-11-09", to: "2026-11-01", period: "" }, today);
    expect(period.isAllTime).toBe(false);
    expect(period.fromDate).toBe("2026-11-03");
    expect(period.notice).toContain("Showing the last 7 days");
  });
});
