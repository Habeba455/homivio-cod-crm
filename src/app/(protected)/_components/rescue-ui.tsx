import Link from "next/link";

import { formatDateTime } from "@/modules/orders/format";
import type { Assessment, PriorityLevel, QueueSummary, Reason, RecommendedAction } from "@/modules/rescue/domain/priority";
import type { RescueRow } from "@/modules/rescue/domain/queue";

/** Presentational pieces shared by the agent and admin Rescue views. No data access here. */

const LEVEL_LABELS: Record<PriorityLevel, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

const LEVEL_CLASSES: Record<PriorityLevel, string> = {
  urgent: "border-red-300 bg-red-50 text-red-800",
  high: "border-amber-300 bg-amber-50 text-amber-900",
  normal: "border-slate-300 bg-slate-100 text-slate-800",
  low: "border-slate-200 bg-white text-slate-600",
};

export const ACTION_LABELS: Record<RecommendedAction, string> = {
  call_last_chance: "Last-chance call",
  confirm_or_cancel: "Confirm or cancel",
  first_call: "First call",
  retry_call: "Retry call",
  follow_up_call: "Follow-up call",
  review: "Review order",
};

export function PriorityBadge({ level }: { level: PriorityLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASSES[level]}`}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {reasons.map((reason) => (
        <li key={reason.code} className="flex justify-between gap-3">
          <span>{reason.text}</span>
          {reason.points > 0 ? <span className="muted shrink-0 text-xs tabular-nums">+{reason.points}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function RescueNotices({
  historyAvailable,
  attemptsComplete,
  truncated,
}: {
  historyAvailable: boolean;
  attemptsComplete: boolean;
  truncated: boolean;
}) {
  const notes: string[] = [];
  if (!historyAvailable) {
    notes.push("Customer history is unavailable right now, so repeat-customer reasons are not shown. Ranking uses the other signals.");
  }
  if (!attemptsComplete) {
    notes.push("Some call history could not be loaded in full. Orders with missing call history are marked for a data check.");
  }
  if (truncated) {
    notes.push("This queue shows the oldest 500 active orders. Newer orders are not included in this view.");
  }
  if (notes.length === 0) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <ul className="list-disc space-y-1 pl-5">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryCards({ summary }: { summary: QueueSummary }) {
  const cards: Array<[string, number]> = [
    ["Active orders", summary.active],
    ["Need attention", summary.needsAttention],
    ["Two unanswered", summary.closeToCancel],
    ["Not contacted", summary.uncontacted],
    ["Need a data check", summary.dataIssues],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {cards.map(([label, value]) => (
        <div key={label} className="card p-4">
          <dt className="muted text-xs">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NextRecommendedCard({ row, linkOrders }: { row: RescueRow | null; linkOrders: boolean }) {
  if (row === null) {
    return (
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Next recommended order</h2>
        <p className="muted mt-2 text-sm">Nothing needs action right now.</p>
      </section>
    );
  }
  const a = row.assessment;
  return (
    <section className="card border-blue-200 p-5" aria-labelledby="next-recommended-title">
      <p id="next-recommended-title" className="muted text-xs font-semibold uppercase tracking-wide">
        Next recommended order
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="font-mono text-base font-semibold">{a.orderRef}</span>
        <PriorityBadge level={a.level} />
        <span className="text-sm font-medium">{ACTION_LABELS[a.action]}</span>
      </div>
      <p className="muted mt-2 text-sm">
        {row.customerName ?? "Customer"} · {row.shippingCity}
      </p>
      <div className="mt-3">
        <ReasonList reasons={a.reasons.slice(0, 3)} />
      </div>
      {linkOrders ? (
        <Link href={`/agent/orders/${a.orderId}`} className="btn btn-primary mt-4 inline-flex">
          Open order
        </Link>
      ) : null}
    </section>
  );
}

export function RescueTable({
  rows,
  showAgent,
  linkOrders,
}: {
  rows: RescueRow[];
  showAgent: boolean;
  linkOrders: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="card p-6">
        <p className="text-sm font-medium">No active orders need action right now.</p>
      </section>
    );
  }

  return (
    <section className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Priority</th>
            <th scope="col" className="px-4 py-3 font-semibold">Order</th>
            <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
            <th scope="col" className="px-4 py-3 font-semibold">City</th>
            {showAgent ? <th scope="col" className="px-4 py-3 font-semibold">Agent</th> : null}
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 font-semibold">Next action</th>
            <th scope="col" className="px-4 py-3 font-semibold">Why</th>
            <th scope="col" className="px-4 py-3 font-semibold">Last call</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const a = row.assessment;
            return (
              <tr key={a.orderId} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <PriorityBadge level={a.level} />
                  <p className="muted mt-1 text-xs tabular-nums">Score {a.score}</p>
                </td>
                <td className="px-4 py-3">
                  {linkOrders ? (
                    <Link href={`/agent/orders/${a.orderId}`} className="font-mono text-xs font-semibold text-blue-700 underline-offset-2 hover:underline">
                      {a.orderRef}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs font-semibold">{a.orderRef}</span>
                  )}
                </td>
                <td className="px-4 py-3">{row.customerName ?? "—"}</td>
                <td className="px-4 py-3">{row.shippingCity}</td>
                {showAgent ? <td className="px-4 py-3">{row.agentName ?? "Unassigned"}</td> : null}
                <td className="px-4 py-3">
                  <span className="badge">{a.status}</span>
                </td>
                <td className="px-4 py-3 font-medium">{ACTION_LABELS[a.action]}</td>
                <td className="min-w-64 px-4 py-3">
                  <ReasonList reasons={a.reasons} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">
                  {a.lastAttemptAt === null ? "Never" : formatDateTime(a.lastAttemptAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function RescueContextPanel({ assessment }: { assessment: Assessment }) {
  return (
    <section className="card p-5" aria-labelledby="rescue-context-title">
      <h2 id="rescue-context-title" className="text-sm font-semibold">
        Why this needs attention
      </h2>
      {assessment.eligible ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <PriorityBadge level={assessment.level} />
            <span className="text-sm">
              Next: <strong>{ACTION_LABELS[assessment.action]}</strong>
            </span>
          </div>
          <ReasonList reasons={assessment.reasons} />
          <p className="muted text-xs">
            Score {assessment.score}. Points come from fixed, visible rules. This is not a prediction.
          </p>
        </div>
      ) : (
        <p className="muted mt-3 text-sm">
          {assessment.reason === "historical"
            ? "Historical order. It is outside the active queue."
            : "This order is finished, so it is not prioritised."}
        </p>
      )}
    </section>
  );
}
