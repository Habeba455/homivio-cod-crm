import { describe, expect, it } from "vitest";

import { SAMPLE_ORDERS } from "../../../test-fixtures/sample-orders";
import { pipelineStatusFromSource, type PipelineStatus } from "./status";
import { transitionOrder, type OrderEvent, type TransitionOutcome } from "./transitions";

const CALL_ANSWERED: OrderEvent = { type: "call_answered" };
const CALL_NO_ANSWER: OrderEvent = { type: "call_no_answer" };
const CONFIRM: OrderEvent = { type: "confirm" };
const CANCEL_REFUSED: OrderEvent = { type: "cancel", reason: "refused" };
const ALL_EVENTS: readonly OrderEvent[] = [CALL_ANSWERED, CALL_NO_ANSWER, CONFIRM, CANCEL_REFUSED];

/** Expected next status for each event in ALL_EVENTS. null means rejected as an invalid transition. */
const MATRIX: ReadonlyArray<{ from: PipelineStatus; unanswered: number; to: ReadonlyArray<PipelineStatus | null> }> = [
  { from: "New", unanswered: 0, to: ["Called", "No Answer", null, "Cancelled"] },
  { from: "No Answer", unanswered: 1, to: ["Called", "No Answer", null, "Cancelled"] },
  { from: "Called", unanswered: 0, to: ["Called", "Called", "Confirmed", "Cancelled"] },
  { from: "Confirmed", unanswered: 0, to: [null, null, null, null] },
  { from: "Cancelled", unanswered: 0, to: [null, null, null, null] },
];

type Accepted = Extract<TransitionOutcome, { ok: true }>;

/** Applies one event and fails the test if it is rejected. */
function step(input: { status: PipelineStatus; unansweredAttemptCount: number }, event: OrderEvent): Accepted {
  const outcome = transitionOrder(input, event);
  if (!outcome.ok) {
    throw new Error(`expected accept, got ${outcome.error}`);
  }
  return outcome;
}

describe("transitionOrder: legal and illegal transitions", () => {
  for (const row of MATRIX) {
    it(`applies the specified outcome for every event from ${row.from}`, () => {
      ALL_EVENTS.forEach((event, index) => {
        const outcome = transitionOrder({ status: row.from, unansweredAttemptCount: row.unanswered }, event);
        const expected = row.to[index];
        if (expected === null) {
          expect(outcome).toEqual({ ok: false, error: "invalid_transition" });
        } else {
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            expect(outcome.nextStatus).toBe(expected);
          }
        }
      });
    });
  }

  it("moves an order from New to No Answer on its first unanswered call", () => {
    const outcome = step({ status: "New", unansweredAttemptCount: 0 }, CALL_NO_ANSWER);
    expect(outcome.nextStatus).toBe("No Answer");
    expect(outcome.unansweredAttemptCount).toBe(1);
    expect(outcome.autoCancelled).toBe(false);
  });

  it("records the agent's cancel reason on the order", () => {
    const outcome = step({ status: "Called", unansweredAttemptCount: 0 }, { type: "cancel", reason: "requested_by_customer" });
    expect(outcome.nextStatus).toBe("Cancelled");
    expect(outcome.cancelReason).toBe("requested_by_customer");
    expect(outcome.autoCancelled).toBe(false);
  });

  it("rejects every event on a Confirmed order, including cancel", () => {
    for (const event of ALL_EVENTS) {
      expect(transitionOrder({ status: "Confirmed", unansweredAttemptCount: 0 }, event)).toEqual({
        ok: false,
        error: "invalid_transition",
      });
    }
  });
});

