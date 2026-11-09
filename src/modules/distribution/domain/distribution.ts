import type { PipelineStatus } from "../../orders/domain/status";

/**
 * Smart Bulk Auto-Assignment rules. Pure and deterministic: the same inputs always give the same plan.
 *
 * Workload = an agent's active pipeline orders (New, No Answer, Called). That is the work still waiting for them.
 * Each new order goes to the agent whose projected workload is lowest after the orders already planned.
 */

export const MAX_BATCH_ORDERS = 2000;
export const MAX_BATCH_AGENTS = 100;

export type CandidateOrder = {
  orderId: string;
  orderRef: string;
  /** Version seen when the preview was built. The database rejects the item if the version has moved. */
  version: number;
  createdAt: string;
};

export type CandidateAgent = {
  agentId: string;
  displayName: string;
  currentLoad: number;
};

export type PlannedAssignment = {
  orderId: string;
  orderRef: string;
  agentId: string;
  expectedVersion: number;
};

export type AgentPlan = CandidateAgent & {
  newOrders: number;
  projectedLoad: number;
};

export type DistributionPlan = {
  assignments: PlannedAssignment[];
  agents: AgentPlan[];
  duplicatesIgnored: number;
};

export type ExclusionReason = "not_found" | "already_assigned" | "historical" | "finished" | "not_new";

export type OrderSnapshot = {
  orderId: string;
  orderRef: string;
  pipelineStatus: PipelineStatus | null;
  assignedAgentId: string | null;
  version: number;
  createdAt: string;
  customerName?: string | null;
};

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  not_found: "Not found",
  already_assigned: "Already assigned",
  historical: "Historical order",
  finished: "Confirmed or cancelled",
  not_new: "Not a new order",
};

/** Mirrors the eligibility checks in distribute_orders. Only new, unassigned pipeline orders can be distributed. */
export function classifyOrder(snapshot: OrderSnapshot): { eligible: true } | { eligible: false; reason: ExclusionReason } {
  if (snapshot.assignedAgentId !== null) return { eligible: false, reason: "already_assigned" };
  if (snapshot.pipelineStatus === null) return { eligible: false, reason: "historical" };
  if (snapshot.pipelineStatus === "Confirmed" || snapshot.pipelineStatus === "Cancelled") {
    return { eligible: false, reason: "finished" };
  }
  if (snapshot.pipelineStatus !== "New") return { eligible: false, reason: "not_new" };
  return { eligible: true };
}

/**
 * Keeps the requested agents that are active. Inactive, unknown and duplicate requests are reported or dropped.
 * `activeAgents` must already contain only active agents.
 */
export function chooseAgents(
  activeAgents: readonly CandidateAgent[],
  requestedIds: readonly string[],
): { agents: CandidateAgent[]; unavailable: string[] } {
  const byId = new Map(activeAgents.map((agent) => [agent.agentId, agent] as const));
  const seen = new Set<string>();
  const agents: CandidateAgent[] = [];
  const unavailable: string[] = [];
  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const agent = byId.get(id);
    if (agent === undefined) {
      unavailable.push(id);
    } else {
      agents.push(agent);
    }
  }
  return { agents, unavailable };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function createdAtMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
}

/**
 * Builds the plan. Orders are taken oldest first, and each goes to the agent with the lowest projected workload.
 * Ties go to the lower current load, then to the display name, then to the agent id.
 * Each order keeps the version it had at preview time, so the database can detect later changes.
 */
export function planDistribution(orders: readonly CandidateOrder[], agents: readonly CandidateAgent[]): DistributionPlan {
  const seen = new Set<string>();
  const unique: CandidateOrder[] = [];
  let duplicatesIgnored = 0;
  for (const order of orders) {
    if (seen.has(order.orderId)) {
      duplicatesIgnored += 1;
      continue;
    }
    seen.add(order.orderId);
    unique.push(order);
  }
  unique.sort(
    (a, b) =>
      createdAtMs(a.createdAt) - createdAtMs(b.createdAt) ||
      compareText(a.orderRef, b.orderRef) ||
      compareText(a.orderId, b.orderId),
  );

  const ordered = [...agents].sort(
    (a, b) =>
      a.currentLoad - b.currentLoad || compareText(a.displayName, b.displayName) || compareText(a.agentId, b.agentId),
  );
  if (ordered.length === 0) {
    return { assignments: [], agents: [], duplicatesIgnored };
  }

  const added = ordered.map(() => 0);
  const assignments: PlannedAssignment[] = [];
  for (const order of unique) {
    let best = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      const candidateLoad = ordered[i].currentLoad + added[i];
      const bestLoad = ordered[best].currentLoad + added[best];
      if (candidateLoad < bestLoad) best = i;
    }
    added[best] += 1;
    assignments.push({
      orderId: order.orderId,
      orderRef: order.orderRef,
      agentId: ordered[best].agentId,
      expectedVersion: order.version,
    });
  }

  return {
    assignments,
    agents: ordered.map((agent, i) => ({
      ...agent,
      newOrders: added[i],
      projectedLoad: agent.currentLoad + added[i],
    })),
    duplicatesIgnored,
  };
}

export type AssignmentMode = "manual" | "random" | "balanced";

/**
 * Canonical text form of a mapping (order id and agent id, or null), sorted by order id.
 * The client and the server build it the same way, so the preview can detect edits made after review.
 */
export function normalizeProposal(entries: readonly { orderId: string; agentId: string | null }[]): string {
  const sorted = [...entries].sort((a, b) => compareText(a.orderId, b.orderId));
  return JSON.stringify(sorted.map((entry) => [entry.orderId, entry.agentId]));
}

/**
 * Random mode: each order independently gets a uniformly random agent from the participating set.
 * It is not round-robin, and it does not balance workload. `nextIndex(size)` must return an integer in [0, size).
 */
export function randomAssignments(
  orders: readonly CandidateOrder[],
  agents: readonly CandidateAgent[],
  nextIndex: (size: number) => number,
): PlannedAssignment[] {
  if (agents.length === 0) return [];
  return orders.map((order) => {
    const index = nextIndex(agents.length);
    if (!Number.isInteger(index) || index < 0 || index >= agents.length) {
      throw new Error("random index out of range");
    }
    const agent = agents[index];
    if (agent === undefined) throw new Error("random index out of range");
    return {
      orderId: order.orderId,
      orderRef: order.orderRef,
      agentId: agent.agentId,
      expectedVersion: order.version,
    };
  });
}

/** Per-agent view of any mapping (manual, random or balanced): new orders and projected workload. */
export function summarizeAgents(
  assignments: readonly PlannedAssignment[],
  agents: readonly CandidateAgent[],
): AgentPlan[] {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    counts.set(assignment.agentId, (counts.get(assignment.agentId) ?? 0) + 1);
  }
  return [...agents]
    .sort(
      (a, b) =>
        a.currentLoad - b.currentLoad || compareText(a.displayName, b.displayName) || compareText(a.agentId, b.agentId),
    )
    .map((agent) => {
      const newOrders = counts.get(agent.agentId) ?? 0;
      return { ...agent, newOrders, projectedLoad: agent.currentLoad + newOrders };
    });
}
