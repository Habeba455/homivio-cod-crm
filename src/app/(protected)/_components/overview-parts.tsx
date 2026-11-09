import Link from "next/link";
import type { CSSProperties } from "react";

import {
  MAX_CHART_DAYS,
  type ActorLine,
  type DailyPoint,
  type OverviewPeriod,
  type SeriesBounds,
  type Totals,
} from "@/modules/analytics/domain/daily";
import type { CityMapData } from "@/modules/analytics/domain/cities";
import { confirmationRate } from "@/modules/analytics/domain/rates";
import { activePipelineCount, type SnapshotCounts } from "@/modules/analytics/domain/snapshot";
import type { AttentionCounts } from "@/modules/analytics/overview-queries";

import { CityMap } from "./city-map";

/**
 * Admin Overview presentation. Server-rendered except the city map. Styles are scoped under `.ov`.
 * Every figure comes from live data. No sparklines or trends are drawn without real history behind them.
 */

export type Preset = { label: string; href: string; active: boolean };

export type TerminalProblem = "too_many" | "failed" | null;

export type OverviewViewProps = {
  period: OverviewPeriod;
  periodLabel: string;
  presetLabel: string;
  presets: Preset[];
  today: string;
  terminalProblem: TerminalProblem;
  totalEvents: number;
  totals: Totals | null;
  bounds: SeriesBounds | null;
  series: DailyPoint[];
  actorLines: ActorLine[] | null;
  attention: AttentionCounts | null;
  snapshot: SnapshotCounts | null;
  /** Null when the city counts could not be loaded or the order count is above the map limit. */
  cityMap: CityMapData | null;
};

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const shortDayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

function utcOfDay(day: string): Date {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
}

export function formatDay(day: string): string {
  return dayFormat.format(utcOfDay(day));
}

export function periodLabel(period: OverviewPeriod, today: string): string {
  if (period.isAllTime) return "All time";
  const to = period.toDate ?? today;
  if (period.fromDate === null) return `Up to ${formatDay(to)}`;
  if (period.fromDate === to) return formatDay(to);
  return `${formatDay(period.fromDate)} – ${formatDay(to)}`;
}

/** Whole-number percentage. A null rate shows an em dash. */
export function formatWholePercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

function percentOf(value: number, max: number): string {
  return `${max === 0 ? 0 : (value / max) * 100}%`;
}

const count = (value: number) => value.toLocaleString("en-US");

