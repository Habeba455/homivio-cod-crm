"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

import type { PriorityLevel } from "@/modules/rescue/domain/priority";

/** Admin Rescue board. Plain serialisable props only, so the server page does all data work. */

export type RescueBoardItem = {
  id: string;
  ref: string;
  customer: string;
  city: string;
  agent: string;
  level: PriorityLevel;
  score: number;
  action: string;
  status: string;
  reasons: { code: string; text: string; points: number }[];
  last: string;
};

export type RescueBoardSummary = {
  active: number;
  needsAttention: number;
  closeToCancel: number;
  uncontacted: number;
  dataIssues: number;
};

const LEVELS: PriorityLevel[] = ["urgent", "high", "normal", "low"];
const LEVEL_LABEL: Record<PriorityLevel, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const LEVEL_COLOR: Record<PriorityLevel, string> = {
  urgent: "var(--ov-cancelled)",
  high: "var(--ov-no-answer)",
  normal: "var(--ov-new)",
  low: "#6b6e85",
};

const count = (value: number) => value.toLocaleString("en-US");
const style = (vars: Record<string, string>) => vars as CSSProperties;

export function RescueBoard({
  items,
  summary,
  next,
}: {
  items: RescueBoardItem[];
  summary: RescueBoardSummary;
  next: RescueBoardItem | null;
}) {
  const [level, setLevel] = useState<"all" | PriorityLevel>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const totals: Record<PriorityLevel, number> = { urgent: 0, high: 0, normal: 0, low: 0 };
    for (const item of items) totals[item.level] += 1;
    return totals;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (level === "all" || item.level === level) &&
        (needle === "" || [item.ref, item.customer, item.city, item.agent].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [items, level, query]);

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const reset = () => {
    setLevel("all");
    setQuery("");
  };

  return (
    <div className="rq">
      <section aria-labelledby="next-heading" className="ov-panel rq-hero">
        <div className="rq-hero-body">
          <p id="next-heading" className="ov-kpi-label">Next recommended order</p>
          {next === null ? (
            <p className="ov-empty">Nothing needs action right now.</p>
          ) : (
            <>
              <div className="rq-hero-top">
                <span className="rq-ref">{next.ref}</span>
                <span className={`rq-pill rq-pill-${next.level}`}>{LEVEL_LABEL[next.level]}</span>
                <span className="rq-action">{next.action}</span>
              </div>
              <p className="ov-kpi-sample">
                {next.customer} · {next.city}
              </p>
              <ul className="rq-reasons">
                {next.reasons.slice(0, 3).map((reason) => (
                  <li key={reason.code}>
                    <span>{reason.text}</span>
                    {reason.points > 0 ? <span className="rq-points">+{reason.points}</span> : null}
                  </li>
                ))}
              </ul>
              <Link href={`/admin?q=${encodeURIComponent(next.ref)}`} className="ov-pill-btn rq-hero-btn">
                Open in Orders
              </Link>
            </>
          )}
        </div>
        {next === null ? null : <span className="rq-ring" aria-hidden="true" />}
      </section>

      <dl className="ov-kpis rq-kpis">
        <Kpi label="Active orders" value={summary.active} index={0} />
        <Kpi label="Need attention" value={summary.needsAttention} index={1} />
        <Kpi label="Two unanswered" value={summary.closeToCancel} index={2} />
        <Kpi label="Not contacted" value={summary.uncontacted} index={3} />
        <Kpi label="Need a data check" value={summary.dataIssues} index={4} />
      </dl>

      <section aria-labelledby="mix-heading" className="ov-panel">
        <div className="ov-panel-head">
          <h2 id="mix-heading" className="ov-panel-title">Priority mix</h2>
          <span className="ov-scope">Select a segment to filter</span>
        </div>
        <div className="rq-mix" role="group" aria-label="Filter by priority">
          {LEVELS.map((value, index) => {
            const share = items.length === 0 ? 0 : (counts[value] / items.length) * 100;
            return (
              <button
                key={value}
                type="button"
                className="rq-seg"
                aria-pressed={level === value}
                aria-label={`${LEVEL_LABEL[value]}: ${counts[value]}`}
                style={style({ "--w": `${share}%`, "--c": LEVEL_COLOR[value], "--d": `${index * 90}ms` })}
                onClick={() => setLevel(level === value ? "all" : value)}
              />
            );
          })}
        </div>
        <ul className="rq-legend">
          {LEVELS.map((value) => (
            <li key={value}>
              <span className="ov-sw" style={{ background: LEVEL_COLOR[value] }} aria-hidden="true" />
              {LEVEL_LABEL[value]} <strong>{count(counts[value])}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="queue-heading" className="ov-panel">
        <div className="rq-toolbar">
          <h2 id="queue-heading" className="ov-panel-title">Queue</h2>
          <div className="rq-chips" role="group" aria-label="Priority filter">
            <Chip label="All" count={items.length} active={level === "all"} onClick={() => setLevel("all")} />
            {LEVELS.map((value) => (
              <Chip
                key={value}
                label={LEVEL_LABEL[value]}
                count={counts[value]}
                active={level === value}
                onClick={() => setLevel(value)}
              />
            ))}
          </div>
          <input
            type="search"
            className="input rq-search"
            placeholder="Order, customer, city or agent"
            aria-label="Search the queue"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <p role="status" aria-live="polite" className="ov-scope rq-status">
          Showing {count(filtered.length)} of {count(items.length)} orders
        </p>

        {filtered.length === 0 ? (
          <div className="rq-empty">
            <p>No orders match this filter.</p>
            <button type="button" className="ov-apply" onClick={reset}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="ov-table-wrap rq-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">City</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Next action</th>
                  <th scope="col">Why</th>
                  <th scope="col">Last call</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => {
                  const isOpen = expanded.has(item.id);
                  const shown = isOpen ? item.reasons : item.reasons.slice(0, 2);
                  return (
                    <tr key={item.id} className="rq-row" style={style({ "--i": String(Math.min(index, 14)) })}>
                      <td>
                        <span className={`rq-pill rq-pill-${item.level}`}>{LEVEL_LABEL[item.level]}</span>
                        <span className="rq-score">Score {item.score}</span>
                      </td>
                      <td>
                        <Link href={`/admin?q=${encodeURIComponent(item.ref)}`} className="rq-ref-link">
                          {item.ref}
                        </Link>
                      </td>
                      <td>{item.customer}</td>
                      <td>{item.city}</td>
                      <td>{item.agent}</td>
                      <td className="rq-action-cell">{item.action}</td>
                      <td className="rq-why">
                        <ul className="rq-reasons rq-reasons-row">
                          {shown.map((reason) => (
                            <li key={reason.code}>
                              <span>{reason.text}</span>
                              {reason.points > 0 ? <span className="rq-points">+{reason.points}</span> : null}
                            </li>
                          ))}
                        </ul>
                        {item.reasons.length > 2 ? (
                          <button
                            type="button"
                            className="rq-more"
                            aria-expanded={isOpen}
                            onClick={() => toggleExpanded(item.id)}
                          >
                            {isOpen ? "Show less" : `+${item.reasons.length - 2} more`}
                          </button>
                        ) : null}
                      </td>
                      <td className="rq-last">{item.last}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, index }: { label: string; value: number; index: number }) {
  return (
    <div className="ov-kpi rq-kpi" style={style({ "--i": String(index) })}>
      <dt className="ov-kpi-label">{label}</dt>
      <dd className="ov-kpi-value">{count(value)}</dd>
    </div>
  );
}

function Chip({ label, count: total, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="rq-chip" aria-pressed={active} onClick={onClick}>
      {label} <span className="rq-chip-count">{count(total)}</span>
    </button>
  );
}
