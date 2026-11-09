import { connection } from "next/server";
import { Suspense } from "react";

import { requireArea } from "@/modules/auth/guards";
import { orderActions } from "@/modules/orders/workflow-view";
import { buildRescueQueue, type RescueRow } from "@/modules/rescue/domain/queue";
import { loadRescueItems } from "@/modules/rescue/queries";

import { AgentRescueBoard, type AgentBoardItem } from "../_components/agent-rescue-board";
import { toBoardItem } from "../_components/rescue-items";
import { RescueNotices } from "../_components/rescue-ui";

/** Synchronous page: the session read and the queue load happen inside the Suspense boundary. */
export default function AgentPage() {
  return (
    <Suspense
      fallback={
        <div className="ar">
          <p className="ar-muted" aria-busy="true" aria-live="polite">Loading your Rescue Center…</p>
        </div>
      }
    >
      <RescueCenter />
    </Suspense>
  );
}

async function RescueCenter() {
  const user = await requireArea("agent");
  await connection();
  const load = await loadRescueItems({ agentId: user.id });

  if (!load.ok) {
    return (
      <div className="alert-error max-w-3xl" role="alert">
        The Rescue Center could not be loaded. Refresh the page to try again.
      </div>
    );
  }

  const queue = buildRescueQueue(load.items, new Date(), user.id);
  const byId = new Map(load.items.map((item) => [item.signals.orderId, item] as const));

  // Which quick actions the server rules allow for each row. The RPCs enforce the same rules on write.
  const toAgentItem = (row: RescueRow): AgentBoardItem => {
    const source = byId.get(row.assessment.orderId);
    const base = toBoardItem(row);
    if (source === undefined) {
      return { ...base, version: 0, can: { answer: false, noAnswer: false, confirm: false, cancel: false } };
    }
    const allowed = orderActions(source.signals.status, source.signals.unansweredAttemptCount);
    return {
      ...base,
      version: source.version,
      can: { answer: allowed.answer, noAnswer: allowed.noAnswer, confirm: allowed.confirm, cancel: allowed.cancel },
    };
  };

  return (
    <div className="ar flex max-w-6xl flex-col gap-4">
      <header className="ar-head">
        <p className="ar-eyebrow">My queue</p>
        <h1 className="ar-title">Rescue Center</h1>
        <p className="ar-muted">
          Signed in as {user.displayName}. Priorities come from fixed, visible rules. Only orders assigned to you appear here.
        </p>
      </header>

      <RescueNotices
        historyAvailable={load.historyAvailable}
        attemptsComplete={load.attemptsComplete}
        truncated={load.truncated}
      />

      <AgentRescueBoard items={queue.rows.map(toAgentItem)} summary={queue.summary} />
    </div>
  );
}
