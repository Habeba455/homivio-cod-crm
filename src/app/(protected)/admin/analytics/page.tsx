import Link from "next/link";
import { Suspense } from "react";

import { activePipelineCount, type SnapshotCounts } from "@/modules/analytics/domain/snapshot";
import { ALL_TIME_RANGE, MAX_RANGE_DAYS, parseReportRange, type ReportRange } from "@/modules/analytics/domain/date-range";
import { confirmationRate, formatRate } from "@/modules/analytics/domain/rates";
import {
  listAgentProfiles,
  loadSnapshotCounts,
  loadTerminalCounts,
  type AgentProfile,
  type TerminalCounts,
} from "@/modules/analytics/queries";
import { requireArea } from "@/modules/auth/guards";

/** Synchronous page: the session read and every query happen inside the Suspense boundary. */
export default function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  return (
    <Suspense
      fallback={
        <section className="ov-panel" aria-busy="true" aria-live="polite">
          <p className="ov-empty">Loading statistics…</p>
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
  const ready = !hasError && snapshot !== null && overall !== null && agents !== null;

  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <h1 className="ov-title">Confirmation dashboard</h1>
          <p className="ov-sub">Status counts are current. Rates and agent results cover the selected period.</p>
        </div>
        <PeriodControl from={fromInput} to={toInput} isAllTime={!parsed.ok || (fromInput === "" && toInput === "")} />
      </header>

      {!parsed.ok ? (
        <p role="alert" className="ov-alert">
          {parsed.problem} Showing all time instead. The range can be at most {MAX_RANGE_DAYS} days.
        </p>
      ) : null}
      {hasError ? (
        <p role="alert" className="ov-alert">Statistics could not be loaded. Refresh the page to try again.</p>
      ) : null}

      {ready ? (
        <>
          <section aria-label="Current status, all time" className="ov-kpis">
            <Tile label="Total orders" value={snapshot.total} sample="Every imported order" />
            <Tile label="Active pipeline" value={activePipelineCount(snapshot)} sample="New, called and no answer" />
            <Tile label="Confirmed" value={snapshot.Confirmed} sample="All time" />
            <Tile label="Cancelled" value={snapshot.Cancelled} sample="All time, including automatic" />
          </section>

          <div className="ov-row2">
            <section aria-labelledby="rate-heading" className="ov-panel">
              <div className="ov-panel-head">
                <h2 id="rate-heading" className="ov-panel-title">Confirmation rate</h2>
                <span className="ov-scope">{periodText(range)}</span>
              </div>
              <RateSummary overall={overall} />
              <AgentBars agents={agents} counts={agentCounts.map((counts) => counts ?? { confirmed: 0, cancelled: 0 })} />
            </section>

            <section aria-labelledby="status-heading" className="ov-panel">
              <div className="ov-panel-head">
                <h2 id="status-heading" className="ov-panel-title">Current status</h2>
                <span className="ov-scope">All time</span>
              </div>
              <StatusDonut snapshot={snapshot} />
            </section>
          </div>

          <AgentTable
            agents={agents}
            counts={agentCounts.map((counts) => counts ?? { confirmed: 0, cancelled: 0 })}
            overall={overall}
          />
        </>
      ) : null}

      <p className="ov-note">
        Confirmation rate = confirmed ÷ (confirmed + cancelled), counting pipeline orders whose terminal change falls in the period.
        Days use Africa/Casablanca. Full definitions are in docs/analytics.md.{" "}
        <Link href="/admin" className="underline-offset-2 hover:underline">
          Back to Orders
        </Link>
      </p>
    </div>
  );
}

const count = (value: number) => value.toLocaleString("en-US");

function periodText(range: ReportRange): string {
  if (range.fromDate === null && range.toDate === null) return "All time";
  return `${range.fromDate ?? "the start"} to ${range.toDate ?? "today"}`;
}

function Tile({ label, value, sample }: { label: string; value: number; sample: string }) {
  return (
    <div className="ov-kpi">
      <p className="ov-kpi-label">{label}</p>
      <p className="ov-kpi-value">{count(value)}</p>
      <p className="ov-kpi-sample">{sample}</p>
    </div>
  );
}

function PeriodControl({ from, to, isAllTime }: { from: string; to: string; isAllTime: boolean }) {
  return (
    <details className="ov-date">
      <summary className="ov-date-button">
        <span>{isAllTime ? "All time" : "Custom period"}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="ov-date-panel">
        <div className="ov-presets">
          <Link href="/admin/analytics" aria-current={isAllTime ? "true" : undefined} className="ov-preset">
            All time
          </Link>
        </div>
        <form method="get" action="/admin/analytics" role="search" aria-label="Reporting period" className="ov-custom">
          <label className="ov-field">
            <span>From</span>
            <input name="from" type="date" defaultValue={from} />
          </label>
          <label className="ov-field">
            <span>To (inclusive)</span>
            <input name="to" type="date" defaultValue={to} />
          </label>
          <button type="submit" className="ov-apply">Apply</button>
        </form>
        <p className="ov-tz">Days follow Africa/Casablanca time.</p>
      </div>
    </details>
  );
}