describe("transitionOrder: automatic cancellation after unanswered attempts", () => {
  it("does not cancel on the first or second unanswered attempt", () => {
    const first = step({ status: "New", unansweredAttemptCount: 0 }, CALL_NO_ANSWER);
    expect(first.nextStatus).toBe("No Answer");
    expect(first.autoCancelled).toBe(false);

    const second = step({ status: "No Answer", unansweredAttemptCount: first.unansweredAttemptCount }, CALL_NO_ANSWER);
    expect(second.nextStatus).toBe("No Answer");
    expect(second.unansweredAttemptCount).toBe(2);
    expect(second.autoCancelled).toBe(false);
  });

  it("cancels on the third unanswered attempt, with the automatic reason", () => {
    const third = step({ status: "No Answer", unansweredAttemptCount: 2 }, CALL_NO_ANSWER);
    expect(third.nextStatus).toBe("Cancelled");
    expect(third.unansweredAttemptCount).toBe(3);
    expect(third.cancelReason).toBe("three_unanswered_attempts");
    expect(third.autoCancelled).toBe(true);
  });

  it("walks a real dataset order (BRX-1007) to automatic cancellation on the third attempt", () => {
    const order = SAMPLE_ORDERS.find((o) => o.id === "BRX-1007");
    if (order === undefined) throw new Error("fixture missing BRX-1007");
    let state: { status: PipelineStatus; unansweredAttemptCount: number } = {
      status: pipelineStatusFromSource(order.sourceStatus) ?? "New",
      unansweredAttemptCount: 0,
    };

    const first = step(state, CALL_NO_ANSWER);
    expect(first.nextStatus).toBe("No Answer");
    state = { status: first.nextStatus, unansweredAttemptCount: first.unansweredAttemptCount };

    const second = step(state, CALL_NO_ANSWER);
    expect(second.nextStatus).toBe("No Answer");
    state = { status: second.nextStatus, unansweredAttemptCount: second.unansweredAttemptCount };

    const third = step(state, CALL_NO_ANSWER);
    expect(third.nextStatus).toBe("Cancelled");
    expect(third.autoCancelled).toBe(true);
  });

  it("counts total unanswered attempts, so an answered call does not reset the count", () => {
    const afterTwo = step({ status: "No Answer", unansweredAttemptCount: 1 }, CALL_NO_ANSWER);
    const answered = step({ status: afterTwo.nextStatus, unansweredAttemptCount: afterTwo.unansweredAttemptCount }, CALL_ANSWERED);
    expect(answered.nextStatus).toBe("Called");
    expect(answered.unansweredAttemptCount).toBe(2);

    const third = step({ status: answered.nextStatus, unansweredAttemptCount: answered.unansweredAttemptCount }, CALL_NO_ANSWER);
    expect(third.nextStatus).toBe("Cancelled");
    expect(third.autoCancelled).toBe(true);
  });
});

describe("historical source orders", () => {
  const historical = SAMPLE_ORDERS.filter((o) => o.sourceStatus !== "new");
  const active = SAMPLE_ORDERS.filter((o) => o.sourceStatus === "new");

  it("contains the six historical orders and 44 active orders in the dataset", () => {
    expect(historical.length).toBe(6);
    expect(active.length).toBe(44);
  });

  it("maps every active source order to New and every historical one to no pipeline status", () => {
    for (const order of active) {
      expect(pipelineStatusFromSource(order.sourceStatus)).toBe("New");
    }
    for (const order of historical) {
      expect(pipelineStatusFromSource(order.sourceStatus)).toBeNull();
    }
  });

  it("never maps a delivered order to Confirmed", () => {
    const delivered = SAMPLE_ORDERS.filter((o) => o.sourceStatus === "delivered");
    expect(delivered.length).toBe(2);
    for (const order of delivered) {
      expect(pipelineStatusFromSource(order.sourceStatus)).not.toBe("Confirmed");
    }
  });

  it("rejects every event on a historical order with not_in_pipeline, without inventing an outcome", () => {
    for (const event of ALL_EVENTS) {
      expect(transitionOrder({ status: null, unansweredAttemptCount: 0 }, event)).toEqual({
        ok: false,
        error: "not_in_pipeline",
      });
    }
  });

  it("does not modify the input or the event", () => {
    const input = Object.freeze({ status: null, unansweredAttemptCount: 0 });
    const event = Object.freeze({ type: "call_no_answer" as const });
    const outcome = transitionOrder(input, event);
    expect(outcome).toEqual({ ok: false, error: "not_in_pipeline" });
    expect(input).toEqual({ status: null, unansweredAttemptCount: 0 });
    expect(event).toEqual({ type: "call_no_answer" });
  });
});
