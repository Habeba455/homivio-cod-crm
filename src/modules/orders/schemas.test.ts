import { describe, expect, it } from "vitest";

import { orderEventSchema } from "./schemas";

describe("orderEventSchema: boundary validation", () => {
  it("accepts each valid event shape", () => {
    expect(orderEventSchema.safeParse({ type: "call_answered" }).success).toBe(true);
    expect(orderEventSchema.safeParse({ type: "call_no_answer" }).success).toBe(true);
    expect(orderEventSchema.safeParse({ type: "confirm" }).success).toBe(true);
    expect(orderEventSchema.safeParse({ type: "cancel", reason: "refused" }).success).toBe(true);
  });

  it("rejects an unknown event type, such as an assignment smuggled in as a status event", () => {
    expect(orderEventSchema.safeParse({ type: "assign", agentId: "x" }).success).toBe(false);
  });

  it("rejects a cancel event without a reason", () => {
    expect(orderEventSchema.safeParse({ type: "cancel" }).success).toBe(false);
  });

  it("rejects a cancel reason outside the allowed list", () => {
    expect(orderEventSchema.safeParse({ type: "cancel", reason: "three_unanswered_attempts" }).success).toBe(false);
  });

  it("rejects unknown keys, so a client cannot add fields to the domain input", () => {
    expect(orderEventSchema.safeParse({ type: "confirm", status: "Confirmed" }).success).toBe(false);
  });
});
