import { describe, expect, it } from "vitest";

import { planDistribution, type CandidateAgent, type OrderSnapshot } from "./distribution";
import { buildReview, type ReviewOrderInput } from "./review";

const BASE = Date.parse("2026-11-01T00:00:00Z");
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function snap(n: number, overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    orderId: idOf(n),
    orderRef: `BRX-${1000 + n}`,
    pipelineStatus: "New",
    assignedAgentId: null,
    version: 1,
    createdAt: new Date(BASE + n * 60_000).toISOString(),
    ...overrides,
  };
}

function inputs(count: number, overrides: Partial<Record<number, Partial<OrderSnapshot>>> = {}): ReviewOrderInput[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return { orderId: idOf(n), orderRef: `BRX-${1000 + n}`, customerName: `Customer ${n}`, snapshot: snap(n, overrides[n]) };
  });
}

const A: CandidateAgent = { agentId: idOf(900), displayName: "Amal", currentLoad: 0 };
const B: CandidateAgent = { agentId: idOf(901), displayName: "Bilal", currentLoad: 0 };
const C: CandidateAgent = { agentId: idOf(902), displayName: "Chama", currentLoad: 0 };
const names = new Map([A, B, C].map((agent) => [agent.agentId, agent.displayName] as const));

/** Seeded pseudo-random numbers, so random-mode tests are repeatable. */
function seeded(seed: number): (size: number) => number {
  let state = seed >>> 0;
  return (size) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * size);
  };
}

function plannedBy(review: ReturnType<typeof buildReview>): Record<string, string> {
  return Object.fromEntries(review.assignments.map((item) => [item.orderRef, item.agentId]));
}

