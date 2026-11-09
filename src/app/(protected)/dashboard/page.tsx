import { connection } from "next/server";
import { Suspense } from "react";

import {
  buildDailySeries,
  casablancaDay,
  resolveOverviewPeriod,
  seriesBounds,
  shiftIsoDay,
  summarizeByActor,
  totalsFromEvents,
  type OverviewPeriod,
} from "@/modules/analytics/domain/daily";
import { buildCityMapData } from "@/modules/analytics/domain/cities";
import { loadOrderCityAggregate } from "@/modules/analytics/city-queries";
import { loadAttentionCounts, loadTerminalEvents } from "@/modules/analytics/overview-queries";
import { listAgentProfiles, loadSnapshotCounts } from "@/modules/analytics/queries";
import { requireArea } from "@/modules/auth/guards";

import {
  OverviewView,
  periodLabel,
  type OverviewViewProps,
  type Preset,
  type TerminalProblem,
} from "../_components/overview-parts";

/**
 * Admin Overview. Agents never reach this page: requireArea("admin") sends them to their own workspace.
 * Synchronous page: the session read and every query happen inside the Suspense boundary.
 * Reads only. Nothing on this page writes to the database.
 */
export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<OverviewLoading />}>
      <OverviewContent searchParams={searchParams} />
    </Suspense>
  );
}

function OverviewLoading() {
  return (
    <section className="card p-6" aria-busy="true" aria-live="polite">
      <p className="muted text-sm">Loading the overview…</p>
    </section>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

async function OverviewContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireArea("admin");
  // The date is read per request, so "today" is never frozen into a cached page.
  await connection();

  const params = await searchParams;
  const today = casablancaDay(new Date().toISOString());
  const period = resolveOverviewPeriod(
    { from: firstValue(params.from), to: firstValue(params.to), period: firstValue(params.period) },
    today,
  );

  const [terminal, snapshot, attention, agents, cities] = await Promise.all([
    loadTerminalEvents(period.range),
    loadSnapshotCounts(),
    loadAttentionCounts(),
    listAgentProfiles(),
    loadOrderCityAggregate(),
  ]);

  const terminalProblem: TerminalProblem = terminal.ok ? null : terminal.reason;
  const totalEvents = terminal.ok ? terminal.events.length : terminal.reason === "too_many" ? terminal.total : 0;
  const events = terminal.ok ? terminal.events : [];

  const presets = buildPresets(today, period);
  const props: OverviewViewProps = {
    period,
    periodLabel: periodLabel(period, today),
    presetLabel: presets.find((preset) => preset.active)?.label ?? periodLabel(period, today),
    presets,
    today,
    terminalProblem,
    totalEvents,
    totals: terminal.ok ? totalsFromEvents(events) : null,
    bounds: terminal.ok ? seriesBounds(events, period.fromDate, period.toDate, today) : null,
    series: [],
    actorLines:
      terminal.ok && agents !== null
        ? summarizeByActor(
            events,
            agents.map((agent) => ({ id: agent.id, displayName: agent.displayName, isActive: agent.isActive })),
          )
        : null,
    attention,
    snapshot,
    cityMap: cities.ok ? buildCityMapData(cities.aggregate) : null,
  };

  if (terminal.ok && props.bounds !== null) {
    props.series = buildDailySeries(events, props.bounds.from, props.bounds.to);
  }

  return <OverviewView {...props} />;
}

/** Quick periods are plain links, so they work without JavaScript and can be reached by keyboard. */
function buildPresets(today: string, period: OverviewPeriod): Preset[] {
  const span = (days: number) => ({ from: shiftIsoDay(today, -(days - 1)), to: today });
  const last7 = span(7);
  const last30 = span(30);
  return [
    {
      label: "Today",
      href: `/dashboard?from=${today}&to=${today}`,
      active: !period.isAllTime && period.fromDate === today && period.toDate === today,
    },
    {
      label: "Last 7 days",
      href: `/dashboard?from=${last7.from}&to=${last7.to}`,
      active: !period.isAllTime && period.fromDate === last7.from && period.toDate === last7.to,
    },
    {
      label: "Last 30 days",
      href: `/dashboard?from=${last30.from}&to=${last30.to}`,
      active: !period.isAllTime && period.fromDate === last30.from && period.toDate === last30.to,
    },
    { label: "All time", href: "/dashboard?period=all", active: period.isAllTime },
  ];
}