export function OverviewView(props: OverviewViewProps) {
  const rate = props.totals === null ? null : confirmationRate(props.totals.confirmed, props.totals.cancelled);
  const failed = props.terminalProblem === "failed";
  const open = props.snapshot === null ? null : activePipelineCount(props.snapshot);

  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <h1 className="ov-title">Overview</h1>
          <p className="ov-sub">Imported orders and call outcomes.</p>
        </div>
        <DateControl presetLabel={props.presetLabel} presets={props.presets} period={props.period} />
      </header>

      {props.period.notice !== null ? <p role="status" className="ov-notice">{props.period.notice}</p> : null}
      {props.terminalProblem === "too_many" ? (
        <p role="status" className="ov-notice">
          This period has {count(props.totalEvents)} decisions, more than the Overview loads at once. Choose a shorter period.
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="ov-alert">
          Confirmations and cancellations could not be loaded. Refresh the page to try again.
        </p>
      ) : null}

      <section aria-label="Key figures" className="ov-kpis">
        <KpiTile
          label="Total orders"
          value={props.snapshot === null ? "—" : count(props.snapshot.total)}
          sample="All imported orders"
          definition="Every imported order, including historical orders. Not limited to the selected period."
        />
        <KpiTile
          label="Open now"
          value={open === null ? "—" : count(open)}
          sample="New, called or no answer"
          definition="Orders in the pipeline that are New, Called or No Answer. Not limited to the selected period."
        />
        <KpiTile
          label="Confirmation rate"
          value={formatWholePercent(rate === null ? null : rate.rate)}
          sample={rate === null || rate.decided === 0 ? "No decisions in this period" : `${rate.confirmed} of ${rate.decided} decided`}
          meter={rate === null ? null : rate.rate}
          definition="Confirmed divided by confirmed plus cancelled, for changes made in the selected period."
        />
        <KpiTile
          label="Unassigned now"
          value={props.attention === null ? "—" : count(props.attention.unassignedNew)}
          sample="New orders with no agent"
          definition="New orders with no agent right now. Not limited to the selected period."
        />
      </section>

      <div className="ov-row2">
        <section aria-labelledby="outcomes-heading" className="ov-panel">
          <div className="ov-panel-head">
            <h2 id="outcomes-heading" className="ov-panel-title">Call outcomes</h2>
            <span className="ov-legend" aria-hidden="true">
              <span><i className="ov-sw ov-sw-confirmed" />Confirmed</span>
              <span><i className="ov-sw ov-sw-cancelled" />Cancelled</span>
            </span>
          </div>
          {failed ? (
            <p className="ov-empty">The chart is unavailable until the counts load.</p>
          ) : (
            <OutcomeLine series={props.series} bounds={props.bounds} />
          )}
        </section>

        <section aria-labelledby="attention-heading" className="ov-panel">
          <div className="ov-panel-head">
            <h2 id="attention-heading" className="ov-panel-title">Needs attention</h2>
          </div>
          <AttentionRows attention={props.attention} />
        </section>
      </div>

      <div className="ov-main">
        <section aria-labelledby="map-heading" className="ov-panel ov-map-panel">
          <div className="ov-panel-head">
            <h2 id="map-heading" className="ov-panel-title">Orders by city</h2>
            <span className="ov-scope">All time · by shipping city</span>
          </div>
          {props.cityMap === null ? (
            <p role="alert" className="ov-alert">City counts could not be loaded.</p>
          ) : props.cityMap.total === 0 ? (
            <p className="ov-empty">No orders have been imported yet.</p>
          ) : (
            <CityMap data={props.cityMap} />
          )}
        </section>

        <div className="ov-side">
          <section aria-labelledby="pipeline-heading" className="ov-panel">
            <div className="ov-panel-head">
              <h2 id="pipeline-heading" className="ov-panel-title">Order pipeline</h2>
            </div>
            {props.snapshot === null ? (
              <p role="alert" className="ov-alert">Pipeline counts could not be loaded.</p>
            ) : (
              <PipelineBars snapshot={props.snapshot} />
            )}
          </section>

          <section aria-labelledby="agents-heading" className="ov-panel">
            <div className="ov-panel-head">
              <h2 id="agents-heading" className="ov-panel-title">Agent performance</h2>
            </div>
            <AgentRows lines={failed ? null : props.actorLines} />
          </section>
        </div>
      </div>
    </div>
  );
}

function DateControl({ presetLabel, presets, period }: { presetLabel: string; presets: Preset[]; period: OverviewPeriod }) {
  return (
    <details className="ov-date">
      <summary className="ov-date-button">
        <span>{presetLabel}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="ov-date-panel">
        <nav aria-label="Quick periods" className="ov-presets">
          {presets.map((preset) => (
            <Link key={preset.label} href={preset.href} aria-current={preset.active ? "true" : undefined} className="ov-preset">
              {preset.label}
            </Link>
          ))}
        </nav>
        <form method="get" action="/dashboard" className="ov-custom">
          <label className="ov-field">
            <span>From</span>
            <input name="from" type="date" defaultValue={period.fromDate ?? ""} />
          </label>
          <label className="ov-field">
            <span>To</span>
            <input name="to" type="date" defaultValue={period.toDate ?? ""} />
          </label>
          <button type="submit" className="ov-apply">Apply</button>
        </form>
        <p className="ov-tz">Days follow Africa/Casablanca time.</p>
      </div>
    </details>
  );
}

