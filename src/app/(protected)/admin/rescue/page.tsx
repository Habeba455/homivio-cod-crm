import { connection } from "next/server";
import { Suspense } from "react";

import { requireArea } from "@/modules/auth/guards";
import { buildRescueQueue } from "@/modules/rescue/domain/queue";
import { loadRescueItems } from "@/modules/rescue/queries";

import { NextRecommendedCard, RescueNotices, RescueTable, SummaryCards } from "../../_components/rescue-ui";

/** Synchronous page: the session read and the queue load happen inside the Suspense boundary. */
export default function AdminRescuePage() {
  return (
    <Suspense
      fallback={
        <section className="card p-6" aria-busy="true" aria-live="polite">
          <p className="muted text-sm">Loading the rescue queue…</p>
        </section>
      }
    >
      <AdminRescue />
    </Suspense>
  );
}

async function AdminRescue() {
  const user = await requireArea("admin");
  await connection();
  const load = await loadRescueItems();

  if (!load.ok) {
    return (
      <div className="alert-error max-w-3xl" role="alert">
        The rescue queue could not be loaded. Refresh the page to try again.
      </div>
    );
  }

  const queue = buildRescueQueue(load.items, new Date());

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Rescue queue</h1>
        <p className="muted mt-1 text-sm">
          Signed in as {user.displayName}. All active pipeline orders, ranked by the same rules agents see.
        </p>
      </header>

      <RescueNotices
        historyAvailable={load.historyAvailable}
        attemptsComplete={load.attemptsComplete}
        truncated={load.truncated}
      />
      <NextRecommendedCard row={queue.next} linkOrders={false} />
      <SummaryCards summary={queue.summary} />
      <RescueTable rows={queue.rows} showAgent linkOrders={false} />
    </div>
  );
}
