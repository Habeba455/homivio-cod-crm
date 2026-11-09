import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { addNoteInput, assignOrderInput, cancelOrderInput, callOutcomeInput, confirmOrderInput } from "./workflow-schemas";

const orderId = randomUUID();
const agentId = randomUUID();

describe("assignOrderInput", () => {
  it("accepts UUIDs and a positive version, coercing form strings", () => {
    expect(assignOrderInput.safeParse({ orderId, agentId, expectedVersion: "3" }).success).toBe(true);
  });

  it("rejects a non-UUID order and a zero version", () => {
    expect(assignOrderInput.safeParse({ orderId: "BRX-1001", agentId, expectedVersion: 1 }).success).toBe(false);
    expect(assignOrderInput.safeParse({ orderId, agentId, expectedVersion: 0 }).success).toBe(false);
  });

  it("rejects unknown keys, so a client cannot smuggle fields", () => {
    expect(
      assignOrderInput.safeParse({ orderId, agentId, expectedVersion: 1, role: "admin" }).success,
    ).toBe(false);
  });
});

describe("callOutcomeInput", () => {
  it("accepts only the two recorded outcomes", () => {
    const base = { orderId, expectedVersion: 2, idempotencyKey: randomUUID() };
    expect(callOutcomeInput.safeParse({ ...base, outcome: "answered" }).success).toBe(true);
    expect(callOutcomeInput.safeParse({ ...base, outcome: "no_answer" }).success).toBe(true);
    expect(callOutcomeInput.safeParse({ ...base, outcome: "voicemail" }).success).toBe(false);
  });

  it("requires a UUID idempotency key", () => {
    expect(
      callOutcomeInput.safeParse({ orderId, expectedVersion: 2, outcome: "answered", idempotencyKey: "abc" }).success,
    ).toBe(false);
  });
});

describe("confirmOrderInput and cancelOrderInput", () => {
  it("accepts a confirm request with a version", () => {
    expect(confirmOrderInput.safeParse({ orderId, expectedVersion: 4 }).success).toBe(true);
  });

  it("accepts only the agent cancel reasons", () => {
    expect(cancelOrderInput.safeParse({ orderId, expectedVersion: 4, reason: "refused" }).success).toBe(true);
    expect(cancelOrderInput.safeParse({ orderId, expectedVersion: 4, reason: "three_unanswered_attempts" }).success).toBe(false);
  });
});

describe("addNoteInput", () => {
  it("trims the body and rejects empty or oversized notes", () => {
    const ok = addNoteInput.safeParse({ orderId, body: "  Customer asked for evening delivery  " });
    expect(ok.success && ok.data.body).toBe("Customer asked for evening delivery");
    expect(addNoteInput.safeParse({ orderId, body: "   " }).success).toBe(false);
    expect(addNoteInput.safeParse({ orderId, body: "x".repeat(2001) }).success).toBe(false);
  });
});
