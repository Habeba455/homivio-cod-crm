import { describe, expect, it } from "vitest";

import type { OrderSignals } from "./priority";
import { buildRescueQueue, type RescueItem } from "./queue";

const NOW = new Date("2026-11-09T12:00:00Z");

function item(ref: string, agentId: string | null, overrides: Partial<OrderSignals> = {}): RescueItem {
  return {
    signals: {
      orderId: `id-${ref}`,
      orderRef: ref,
      status: "New",
      unansweredAttemptCount: 0,
      createdAt: "2026-11-09T09:00:00Z",
      lastAttemptAt: null,
      history: { refused: 0, cancelled: 0 },
      assignedAgentId: agentId,
      ...overrides,
    },
    customerName: `Customer ${ref}`,
    agentName: agentId === null ? null : "Agent",
    shippingCity: "Casablanca",
  };
}

describe("buildRescueQueue", () => {
  it("returns only the viewer's orders when scoped to an agent", () => {
    const queue = buildRescueQueue([item("BRX-1", "a"), item("BRX-2", "b")], NOW, "a");
    expect(queue.rows.map((row) => row.assessment.orderRef)).toEqual(["BRX-1"]);
    expect(queue.summary.active).toBe(1);
  });

  it("puts the highest-priority order first as the next recommended order, with display fields joined", () => {
    const queue = buildRescueQueue(
      [
        item("BRX-1", "a"),
        item("BRX-2", "a", { status: "No Answer", unansweredAttemptCount: 2, lastAttemptAt: "2026-11-09T11:00:00Z" }),
      ],
      NOW,
    );
    expect(queue.next?.assessment.orderRef).toBe("BRX-2");
    expect(queue.rows[0]?.customerName).toBe("Customer BRX-2");
    expect(queue.rows[1]?.shippingCity).toBe("Casablanca");
  });

  it("returns an empty queue with no next order when nothing is active", () => {
    const queue = buildRescueQueue([item("BRX-1", "a", { status: "Confirmed" })], NOW);
    expect(queue.rows).toEqual([]);
    expect(queue.next).toBeNull();
    expect(queue.summary).toMatchObject({ active: 0, needsAttention: 0 });
  });
});
