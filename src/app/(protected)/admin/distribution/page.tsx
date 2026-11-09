import { connection } from "next/server";
import { Suspense } from "react";

import { loadAgentWorkloads, loadDistributionCandidates } from "@/modules/distribution/queries";
import { requireArea } from "@/modules/auth/guards";
import { listActiveAgents } from "@/modules/orders/queries";

import { DistributionCenter } from "../../_components/distribution-center";

/** Synchronous page: the session read and the data loads happen inside the Suspense boundary. */
export default function DistributionPage() {
  return (
    <Suspense
      fallback={
        <section className="card p-6" aria-busy="true" aria-live="polite">
          <p className="muted text-sm">Loading the Distribution Center…</p>
        </section>
      }
    >
      <DistributionLoader />
    </Suspense>
  );
}

async function DistributionLoader() {
  const user = await requireArea("admin");
  await connection();

  const [candidates, agents] = await Promise.all([loadDistributionCandidates(), listActiveAgents()]);
  if (!candidates.ok || !agents.ok) {
    return (
      <div className="alert-error max-w-3xl" role="alert">
        The Distribution Center could not be loaded. Refresh the page to try again.
      </div>
    );
  }
  const workloads = await loadAgentWorkloads(agents.agents.map((agent) => agent.id));
  if (workloads === null) {
    return (
      <div className="alert-error max-w-3xl" role="alert">
        Agent workloads could not be loaded. Refresh the page to try again.
      </div>
    );
  }

  return (
    <div className="ov flex max-w-6xl flex-col gap-5">
      <header className="ov-head">
        <div>
          <h1 className="ov-title">Distribution Center</h1>
          <p className="ov-sub">
          Signed in as {user.displayName}. Assign unassigned new orders to active agents in one batch. Nothing changes until you confirm.
          </p>
        </div>
      </header>
      <DistributionCenter
        candidates={candidates.rows}
        total={candidates.total}
        truncated={candidates.truncated}
        agents={agents.agents.map((agent) => ({
          id: agent.id,
          displayName: agent.displayName,
          currentLoad: workloads.get(agent.id) ?? 0,
        }))}
      />
    </div>
  );
}
