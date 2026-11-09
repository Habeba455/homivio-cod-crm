import Link from "next/link";
import { Suspense } from "react";

import { activePipelineCount } from "@/modules/analytics/domain/snapshot";
import { ALL_TIME_RANGE, MAX_RANGE_DAYS, parseReportRange, type ReportRange } from "@/modules/analytics/domain/date-range";
import { confirmationRate, formatRate } from "@/modules/analytics/domain/rates";
import {
  listAgentProfiles,
  loadSnapshotCounts,
  loadTerminalCounts,
  type TerminalCounts,
} from "@/modules/analytics/queries";
import { requireArea } from "@/modules/auth/guards";

/** Synchronous page: the session read and every query happen inside the Suspense boundary. */
export default function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  return (
    <Suspense
      fallback={
        <section className="card p-6" aria-busy="true" aria-live="polite">
          <p className="muted text-sm">Loading statistics…</p>
        </section>
      }
    >
      <AnalyticsContent searchParams={searchParams} />
    </Suspense>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

async function AnalyticsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireArea("admin");

  const params = await searchParams;
  const fromInput = firstValue(params.from);
  const toInput = firstValue(params.to);
  const parsed = parseReportRange(fromInput, toInput);
  const range: ReportRange = parsed.ok ? parsed.range : ALL_TIME_RANGE;

  const [snapshot, overall, agents] = await Promise.all([
    loadSnapshotCounts(),
    loadTerminalCounts(range, null),
    listAgentProfiles(),
  ]);
  const agentCounts = agents === null ? [] : await Promise.all(agents.map((agent) => loadTerminalCounts(range, agent.id)));

  const hasError = snapshot === null || overall === null || agents === null || agentCounts.some((counts) => counts === null);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Confirmation dashboard</h1>
          <p className="muted mt-1 text-sm">
            Status counts are current and cover all time. Rates and agent results cover the selected period.
          </p>
        </div>
        <Link href="/admin" className="muted text-sm underline-offset-2 hover:underline">
          ← Orders
        </Link>
      </header>

      <DateRangeForm from={fromInput} to={toInput} />

      {!parsed.ok ? (
        <div className="alert-error" role="alert">
          {parsed.problem} Showing all time instead. The range can be at most {MAX_RANGE_DAYS} days.
        </div>
      ) : null}

      {hasError ? (
        <div className="alert-error" role="alert">
          Statistics could not be loaded. Refresh the page to try again.
        </div>
      ) : null}

      {!hasError && snapshot !== null && overall !== null && agents !== null ? (
        <>
          <section aria-labelledby="status-heading" className="space-y-3">
            <h2 id="status-heading" className="text-sm font-semibold">Current status (all time)</h2>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Total orders" value={snapshot.total} hint="Every imported order" />
              <Stat label="Active pipeline" value={activePipelineCount(snapshot)} hint="New, Called and No Answer" />
              <Stat label="New" value={snapshot.New} />
              <Stat label="Called" value={snapshot.Called} />
              <Stat label="No answer" value={snapshot["No Answer"]} />
              <Stat label="Confirmed" value={snapshot.Confirmed} />
              <Stat label="Cancelled" value={snapshot.Cancelled} />
              <Stat label="Historical (excluded)" value={snapshot.historical} hint="Delivered, refused or cancelled before import" />
            </dl>
          </section>

          <RateSection overall={overall} range={range} />

          <AgentTable
            agents={agents}
            counts={agentCounts.map((counts) => counts ?? { confirmed: 0, cancelled: 0 })}
            overall={overall}
          />
        </>
      ) : null}

      <p className="muted text-xs">
        Definitions: confirmation rate = confirmed ÷ (confirmed + cancelled), counting pipeline orders whose terminal change falls in the
        period. Days use Africa/Casablanca. Full definitions are in docs/analytics.md.
      </p>
    </div>
  );
}

