import { connection } from "next/server";
import { Suspense } from "react";

import { requireArea } from "@/modules/auth/guards";
import { formatDateTime } from "@/modules/orders/format";
import { buildRescueQueue, type RescueRow } from "@/modules/rescue/domain/queue";
import { loadRescueItems } from "@/modules/rescue/queries";

import { RescueBoard, type RescueBoardItem } from "../../_components/rescue-board";
import { ACTION_LABELS, RescueNotices } from "../../_components/rescue-ui";

/** Synchronous page: the session read and the queue load happen inside the Suspense boundary. */
export default function AdminRescuePage() {
  return (
    <Suspense
      fallback={
        <section className="ov-panel" aria-busy="true" aria-live="polite">
          <p className="ov-empty">Loading the rescue queue…</p>
        </section>
      }
    >
      <AdminRescue />
    </Suspense>
  );
}

function toBoardItem(row: RescueRow): RescueBoardItem {
  const a = row.assessment;
  return {
    id: a.orderId,
    ref: a.orderRef,
    customer: row.customerName ?? "—",
    city: row.shippingCity,
    agent: row.agentName ?? "Unassigned",
    level: a.level,
    score: a.score,
    action: ACTION_LABELS[a.action],
    status: a.status,
    reasons: a.reasons.map((reason) => ({ code: reason.code, text: reason.text, points: reason.points })),
    last: a.lastAttemptAt === null ? "Never" : formatDateTime(a.lastAttemptAt),
  };
}

async function AdminRescue() {
  const user = await requireArea("admin");
  await connection();
  const load = await loadRescueItems();

  if (!load.ok) {
    return (
      <div className="ov">
        <p role="alert" className="ov-alert">The rescue queue could not be loaded. Refresh the page to try again.</p>
      </div>
    );
  }

  const queue = buildRescueQueue(load.items, new Date());

  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <h1 className="ov-title">Rescue queue</h1>
          <p className="ov-sub">
            Signed in as {user.displayName}. Active pipeline orders, ranked by the rules agents see.
          </p>
        </div>
      </header>

      <div className="rq-notices">
        <RescueNotices
          historyAvailable={load.historyAvailable}
          attemptsComplete={load.attemptsComplete}
          truncated={load.truncated}
        />
      </div>

      <RescueBoard
        items={queue.rows.map(toBoardItem)}
        summary={queue.summary}
        next={queue.next === null ? null : toBoardItem(queue.next)}
      />
    </div>
  );
}
