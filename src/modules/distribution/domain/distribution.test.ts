import { describe, expect, it } from "vitest";

import {
  chooseAgents,
  classifyOrder,
  planDistribution,
  type CandidateAgent,
  type CandidateOrder,
} from "./distribution";

function orders(count: number, startMs = Date.parse("2026-11-01T00:00:00Z")): CandidateOrder[] {
  return Array.from({ length: count }, (_, i) => ({
    orderId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    orderRef: `BRX-${String(1000 + i)}`,
    version: 1,
    createdAt: new Date(startMs + i * 60_000).toISOString(),
  }));
}

function agent(id: string, currentLoad: number, name = id): CandidateAgent {
  return { agentId: id, displayName: name, currentLoad };
}

function countBy(plan: ReturnType<typeof planDistribution>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const assignment of plan.assignments) counts[assignment.agentId] = (counts[assignment.agentId] ?? 0) + 1;
  return counts;
}

/** Seeded pseudo-random numbers, so the large-batch test is repeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("fair workload balancing", () => {
  it("splits orders evenly across agents with equal workload", () => {
    const plan = planDistribution(orders(9), [agent("a", 0), agent("b", 0), agent("c", 0)]);
    expect(Object.values(countBy(plan))).toEqual([3, 3, 3]);
    expect(plan.agents.map((item) => item.projectedLoad)).toEqual([3, 3, 3]);
  });

  it("leaves a remainder of at most one order difference", () => {
    const plan = planDistribution(orders(10), [agent("a", 0), agent("b", 0), agent("c", 0)]);
    const counts = Object.values(countBy(plan)).sort((x, y) => x - y);
    expect(counts).toEqual([3, 3, 4]);
  });
});

describe("unequal existing workloads", () => {
  it("gives the lighter agent the orders until loads meet", () => {
    const plan = planDistribution(orders(8), [agent("heavy", 10, "Heavy"), agent("light", 2, "Light")]);
    const counts = countBy(plan);
    expect(counts.light).toBe(8);
    expect(counts.heavy ?? 0).toBe(0);
    expect(plan.agents.map((item) => item.projectedLoad)).toEqual([2 + 8, 10]);
  });

  it("fills the gap first, then shares the rest as evenly as possible", () => {
    // Total 3 + 6 = 9 over two agents: 5 and 4. Ties go to the agent sorted first (lower load, then name).
    const plan = planDistribution(orders(6), [agent("a", 0, "A"), agent("b", 3, "B")]);
    expect(countBy(plan)).toEqual({ a: 5, b: 1 });
    expect(plan.agents.map((item) => item.projectedLoad)).toEqual([5, 4]);
  });
});

describe("deterministic tie-breaking", () => {
  it("gives the same plan regardless of input order", () => {
    const input = orders(7);
    const agents = [agent("x", 0, "Zed"), agent("y", 0, "Amal")];
    const first = planDistribution(input, agents);
    const second = planDistribution([...input].reverse(), [...agents].reverse());
    expect(second.assignments).toEqual(first.assignments);
  });

  it("breaks equal loads by display name, then by agent id", () => {
    const plan = planDistribution(orders(1), [agent("z-id", 0, "Amal"), agent("a-id", 0, "Zed")]);
    expect(plan.assignments[0]?.agentId).toBe("z-id");
  });

  it("assigns older orders first and breaks equal times by order reference", () => {
    const same = "2026-11-02T10:00:00Z";
    const input: CandidateOrder[] = [
      { orderId: "2", orderRef: "BRX-2000", version: 1, createdAt: same },
      { orderId: "1", orderRef: "BRX-1000", version: 1, createdAt: same },
      { orderId: "3", orderRef: "BRX-0500", version: 1, createdAt: "2026-11-01T10:00:00Z" },
    ];
    const plan = planDistribution(input, [agent("only", 0)]);
    expect(plan.assignments.map((item) => item.orderRef)).toEqual(["BRX-0500", "BRX-1000", "BRX-2000"]);
  });

  it("keeps the version each order had at preview time", () => {
    const input = orders(2).map((order, i) => ({ ...order, version: i + 4 }));
    const plan = planDistribution(input, [agent("a", 0)]);
    expect(plan.assignments.map((item) => item.expectedVersion)).toEqual([4, 5]);
  });
});

describe("agent selection and inactive agents", () => {
  const active = [agent("a", 1, "A"), agent("b", 2, "B")];

  it("keeps only requested active agents and reports the rest as unavailable", () => {
    const result = chooseAgents(active, ["b", "gone", "a"]);
    expect(result.agents.map((item) => item.agentId)).toEqual(["b", "a"]);
    expect(result.unavailable).toEqual(["gone"]);
  });

  it("ignores duplicate agent requests", () => {
    const result = chooseAgents(active, ["a", "a", "a"]);
    expect(result.agents).toHaveLength(1);
    expect(result.unavailable).toEqual([]);
  });

  it("never plans work for an agent who is not in the active list", () => {
    const { agents } = chooseAgents(active, ["a", "inactive"]);
    const plan = planDistribution(orders(5), agents);
    expect(Object.keys(countBy(plan))).toEqual(["a"]);
  });

  it("plans nothing when no agent is selected", () => {
    const plan = planDistribution(orders(5), []);
    expect(plan.assignments).toEqual([]);
    expect(plan.agents).toEqual([]);
  });
});

describe("no eligible orders", () => {
  it("returns an empty plan when there are no orders", () => {
    const plan = planDistribution([], [agent("a", 0)]);
    expect(plan.assignments).toEqual([]);
    expect(plan.agents).toEqual([{ agentId: "a", displayName: "a", currentLoad: 0, newOrders: 0, projectedLoad: 0 }]);
  });
});

describe("duplicate order entries", () => {
  it("assigns a repeated order only once and reports how many were ignored", () => {
    const [first] = orders(1);
    if (first === undefined) throw new Error("fixture");
    const plan = planDistribution([first, first, first], [agent("a", 0)]);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.duplicatesIgnored).toBe(2);
  });
});

describe("eligibility classification", () => {
  const base = {
    orderId: "o",
    orderRef: "BRX-1",
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
  };

  it("accepts only a new, unassigned pipeline order", () => {
    expect(classifyOrder({ ...base, pipelineStatus: "New", assignedAgentId: null })).toEqual({ eligible: true });
  });

  it("excludes orders already assigned, even to the same agent", () => {
    expect(classifyOrder({ ...base, pipelineStatus: "New", assignedAgentId: "a" })).toEqual({
      eligible: false,
      reason: "already_assigned",
    });
  });

  it("excludes historical, finished and non-new pipeline orders", () => {
    expect(classifyOrder({ ...base, pipelineStatus: null, assignedAgentId: null })).toEqual({ eligible: false, reason: "historical" });
    expect(classifyOrder({ ...base, pipelineStatus: "Confirmed", assignedAgentId: null })).toEqual({ eligible: false, reason: "finished" });
    expect(classifyOrder({ ...base, pipelineStatus: "Cancelled", assignedAgentId: null })).toEqual({ eligible: false, reason: "finished" });
    expect(classifyOrder({ ...base, pipelineStatus: "Called", assignedAgentId: null })).toEqual({ eligible: false, reason: "not_new" });
  });
});

describe("large batches", () => {
  it("plans 2,000 orders across 10 agents with unequal loads, quickly and within the balancing rule", () => {
    const random = seeded(20261109);
    const agents = Array.from({ length: 10 }, (_, i) => agent(`agent-${i}`, Math.floor(random() * 50), `Agent ${i}`));
    const input = orders(2000);

    const started = performance.now();
    const plan = planDistribution(input, agents);
    const elapsed = performance.now() - started;

    expect(plan.assignments).toHaveLength(2000);
    expect(new Set(plan.assignments.map((item) => item.orderId)).size).toBe(2000);
    expect(elapsed).toBeLessThan(2000);

    // Balancing rule: any agent that received orders ends at most one above the lightest agent.
    const lightest = Math.min(...plan.agents.map((item) => item.projectedLoad));
    for (const item of plan.agents) {
      if (item.newOrders > 0) expect(item.projectedLoad).toBeLessThanOrEqual(lightest + 1);
    }
    expect(plan.agents.reduce((sum, item) => sum + item.newOrders, 0)).toBe(2000);
  });
});
