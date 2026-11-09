import { connection } from "next/server";
import { Suspense } from "react";

import { requireArea } from "@/modules/auth/guards";
import { buildRescueQueue } from "@/modules/rescue/domain/queue";
import { loadRescueItems } from "@/modules/rescue/queries";

import { NextRecommendedCard, RescueNotices, RescueTable, SummaryCards } from "../_components/rescue-ui";

/** Synchronous page: the session read and the queue load happen inside the Suspense boundary. */
export default function AgentPage() {
  return (
    <Suspense
      fallback={
        <section className="card p-6" aria-busy="true" aria-live="polite">
          <p className="muted text-sm">Loading your Rescue Center…</p>
        </section>
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

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Rescue Center</h1>
        <p className="muted mt-1 text-sm">
          Signed in as {user.displayName}. Priorities come from fixed, visible rules. Only orders assigned to you appear here.
        </p>
      </header>

      <RescueNotices
        historyAvailable={load.historyAvailable}
        attemptsComplete={load.attemptsComplete}
        truncated={load.truncated}
      />
      <NextRecommendedCard row={queue.next} linkOrders />
      <SummaryCards summary={queue.summary} />
      <RescueTable rows={queue.rows} showAgent={false} linkOrders />
    </div>
  );
}