describe("balanced mode", () => {
  it("proposes exactly the same mapping as the balancing rule", () => {
    const orders = inputs(9);
    const review = buildReview({
      orders,
      agents: [A, B, C],
      agentNames: names,
      source: { kind: "balanced" },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    const reference = planDistribution(
      orders.map((o) => ({ orderId: o.orderId, orderRef: o.orderRef, version: 1, createdAt: o.snapshot!.createdAt })),
      [A, B, C],
    );
    expect(review.assignments).toEqual(reference.assignments);
    expect(review.agents.map((agent) => agent.newOrders)).toEqual([3, 3, 3]);
  });

  it("shows current, new and projected workload per agent", () => {
    const loaded = [
      { ...A, currentLoad: 10 },
      { ...B, currentLoad: 2 },
    ];
    const review = buildReview({
      orders: inputs(8),
      agents: loaded,
      agentNames: names,
      source: { kind: "balanced" },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    const bilal = review.agents.find((agent) => agent.agentId === B.agentId);
    expect(bilal).toMatchObject({ currentLoad: 2, newOrders: 8, projectedLoad: 10 });
    expect(review.agents.find((agent) => agent.agentId === A.agentId)).toMatchObject({ newOrders: 0, projectedLoad: 10 });
  });
});

describe("random mode", () => {
  it("draws agents at random: it does not follow a fixed rotation", () => {
    const review = buildReview({
      orders: inputs(30),
      agents: [A, B, C],
      agentNames: names,
      source: { kind: "random", nextIndex: seeded(7) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    const sequence = review.assignments.map((item) => item.agentId);
    const roundRobin = review.assignments.map((_, i) => [A, B, C][i % 3]!.agentId);
    expect(sequence).not.toEqual(roundRobin);
  });

  it("does not balance: a heavily loaded agent can still receive orders", () => {
    const loaded = [
      { ...A, currentLoad: 0 },
      { ...B, currentLoad: 100 },
    ];
    const review = buildReview({
      orders: inputs(20),
      agents: loaded,
      agentNames: names,
      source: { kind: "random", nextIndex: seeded(11) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    expect(review.agents.find((agent) => agent.agentId === B.agentId)?.newOrders).toBeGreaterThan(0);
  });

  it("is reproducible from the seed, and only uses participating agents", () => {
    const run = () =>
      buildReview({
        orders: inputs(25),
        agents: [A, B],
        agentNames: names,
        source: { kind: "random", nextIndex: seeded(3) },
        duplicatesIgnored: 0,
        unavailableAgentCount: 0,
      });
    const first = run();
    expect(run().assignments).toEqual(first.assignments);
    expect(new Set(first.assignments.map((item) => item.agentId))).toEqual(new Set([A.agentId, B.agentId]));
  });

  it("executes the exact mapping reviewed: replaying it as a manual proposal gives the same plan", () => {
    const reviewed = buildReview({
      orders: inputs(15),
      agents: [A, B, C],
      agentNames: names,
      source: { kind: "random", nextIndex: seeded(42) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    const proposal = new Map(reviewed.rows.map((row) => [row.orderId, row.proposedAgentId] as const));
    const replayed = buildReview({
      orders: inputs(15),
      agents: [A, B, C],
      agentNames: names,
      source: { kind: "proposal", proposal },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    expect(replayed.assignments).toEqual(reviewed.assignments);
    expect(replayed.basis).toBe(reviewed.basis);
  });
});

describe("manual mode", () => {
  it("assigns exactly the chosen agent per order, and leaves null orders unassigned", () => {
    const orders = inputs(4);
    const proposal = new Map<string, string | null>([
      [idOf(1), A.agentId],
      [idOf(2), B.agentId],
      [idOf(3), null],
      [idOf(4), A.agentId],
    ]);
    const review = buildReview({
      orders,
      agents: [A, B],
      agentNames: names,
      source: { kind: "proposal", proposal },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    expect(plannedBy(review)).toEqual({ "BRX-1001": A.agentId, "BRX-1002": B.agentId, "BRX-1004": A.agentId });
    const unassigned = review.rows.find((row) => row.orderRef === "BRX-1003");
    expect(unassigned).toMatchObject({ status: "unassigned", reason: "no_agent", editable: true });
  });

  it("treats a chosen agent who is not active as unassigned, not as a valid target", () => {
    const review = buildReview({
      orders: inputs(1),
      agents: [A],
      agentNames: names,
      source: { kind: "proposal", proposal: new Map([[idOf(1), B.agentId]]) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 1,
    });
    expect(review.assignments).toEqual([]);
    expect(review.rows[0]).toMatchObject({ status: "unassigned", reason: "agent_unavailable" });
  });

  it("supports bulk assignment: many selected orders to one agent", () => {
    const proposal = new Map(inputs(50).map((order) => [order.orderId, C.agentId] as const));
    const review = buildReview({
      orders: inputs(50),
      agents: [A, B, C],
      agentNames: names,
      source: { kind: "proposal", proposal },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    expect(review.agents.find((agent) => agent.agentId === C.agentId)?.newOrders).toBe(50);
  });
});

describe("eligibility inside every mode", () => {
  it("skips assigned, historical, finished and missing orders with a reason, and never plans them", () => {
    const orders: ReviewOrderInput[] = [
      { orderId: idOf(1), orderRef: "BRX-1001", customerName: "A", snapshot: snap(1, { assignedAgentId: B.agentId }) },
      { orderId: idOf(2), orderRef: "BRX-1002", customerName: "B", snapshot: snap(2, { pipelineStatus: null }) },
      { orderId: idOf(3), orderRef: "BRX-1003", customerName: "C", snapshot: snap(3, { pipelineStatus: "Confirmed" }) },
      { orderId: idOf(4), orderRef: "BRX-1004", customerName: "D", snapshot: null },
      { orderId: idOf(5), orderRef: "BRX-1005", customerName: "E", snapshot: snap(5) },
    ];
    const review = buildReview({
      orders,
      agents: [A],
      agentNames: names,
      source: { kind: "balanced" },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    expect(review.assignments.map((item) => item.orderRef)).toEqual(["BRX-1005"]);
    expect(review.skippedCount).toBe(4);
    expect(review.rows.find((row) => row.orderRef === "BRX-1001")).toMatchObject({
      status: "skipped",
      reason: "already_assigned",
      currentAgentName: "Bilal",
      editable: false,
    });
    expect(review.excluded.map((item) => item.reason).sort()).toEqual(["already_assigned", "finished", "historical", "not_found"]);
  });
});

describe("basis (detects edits after review)", () => {
  it("is independent of row order, and changes when one proposed agent changes", () => {
    const first = buildReview({
      orders: inputs(3),
      agents: [A, B],
      agentNames: names,
      source: { kind: "proposal", proposal: new Map([[idOf(1), A.agentId], [idOf(2), B.agentId], [idOf(3), A.agentId]]) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    const reversed = buildReview({
      orders: [...inputs(3)].reverse(),
      agents: [A, B],
      agentNames: names,
      source: { kind: "proposal", proposal: new Map([[idOf(1), A.agentId], [idOf(2), B.agentId], [idOf(3), A.agentId]]) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    const edited = buildReview({
      orders: inputs(3),
      agents: [A, B],
      agentNames: names,
      source: { kind: "proposal", proposal: new Map([[idOf(1), B.agentId], [idOf(2), B.agentId], [idOf(3), A.agentId]]) },
      duplicatesIgnored: 0,
      unavailableAgentCount: 0,
    });
    expect(reversed.basis).toBe(first.basis);
    expect(edited.basis).not.toBe(first.basis);
  });
});

describe("no active agents and empty selections", () => {
  it("leaves every eligible order unassigned with a clear reason when no agent is chosen", () => {
    const review = buildReview({
      orders: inputs(3),
      agents: [],
      agentNames: names,
      source: { kind: "balanced" },
      duplicatesIgnored: 0,
      unavailableAgentCount: 2,
    });
    expect(review.proposedCount).toBe(0);
    expect(review.rows.every((row) => row.status === "unassigned" && row.reason === "no_agent")).toBe(true);
  });
});

describe("large batches", () => {
  it("reviews 2,000 orders in every mode within the balancing rule", () => {
    const orders = inputs(2000);
    const agents = Array.from({ length: 10 }, (_, i) => ({ agentId: idOf(500 + i), displayName: `Agent ${i}`, currentLoad: (i * 7) % 40 }));
    const started = Date.now();
    const balanced = buildReview({ orders, agents, agentNames: new Map(), source: { kind: "balanced" }, duplicatesIgnored: 0, unavailableAgentCount: 0 });
    const random = buildReview({ orders, agents, agentNames: new Map(), source: { kind: "random", nextIndex: seeded(9) }, duplicatesIgnored: 0, unavailableAgentCount: 0 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(balanced.proposedCount).toBe(2000);
    expect(random.proposedCount).toBe(2000);
    const lightest = Math.min(...balanced.agents.map((agent) => agent.projectedLoad));
    for (const agent of balanced.agents) {
      if (agent.newOrders > 0) expect(agent.projectedLoad).toBeLessThanOrEqual(lightest + 1);
    }
  });
});