function KpiTile({
  label,
  value,
  sample,
  meter,
  definition,
}: {
  label: string;
  value: string;
  sample?: string;
  meter?: number | null;
  definition: string;
}) {
  return (
    <div className="ov-kpi" title={definition}>
      <p className="ov-kpi-label">{label}</p>
      <p className="ov-kpi-value">{value}</p>
      {sample !== undefined ? <p className="ov-kpi-sample">{sample}</p> : null}
      {meter !== undefined && meter !== null ? (
        <div className="ov-meter" aria-hidden="true">
          <span style={cssVars({ "--w": `${Math.round(meter * 100)}%` })} />
        </div>
      ) : null}
      <span className="sr-only">{definition}</span>
    </div>
  );
}

const PIPELINE_ROWS = [
  { key: "New", label: "New", color: "var(--ov-new)" },
  { key: "Called", label: "Called", color: "var(--ov-called)" },
  { key: "No Answer", label: "No answer", color: "var(--ov-no-answer)" },
  { key: "Confirmed", label: "Confirmed", color: "var(--ov-confirmed)" },
  { key: "Cancelled", label: "Cancelled", color: "var(--ov-cancelled)" },
] as const;

function PipelineBars({ snapshot }: { snapshot: SnapshotCounts }) {
  const max = Math.max(1, ...PIPELINE_ROWS.map((row) => snapshot[row.key]));
  return (
    <ul className="ov-bars">
      {PIPELINE_ROWS.map((row) => {
        const value = snapshot[row.key];
        return (
          <li key={row.key} className="ov-bar-row">
            <span className="ov-bar-label">{row.label}</span>
            <span className="ov-bar-track" aria-hidden="true">
              <span className="ov-bar-fill" style={cssVars({ "--w": percentOf(value, max), "--c": row.color })} />
            </span>
            <span className="ov-bar-value">{count(value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Confirmed as a filled area, cancelled as a line. Geometry is in percent of the box, so the chart keeps its size at any width. */
function OutcomeLine({ series, bounds }: { series: DailyPoint[]; bounds: SeriesBounds | null }) {
  if (bounds === null || series.length === 0) {
    return <p className="ov-empty">No days to show for this period.</p>;
  }

  const n = series.length;
  const top = Math.max(1, ...series.flatMap((point) => [point.confirmed, point.cancelled]));
  const ticks = [...new Set([0, Math.ceil(top / 2), top])];
  // Sparse periods get a shorter plot.
  const plotHeight = top <= 3 ? 110 : top <= 10 ? 130 : 150;
  const labelStep = n <= 8 ? 1 : Math.ceil(n / 7);
  const xPct = (i: number) => ((i + 0.5) / n) * 100;
  const yPct = (value: number) => 100 - (value / top) * 100;
  const pointsFor = (key: "confirmed" | "cancelled") => series.map((point, i) => ({ x: xPct(i), y: yPct(point[key]) }));
  const toLine = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const confirmedPoints = pointsFor("confirmed");
  const cancelledPoints = pointsFor("cancelled");
  const area = `${toLine(confirmedPoints)} L${xPct(n - 1).toFixed(2)} 100 L${xPct(0).toFixed(2)} 100 Z`;
  const totals = series.reduce(
    (sum, point) => ({ confirmed: sum.confirmed + point.confirmed, cancelled: sum.cancelled + point.cancelled }),
    { confirmed: 0, cancelled: 0 },
  );

  return (
    <figure className="ov-chart-fig">
      <div className="ov-line-chart" style={cssVars({ "--plot-h": `${plotHeight}px` })}>
        <div className="ov-line-y" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={cssVars({ "--y": `${yPct(tick)}%` })}>
              {tick}
            </span>
          ))}
        </div>
        <div className="ov-line-plot">
          {ticks.map((tick) => (
            <span key={tick} className="ov-gridline" style={cssVars({ "--y": `${yPct(tick)}%` })} aria-hidden="true" />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ov-line-svg" aria-hidden="true" focusable="false">
            <path d={area} className="ov-area" />
            <path d={toLine(cancelledPoints)} className="ov-cancel-line" />
            <path d={toLine(confirmedPoints)} className="ov-confirm-line" />
          </svg>
          <div className="ov-hits">
            {series.map((point) => (
              <OutcomeDay key={point.date} point={point} />
            ))}
          </div>
        </div>
        <div className="ov-line-x" aria-hidden="true">
          {series.map((point, i) => (
            <span key={point.date}>{i % labelStep === 0 ? shortDayFormat.format(utcOfDay(point.date)) : ""}</span>
          ))}
        </div>
      </div>

      {bounds.clipped ? (
        <p className="ov-note">Most recent {MAX_CHART_DAYS} days shown. Totals cover the whole period.</p>
      ) : null}

      <details className="ov-table-disclosure">
        <summary>View as table</summary>
        <div className="ov-table-wrap">
          <table>
            <caption className="sr-only">Confirmed and cancelled orders per day, Africa/Casablanca</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Confirmed</th>
                <th scope="col">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{formatDay(point.date)}</th>
                  <td>{point.confirmed}</td>
                  <td>{point.cancelled}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>{totals.confirmed}</td>
                <td>{totals.cancelled}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </figure>
  );
}

function OutcomeDay({ point }: { point: DailyPoint }) {
  const label = `${formatDay(point.date)}: ${point.confirmed} confirmed, ${point.cancelled} cancelled`;
  return (
    <div className="ov-hit" tabIndex={0} role="group" aria-label={label}>
      <span className="ov-tip" aria-hidden="true">
        <strong>{formatDay(point.date)}</strong>
        <br />
        Confirmed: {point.confirmed}
        <br />
        Cancelled: {point.cancelled}
      </span>
    </div>
  );
}

function AttentionRows({ attention }: { attention: AttentionCounts | null }) {
  if (attention === null) {
    return <p className="ov-alert">Attention counts could not be loaded.</p>;
  }
  return (
    <>
      <ul className="ov-attn">
        <li>
          <Link href="/admin/distribution" className="ov-attn-row">
            <span className="ov-attn-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="ov-attn-text">
              <span className="ov-attn-title">Awaiting assignment</span>
              <span className="ov-attn-sub">New orders with no agent</span>
            </span>
            <span className="ov-attn-count">{count(attention.unassignedNew)}</span>
          </Link>
        </li>
        <li>
          <Link href="/admin/rescue" className="ov-attn-row">
            <span className="ov-attn-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
            <span className="ov-attn-text">
              <span className="ov-attn-title">One attempt before cancellation</span>
              <span className="ov-attn-sub">Active orders with two unanswered calls</span>
            </span>
            <span className="ov-attn-count">{count(attention.twoUnanswered)}</span>
          </Link>
        </li>
      </ul>
    </>
  );
}

function AgentRows({ lines }: { lines: ActorLine[] | null }) {
  if (lines === null) {
    return <p className="ov-alert">Agent results are unavailable.</p>;
  }
  if (lines.length === 0) {
    return <p className="ov-empty">No agents yet.</p>;
  }
  return (
    <ul className="ov-agents">
      {lines.map((line) => {
        const rate = line.rate.rate;
        return (
          <li key={line.key} className="ov-agent">
            <span className="ov-agent-name">
              {line.name}
              {line.kind === "agent" && line.isActive === false ? <span className="ov-muted"> (inactive)</span> : null}
            </span>
            <span className="ov-agent-track" aria-hidden="true">
              <span className="ov-agent-fill" style={cssVars({ "--w": rate === null ? "0%" : `${rate * 100}%` })} />
            </span>
            <span className="ov-agent-rate">{formatWholePercent(rate)}</span>
            <span className="ov-agent-decided">{line.rate.decided} decided</span>
          </li>
        );
      })}
    </ul>
  );
}
