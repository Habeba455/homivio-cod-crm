import {
  classifyOrder,
  normalizeProposal,
  planDistribution,
  randomAssignments,
  summarizeAgents,
  type AgentPlan,
  type CandidateAgent,
  type CandidateOrder,
  type OrderSnapshot,
  type PlannedAssignment,
} from "./distribution";

/**
 * Builds the review that the Distribution Center shows before any write.
 * Pure: the caller supplies the snapshots, the agents and the randomness. Used by all three modes.
 */

export const REVIEW_REASON_LABELS: Record<string, string> = {
  no_agent: "No agent chosen",
  agent_unavailable: "Agent is not active",
  already_assigned: "Already assigned",
  historical: "Historical order",
  finished: "Confirmed or cancelled",
  not_new: "Not a new order",
  not_found: "Order not found",
};

export type ReviewOrderInput = {
  orderId: string;
  orderRef: string;
  customerName: string | null;
  /** null when the order no longer exists. */
  snapshot: OrderSnapshot | null;
};

export type ReviewRow = {
  orderId: string;
  orderRef: string;
  customerName: string | null;
  currentAgentName: string | null;
  proposedAgentId: string | null;
  proposedAgentName: string | null;
  status: "proposed" | "unassigned" | "skipped";
  reason: string | null;
  /** Eligible rows can be changed in the preview. Skipped rows cannot. */
  editable: boolean;
};

export type ReviewSource =
  | { kind: "balanced" }
  | { kind: "random"; nextIndex: (size: number) => number }
  | { kind: "proposal"; proposal: ReadonlyMap<string, string | null> };

export type ReviewResult = {
  rows: ReviewRow[];
  agents: AgentPlan[];
  assignments: PlannedAssignment[];
  basis: string;
  proposedCount: number;
  unassignedCount: number;
  skippedCount: number;
  excluded: { reason: string; count: number }[];
  duplicatesIgnored: number;
  unavailableAgentCount: number;
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildReview(input: {
  orders: readonly ReviewOrderInput[];
  agents: readonly CandidateAgent[];
  agentNames: ReadonlyMap<string, string>;
  source: ReviewSource;
  duplicatesIgnored: number;
  unavailableAgentCount: number;
}): ReviewResult {
  const agentById = new Map(input.agents.map((agent) => [agent.agentId, agent] as const));
  const ordered = [...input.orders].sort(
    (a, b) => compareText(a.orderRef, b.orderRef) || compareText(a.orderId, b.orderId),
  );

  const rowsById = new Map<string, ReviewRow>();
  const eligible: CandidateOrder[] = [];
  for (const order of ordered) {
    const snapshot = order.snapshot;
    if (snapshot === null) {
      rowsById.set(order.orderId, skippedRow(order, null, "not_found", input.agentNames));
      continue;
    }
    const verdict = classifyOrder(snapshot);
    if (!verdict.eligible) {
      rowsById.set(order.orderId, skippedRow(order, snapshot, verdict.reason, input.agentNames));
      continue;
    }
    eligible.push({ orderId: snapshot.orderId, orderRef: snapshot.orderRef, version: snapshot.version, createdAt: snapshot.createdAt });
  }

  let assignments: PlannedAssignment[];
  const missingReason = new Map<string, string>();
  if (input.source.kind === "balanced") {
    assignments = planDistribution(eligible, input.agents).assignments;
  } else if (input.source.kind === "random") {
    assignments = randomAssignments(eligible, input.agents, input.source.nextIndex);
  } else {
    assignments = [];
    for (const order of eligible) {
      const chosen = input.source.proposal.get(order.orderId) ?? null;
      if (chosen === null) {
        missingReason.set(order.orderId, "no_agent");
      } else if (!agentById.has(chosen)) {
        missingReason.set(order.orderId, "agent_unavailable");
      } else {
        assignments.push({ orderId: order.orderId, orderRef: order.orderRef, agentId: chosen, expectedVersion: order.version });
      }
    }
  }

  const assignedBy = new Map(assignments.map((assignment) => [assignment.orderId, assignment] as const));
  const customerById = new Map(ordered.map((order) => [order.orderId, order.customerName] as const));
  for (const order of eligible) {
    const assignment = assignedBy.get(order.orderId);
    const agent = assignment === undefined ? undefined : agentById.get(assignment.agentId);
    rowsById.set(order.orderId, {
      orderId: order.orderId,
      orderRef: order.orderRef,
      customerName: customerById.get(order.orderId) ?? null,
      currentAgentName: null,
      proposedAgentId: assignment?.agentId ?? null,
      proposedAgentName: agent?.displayName ?? null,
      status: assignment === undefined ? "unassigned" : "proposed",
      reason: assignment === undefined ? (missingReason.get(order.orderId) ?? "no_agent") : null,
      editable: true,
    });
  }

  const rows: ReviewRow[] = [];
  for (const order of ordered) {
    const row = rowsById.get(order.orderId);
    if (row !== undefined) rows.push(row);
  }

  const excludedCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "skipped" && row.reason !== null) {
      excludedCounts.set(row.reason, (excludedCounts.get(row.reason) ?? 0) + 1);
    }
  }

  return {
    rows,
    agents: summarizeAgents(assignments, input.agents),
    assignments,
    basis: normalizeProposal(
      rows.filter((row) => row.editable).map((row) => ({ orderId: row.orderId, agentId: row.proposedAgentId })),
    ),
    proposedCount: assignments.length,
    unassignedCount: rows.filter((row) => row.status === "unassigned").length,
    skippedCount: rows.filter((row) => row.status === "skipped").length,
    excluded: [...excludedCounts.entries()].map(([reason, count]) => ({ reason, count })),
    duplicatesIgnored: input.duplicatesIgnored,
    unavailableAgentCount: input.unavailableAgentCount,
  };
}

function skippedRow(
  order: ReviewOrderInput,
  snapshot: OrderSnapshot | null,
  reason: string,
  agentNames: ReadonlyMap<string, string>,
): ReviewRow {
  const currentAgentId = snapshot?.assignedAgentId ?? null;
  const currentAgentName =
    currentAgentId === null ? null : agentNames.get(currentAgentId) ?? "Assigned to an inactive agent";
  return {
    orderId: order.orderId,
    orderRef: snapshot?.orderRef ?? order.orderRef,
    customerName: order.customerName,
    currentAgentName,
    proposedAgentId: null,
    proposedAgentName: null,
    status: "skipped",
    reason,
    editable: false,
  };
}