function DateRangeForm({ from, to }: { from: string; to: string }) {
  return (
    <form method="get" className="card flex flex-wrap items-end gap-3 p-4" role="search" aria-label="Reporting period">
      <div>
        <label htmlFor="from" className="label">
          From
        </label>
        <input id="from" name="from" type="date" defaultValue={from} className="input" />
      </div>
      <div>
        <label htmlFor="to" className="label">
          To (inclusive)
        </label>
        <input id="to" name="to" type="date" defaultValue={to} className="input" />
      </div>
      <button type="submit" className="btn btn-primary">
        Apply period
      </button>
      <Link href="/admin/analytics" className="btn btn-ghost">
        All time
      </Link>
    </form>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card p-5">
      <dt className="muted text-xs font-semibold uppercase tracking-wide">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>
      {hint !== undefined ? <p className="muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

function RateSection({ overall, range }: { overall: TerminalCounts; range: ReportRange }) {
  const result = confirmationRate(overall.confirmed, overall.cancelled);
  const period =
    range.fromDate === null && range.toDate === null
      ? "all time"
      : `${range.fromDate ?? "the start"} to ${range.toDate ?? "today"}`;

  return (
    <section aria-labelledby="rate-heading" className="card p-6">
      <h2 id="rate-heading" className="text-sm font-semibold">Overall confirmation rate ({period})</h2>
      <p className="mt-3 text-4xl font-semibold tabular-nums">{formatRate(result.rate)}</p>
      <p className="muted mt-2 text-sm">
        {result.decided === 0
          ? "No pipeline orders were confirmed or cancelled in this period, so no rate is shown."
          : `${result.confirmed} confirmed of ${result.decided} decided (${result.confirmed} confirmed, ${result.cancelled} cancelled).`}
      </p>
    </section>
  );
}

function AgentTable({
  agents,
  counts,
  overall,
}: {
  agents: { id: string; displayName: string; isActive: boolean }[];
  counts: TerminalCounts[];
  overall: TerminalCounts;
}) {
  if (agents.length === 0) {
    return (
      <section className="card p-6">
        <p className="text-sm font-medium">No agent accounts exist yet.</p>
      </section>
    );
  }

  const agentConfirmed = counts.reduce((sum, row) => sum + row.confirmed, 0);
  const agentCancelled = counts.reduce((sum, row) => sum + row.cancelled, 0);
  const adminConfirmed = overall.confirmed - agentConfirmed;
  const adminCancelled = overall.cancelled - agentCancelled;

  return (
    <section aria-labelledby="agents-heading" className="card overflow-x-auto">
      <h2 id="agents-heading" className="border-b border-slate-200 px-5 py-3 text-sm font-semibold">
        Confirmation rate by agent
      </h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">Agent</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Confirmed</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Cancelled</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Decided</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {agents.map((agent, index) => {
            const row = confirmationRate(counts[index].confirmed, counts[index].cancelled);
            return (
              <tr key={agent.id}>
                <td className="px-5 py-3">
                  {agent.displayName}
                  {agent.isActive ? null : <span className="muted ml-2 text-xs">(inactive)</span>}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{row.confirmed}</td>
                <td className="px-5 py-3 text-right tabular-nums">{row.cancelled}</td>
                <td className="px-5 py-3 text-right tabular-nums">{row.decided}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatRate(row.rate)}</td>
              </tr>
            );
          })}
          {adminConfirmed + adminCancelled > 0 ? (
            <tr>
              <td className="px-5 py-3 muted">Recorded by admins</td>
              <td className="px-5 py-3 text-right tabular-nums">{adminConfirmed}</td>
              <td className="px-5 py-3 text-right tabular-nums">{adminCancelled}</td>
              <td className="px-5 py-3 text-right tabular-nums">{adminConfirmed + adminCancelled}</td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatRate(confirmationRate(adminConfirmed, adminCancelled).rate)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
