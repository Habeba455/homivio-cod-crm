import { describe, expect, it } from "vitest";

import {
  distributionResultSchema,
  distributeInputSchema,
  parseJsonOrUndefined,
  planSchema,
  proposalSchema,
  reviewPayloadSchema,
} from "./schemas";

const ORDER = "00000000-0000-4000-8000-000000000001";
const ORDER_2 = "00000000-0000-4000-8000-000000000002";
const AGENT = "00000000-0000-4000-8000-0000000000aa";
const BATCH = "00000000-0000-4000-8000-0000000000bb";

describe("review payload", () => {
  const valid = { mode: "random", orderIds: [ORDER], agentIds: [AGENT] };

  it("accepts each of the three modes", () => {
    for (const mode of ["manual", "random", "balanced"]) {
      expect(reviewPayloadSchema.safeParse({ ...valid, mode }).success).toBe(true);
    }
  });

  it("rejects an unknown mode, empty selections and extra fields", () => {
    expect(reviewPayloadSchema.safeParse({ ...valid, mode: "round_robin" }).success).toBe(false);
    expect(reviewPayloadSchema.safeParse({ ...valid, orderIds: [] }).success).toBe(false);
    expect(reviewPayloadSchema.safeParse({ ...valid, agentIds: [] }).success).toBe(false);
    expect(reviewPayloadSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it("rejects more than 2,000 orders and non-UUID values", () => {
    expect(reviewPayloadSchema.safeParse({ ...valid, orderIds: Array.from({ length: 2001 }, () => ORDER) }).success).toBe(false);
    expect(reviewPayloadSchema.safeParse({ ...valid, orderIds: ["nope"] }).success).toBe(false);
  });
});

describe("proposal (the mapping shown in the preview)", () => {
  it("accepts an agent or null (unassigned) for each order", () => {
    expect(proposalSchema.safeParse([{ orderId: ORDER, agentId: AGENT }, { orderId: ORDER_2, agentId: null }]).success).toBe(true);
  });

  it("rejects extra keys such as a customer field", () => {
    expect(proposalSchema.safeParse([{ orderId: ORDER, agentId: AGENT, customer: "x" }]).success).toBe(false);
  });
});

describe("plan and distribute input", () => {
  const item = { order_id: ORDER, agent_id: AGENT, expected_version: 3 };

  it("accepts a well-formed plan", () => {
    expect(planSchema.safeParse([item]).success).toBe(true);
  });

  it("rejects an empty plan, a version below 1 and extra keys", () => {
    expect(planSchema.safeParse([]).success).toBe(false);
    expect(planSchema.safeParse([{ ...item, expected_version: 0 }]).success).toBe(false);
    expect(planSchema.safeParse([{ ...item, customer_phone: "+212600000000" }]).success).toBe(false);
  });

  it("requires a batch key, a plan string and a known mode", () => {
    expect(distributeInputSchema.safeParse({ batchKey: BATCH, plan: "[]", mode: "manual" }).success).toBe(true);
    expect(distributeInputSchema.safeParse({ batchKey: "x", plan: "[]", mode: "manual" }).success).toBe(false);
    expect(distributeInputSchema.safeParse({ batchKey: BATCH, plan: "[]", mode: "auto" }).success).toBe(false);
  });

  it("returns undefined for invalid JSON instead of throwing", () => {
    expect(parseJsonOrUndefined("{not json")).toBeUndefined();
    expect(parseJsonOrUndefined("[]")).toEqual([]);
  });
});

describe("distribute RPC result", () => {
  const valid = {
    batch_id: BATCH,
    mode: "balanced",
    replayed: false,
    requested: 2,
    assigned: 1,
    skipped: 1,
    failed: 0,
    items: [
      { order_id: ORDER, outcome: "assigned", reason: null },
      { order_id: AGENT, outcome: "skipped", reason: "already_assigned" },
    ],
  };

  it("accepts the shape the database returns", () => {
    expect(distributionResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown outcome or mode", () => {
    expect(distributionResultSchema.safeParse({ ...valid, items: [{ order_id: ORDER, outcome: "overwritten", reason: null }] }).success).toBe(false);
    expect(distributionResultSchema.safeParse({ ...valid, mode: "round_robin" }).success).toBe(false);
  });
});