function RateSummary({ overall }: { overall: TerminalCounts }) {
  const result = confirmationRate(overall.confirmed, overall.cancelled);
  const rate = result.rate;
  return (
    <div className="ov-rate-summary">
      <p className="ov-kpi-value">{formatRate(rate)}</p>
      <p className="ov-kpi-sample">
        {result.decided === 0
          ? "No pipeline orders were confirmed or cancelled in this period."
          : `${result.confirmed} confirmed of ${result.decided} decided, ${result.cancelled} cancelled.`}
      </p>
      <div className="ov-meter" aria-hidden="true">
        <span style={{ "--w": `${rate === null ? 0 : Math.round(rate * 100)}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

function AgentBars({ agents, counts }: { agents: AgentProfile[]; counts: TerminalCounts[] }) {
  if (agents.length === 0) {
    return <p className="ov-empty">No agent accounts exist yet.</p>;
  }
  return (
    <ul className="ov-agents ov-agents-top">
      {agents.map((agent, index) => {
        const row = confirmationRate(counts[index].confirmed, counts[index].cancelled);
        return (
          <li key={agent.id} className="ov-agent">
            <span className="ov-agent-name">
              {agent.displayName}
              {agent.isActive ? null : <span className="ov-muted"> (inactive)</span>}
            </span>
            <span className="ov-agent-track" aria-hidden="true">
              <span className="ov-agent-fill" style={{ "--w": row.rate === null ? "0%" : `${row.rate * 100}%` } as React.CSSProperties} />
            </span>
            <span className="ov-agent-rate">{formatRate(row.rate)}</span>
            <span className="ov-agent-decided">{row.decided} decided</span>
          </li>
        );
      })}
    </ul>
  );
}

const DONUT_ROWS = [
  { key: "New", label: "New", color: "var(--ov-new)" },
  { key: "Called", label: "Called", color: "var(--ov-called)" },
  { key: "No Answer", label: "No answer", color: "var(--ov-no-answer)" },
  { key: "Confirmed", label: "Confirmed", color: "var(--ov-confirmed)" },
  { key: "Cancelled", label: "Cancelled", color: "var(--ov-cancelled)" },
] as const;

/** Donut of pipeline and terminal orders. Historical orders are excluded, as on the Overview. */
function StatusDonut({ snapshot }: { snapshot: SnapshotCounts }) {
  const values = DONUT_ROWS.map((row) => ({ ...row, value: snapshot[row.key] }));
  const total = values.reduce((sum, row) => sum + row.value, 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="ov-donut-layout">
      <figure className="ov-donut-fig">
        <svg viewBox="0 0 120 120" className="ov-donut" role="img" aria-label={`${count(total)} orders in the pipeline or decided`}>
          <circle cx="60" cy="60" r={radius} className="ov-donut-track" />
          {total > 0
            ? values.map((row) => {
                if (row.value === 0) return null;
                const length = (row.value / total) * circumference;
                const segment = (
                  <circle
                    key={row.key}
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={row.color}
                    strokeWidth="12"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 60 60)"
                  />
                );
                offset += length;
                return segment;
              })
            : null}
          <text x="60" y="58" textAnchor="middle" className="ov-donut-value">{count(total)}</text>
          <text x="60" y="74" textAnchor="middle" className="ov-donut-label">orders</text>
        </svg>
      </figure>
      <ul className="ov-donut-legend">
        {values.map((row) => (
          <li key={row.key}>
            <span className="ov-donut-name">
              <i className="ov-sw" style={{ background: row.color }} aria-hidden="true" />
              {row.label}
            </span>
            <span className="ov-donut-count">{count(row.value)}</span>
          </li>
        ))}
        <li className="ov-donut-note">
          <span>Active pipeline</span>
          <span>{count(activePipelineCount(snapshot))}</span>
        </li>
        <li className="ov-donut-note">
          <span>Historical, excluded</span>
          <span>{count(snapshot.historical)}</span>
        </li>
      </ul>
    </div>
  );
}

function AgentTable({
  agents,
  counts,
  overall,
}: {
  agents: AgentProfile[];
  counts: TerminalCounts[];
  overall: TerminalCounts;
}) {
  if (agents.length === 0) {
    return null;
  }

  const agentConfirmed = counts.reduce((sum, row) => sum + row.confirmed, 0);
  const agentCancelled = counts.reduce((sum, row) => sum + row.cancelled, 0);
  const adminConfirmed = overall.confirmed - agentConfirmed;
  const adminCancelled = overall.cancelled - agentCancelled;

  return (
    <section aria-labelledby="agents-heading" className="ov-panel ov-table-panel">
      <div className="ov-panel-head">
        <h2 id="agents-heading" className="ov-panel-title">Agent detail</h2>
      </div>
      <div className="ov-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Confirmed</th>
              <th scope="col">Cancelled</th>
              <th scope="col">Decided</th>
              <th scope="col">Rate</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, index) => {
              const row = confirmationRate(counts[index].confirmed, counts[index].cancelled);
              return (
                <tr key={agent.id}>
                  <td className="ov-td-left">
                    {agent.displayName}
                    {agent.isActive ? null : <span className="ov-muted"> (inactive)</span>}
                  </td>
                  <td>{row.confirmed}</td>
                  <td>{row.cancelled}</td>
                  <td>{row.decided}</td>
                  <td>{formatRate(row.rate)}</td>
                </tr>
              );
            })}
            {adminConfirmed + adminCancelled > 0 ? (
              <tr>
                <td className="ov-td-left ov-muted">Recorded by admins</td>
                <td>{adminConfirmed}</td>
                <td>{adminCancelled}</td>
                <td>{adminConfirmed + adminCancelled}</td>
                <td>{formatRate(confirmationRate(adminConfirmed, adminCancelled).rate)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
