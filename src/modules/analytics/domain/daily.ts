/**
 * Overview arithmetic: daily series, actor attribution and period resolution. Pure, so it is unit tested.
 *
 * Every count comes from terminal order events (confirmed, cancelled, auto_cancelled). A day is a calendar day in
 * Africa/Casablanca (see date-range.ts). Each chart and table is built from the same event list, so they reconcile.
 */
import { MAX_RANGE_DAYS, REPORT_TIME_ZONE, ALL_TIME_RANGE, parseReportRange, type ReportRange } from "./date-range";
import { confirmationRate, type ConfirmationRate } from "./rates";

export type TerminalEventType = "confirmed" | "cancelled" | "auto_cancelled";

export type TerminalEvent = {
  createdAt: string;
  eventType: TerminalEventType;
  /** Null when the event has no actor, for example a system change. */
  actorId: string | null;
};

export type DailyPoint = { date: string; confirmed: number; cancelled: number };

export type ActorAgent = { id: string; displayName: string; isActive: boolean };

export type ActorLine = {
  key: string;
  name: string;
  kind: "agent" | "unattributed" | "other";
  isActive: boolean | null;
  confirmed: number;
  cancelled: number;
  rate: ConfirmationRate;
};

export type OverviewPeriod = {
  range: ReportRange;
  isAllTime: boolean;
  fromDate: string | null;
  toDate: string | null;
  /** Shown when the requested period was invalid and a default was used instead. */
  notice: string | null;
};

/** Days shown in the chart. Longer periods show the most recent days and say so. */
export const MAX_CHART_DAYS = MAX_RANGE_DAYS;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 7;

const dayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in Africa/Casablanca for a UTC instant, as YYYY-MM-DD. */
export function casablancaDay(iso: string): string {
  const parts = dayParts.formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function utcMsOfDay(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/** Adds whole days to a YYYY-MM-DD string. Calendar arithmetic only, so no time-zone drift. */
export function shiftIsoDay(day: string, delta: number): string {
  return new Date(utcMsOfDay(day) + delta * 86400000).toISOString().slice(0, 10);
}

/** Every calendar day from `from` to `to`, inclusive. Empty when the input is invalid or reversed. */
export function listDays(from: string, to: string): string[] {
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to) || from > to) return [];
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftIsoDay(day, 1)) {
    days.push(day);
  }
  return days;
}

/** A zero-filled series: days with no activity are shown as zero, never skipped. */
export function buildDailySeries(events: readonly TerminalEvent[], from: string, to: string): DailyPoint[] {
  const days = listDays(from, to);
  const byDay = new Map<string, DailyPoint>(days.map((day) => [day, { date: day, confirmed: 0, cancelled: 0 }]));
  for (const event of events) {
    const point = byDay.get(casablancaDay(event.createdAt));
    if (point === undefined) continue;
    if (event.eventType === "confirmed") point.confirmed += 1;
    else point.cancelled += 1;
  }
  return days.map((day) => byDay.get(day) ?? { date: day, confirmed: 0, cancelled: 0 });
}

export type SeriesBounds = { from: string; to: string; clipped: boolean };

/**
 * Chart bounds for a period. All-time starts at the first event day and ends today. A period longer than
 * MAX_CHART_DAYS keeps the most recent days, and `clipped` tells the page to say so. Null means nothing to chart.
 */
export function seriesBounds(
  events: readonly TerminalEvent[],
  fromDate: string | null,
  toDate: string | null,
  today: string,
): SeriesBounds | null {
  let firstEventDay: string | null = null;
  for (const event of events) {
    const day = casablancaDay(event.createdAt);
    if (firstEventDay === null || day < firstEventDay) firstEventDay = day;
  }
  const from = fromDate ?? firstEventDay;
  const to = toDate ?? today;
  if (from === null || from > to) return null;

  const earliest = shiftIsoDay(to, -(MAX_CHART_DAYS - 1));
  if (from < earliest) return { from: earliest, to, clipped: true };
  return { from, to, clipped: false };
}

export type Totals = { confirmed: number; cancelled: number };

/** Confirmed and cancelled counts. Automatic cancellations count as cancellations. */
export function totalsFromEvents(events: readonly TerminalEvent[]): Totals {
  let confirmed = 0;
  let cancelled = 0;
  for (const event of events) {
    if (event.eventType === "confirmed") confirmed += 1;
    else cancelled += 1;
  }
  return { confirmed, cancelled };
}

/**
 * Per-actor lines. Every agent appears, including agents with no activity (rate null, shown as an em dash) and
 * deactivated agents with past work. Events with no actor or an unknown actor get their own lines, so the lines
 * always add up to the totals.
 */
export function summarizeByActor(events: readonly TerminalEvent[], agents: readonly ActorAgent[]): ActorLine[] {
  const lines = new Map<string, Omit<ActorLine, "rate">>();
  for (const agent of agents) {
    lines.set(agent.id, {
      key: agent.id,
      name: agent.displayName,
      kind: "agent",
      isActive: agent.isActive,
      confirmed: 0,
      cancelled: 0,
    });
  }

  const agentIds = new Set(agents.map((agent) => agent.id));
  for (const event of events) {
    let key: string;
    let line: Omit<ActorLine, "rate"> | undefined;
    if (event.actorId === null) {
      key = "unattributed";
      line = lines.get(key) ?? { key, name: "System (no actor)", kind: "unattributed", isActive: null, confirmed: 0, cancelled: 0 };
    } else if (agentIds.has(event.actorId)) {
      key = event.actorId;
      line = lines.get(key);
    } else {
      key = `other:${event.actorId}`;
      line = lines.get(key) ?? { key, name: "Other account", kind: "other", isActive: null, confirmed: 0, cancelled: 0 };
    }
    if (line === undefined) continue;
    lines.set(line.key, line);
    if (event.eventType === "confirmed") line.confirmed += 1;
    else line.cancelled += 1;
  }

  return [...lines.values()]
    .map((line) => ({ ...line, rate: confirmationRate(line.confirmed, line.cancelled) }))
    .sort((a, b) => b.rate.decided - a.rate.decided || a.name.localeCompare(b.name));
}

/** Resolves the period from the URL. Invalid input falls back to the last 7 days with a notice, never to a wider range. */
export function resolveOverviewPeriod(
  input: { from: string; to: string; period: string },
  today: string,
): OverviewPeriod {
  const from = input.from.trim();
  const to = input.to.trim();

  if (from === "" && to === "") {
    if (input.period === "all") {
      return { range: ALL_TIME_RANGE, isAllTime: true, fromDate: null, toDate: null, notice: null };
    }
    return lastDays(DEFAULT_DAYS, today, null);
  }

  const parsed = parseReportRange(from, to);
  if (!parsed.ok) {
    return lastDays(DEFAULT_DAYS, today, `${parsed.problem} Showing the last ${DEFAULT_DAYS} days instead.`);
  }
  return {
    range: parsed.range,
    isAllTime: false,
    fromDate: parsed.range.fromDate,
    toDate: parsed.range.toDate,
    notice: null,
  };
}

function lastDays(count: number, today: string, notice: string | null): OverviewPeriod {
  const from = shiftIsoDay(today, -(count - 1));
  const parsed = parseReportRange(from, today);
  const range = parsed.ok ? parsed.range : ALL_TIME_RANGE;
  return { range, isAllTime: false, fromDate: from, toDate: today, notice };
}
