import { describe, expect, it } from "vitest";

import { transitionOrder } from "../../orders/domain/transitions";

import {
  assessOrder,
  nextRecommended,
  rankQueue,
  scopeToAgent,
  summarizeQueue,
  type OrderSignals,
  type EligibleAssessment,
} from "./priority";

const NOW = new Date("2026-11-09T12:00:00Z");
const HOUR = 3_600_000;
const iso = (msBeforeNow: number) => new Date(NOW.getTime() - msBeforeNow).toISOString();

function signals(overrides: Partial<OrderSignals> = {}): OrderSignals {
  return {
    orderId: "00000000-0000-4000-8000-000000000001",
    orderRef: "BRX-1001",
    status: "New",
    unansweredAttemptCount: 0,
    createdAt: iso(2 * HOUR),
    lastAttemptAt: null,
    history: { refused: 0, cancelled: 0 },
    assignedAgentId: "agent-a",
    ...overrides,
  };
}

function eligible(assessment: ReturnType<typeof assessOrder>): EligibleAssessment {
  if (!assessment.eligible) throw new Error("expected an eligible assessment");
  return assessment;
}

describe("exclusions", () => {
  it("never scores historical orders", () => {
    expect(assessOrder(signals({ status: null }), NOW)).toMatchObject({ eligible: false, reason: "historical" });
  });

  it("never scores confirmed or cancelled orders", () => {
    expect(assessOrder(signals({ status: "Confirmed" }), NOW)).toMatchObject({ eligible: false, reason: "finished" });
    expect(assessOrder(signals({ status: "Cancelled" }), NOW)).toMatchObject({ eligible: false, reason: "finished" });
  });
});

describe("automatic cancellation risk", () => {
  it("flags two unanswered calls as urgent with a last-chance action", () => {
    const result = eligible(
      assessOrder(signals({ status: "No Answer", unansweredAttemptCount: 2, lastAttemptAt: iso(HOUR) }), NOW),
    );
    expect(result.reasons.map((reason) => reason.code)).toContain("auto_cancel_next");
    expect(result.level).toBe("urgent");
    expect(result.action).toBe("call_last_chance");
  });

  it("treats one unanswered call as a normal-priority retry", () => {
    const result = eligible(
      assessOrder(signals({ status: "No Answer", unansweredAttemptCount: 1, lastAttemptAt: iso(HOUR) }), NOW),
    );
    expect(result.level).toBe("normal");
    expect(result.action).toBe("retry_call");
  });
});

describe("uncontacted orders and waiting time", () => {
  it("scores a brand-new order as normal, with a first-call action", () => {
    const result = eligible(assessOrder(signals({ createdAt: iso(0.5 * HOUR) }), NOW));
    expect(result.reasons.map((reason) => reason.code)).toEqual(["never_contacted"]);
    expect(result.level).toBe("normal");
    expect(result.action).toBe("first_call");
  });

  it("adds a waiting reason after 24 hours and a stronger one after 3 days", () => {
    const day = eligible(assessOrder(signals({ createdAt: iso(25 * HOUR) }), NOW));
    expect(day.reasons.map((reason) => reason.code)).toContain("waiting_first_contact");
    expect(day.reasons.map((reason) => reason.code)).not.toContain("waiting_long");

    const threeDays = eligible(assessOrder(signals({ createdAt: iso(73 * HOUR) }), NOW));
    expect(threeDays.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["waiting_first_contact", "waiting_long"]),
    );
    expect(threeDays.level).toBe("high");
  });

  it("uses the 24-hour boundary inclusively", () => {
    const exact = eligible(assessOrder(signals({ createdAt: iso(24 * HOUR) }), NOW));
    expect(exact.reasons.map((reason) => reason.code)).toContain("waiting_first_contact");
  });
});

describe("time since last contact", () => {
  it("flags a stale attempt after 24 hours, but not before", () => {
    const stale = eligible(
      assessOrder(signals({ status: "No Answer", unansweredAttemptCount: 1, lastAttemptAt: iso(30 * HOUR) }), NOW),
    );
    expect(stale.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["one_unanswered", "stale_contact"]));

    const fresh = eligible(
      assessOrder(signals({ status: "No Answer", unansweredAttemptCount: 1, lastAttemptAt: iso(23 * HOUR) }), NOW),
    );
    expect(fresh.reasons.map((reason) => reason.code)).not.toContain("stale_contact");
  });

  it("treats a future attempt timestamp (clock skew) as zero hours, not negative", () => {
    const future = eligible(
      assessOrder(
        signals({ status: "No Answer", unansweredAttemptCount: 1, lastAttemptAt: new Date(NOW.getTime() + HOUR).toISOString() }),
        NOW,
      ),
    );
    expect(future.reasons.map((reason) => reason.code)).not.toContain("stale_contact");
  });
});

describe("customer history", () => {
  it("adds a visible reason for earlier refused or cancelled orders", () => {
    const result = eligible(assessOrder(signals({ history: { refused: 1, cancelled: 1 } }), NOW));
    const history = result.reasons.find((reason) => reason.code === "customer_history");
    expect(history?.text).toMatch(/1 refused, 1 cancelled/);
    expect(history?.points).toBeGreaterThan(0);
  });

  it("adds no history points when there is no negative history", () => {
    const result = eligible(assessOrder(signals({ history: { refused: 0, cancelled: 0 } }), NOW));
    expect(result.reasons.map((reason) => reason.code)).not.toContain("customer_history");
  });

  it("reports unavailable history as a note, never as zero", () => {
    const result = eligible(assessOrder(signals({ history: null }), NOW));
    const note = result.reasons.find((reason) => reason.code === "history_unavailable");
    expect(note?.points).toBe(0);
    expect(result.reasons.map((reason) => reason.code)).not.toContain("customer_history");
  });
});

describe("answered calls", () => {
  it("asks for confirm or cancel once the customer has answered", () => {
    const result = eligible(assessOrder(signals({ status: "Called", lastAttemptAt: iso(HOUR) }), NOW));
    expect(result.action).toBe("confirm_or_cancel");
    expect(result.reasons.map((reason) => reason.code)).toContain("customer_answered");
  });
});

describe("data issues", () => {
  it("marks an unparseable creation date for review instead of guessing", () => {
    const result = eligible(assessOrder(signals({ createdAt: "not a date" }), NOW));
    expect(result.hasDataIssue).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toContain("data_issue");
  });

  it("flags an unanswered count with no recorded attempt", () => {
    const result = eligible(assessOrder(signals({ status: "No Answer", unansweredAttemptCount: 1, lastAttemptAt: null }), NOW));
    expect(result.hasDataIssue).toBe(true);
  });

  it("flags a New order that already has unanswered calls", () => {
    const result = eligible(assessOrder(signals({ status: "New", unansweredAttemptCount: 1, lastAttemptAt: iso(HOUR) }), NOW));
    expect(result.hasDataIssue).toBe(true);
  });
});

describe("calling-hours note", () => {
  it("adds a non-scoring note outside Casablanca calling hours, and none inside them", () => {
    const night = eligible(assessOrder(signals({ createdAt: iso(0.5 * HOUR) }), new Date("2026-11-09T03:00:00Z")));
    const noteNight = night.reasons.find((reason) => reason.code === "outside_calling_hours");
    expect(noteNight?.points).toBe(0);

    const day = eligible(assessOrder(signals({ createdAt: iso(0.5 * HOUR) }), new Date("2026-11-09T12:00:00Z")));
    expect(day.reasons.map((reason) => reason.code)).not.toContain("outside_calling_hours");
  });
});

describe("ordering and tie-breaking", () => {
  it("ranks by score, then unanswered count, then age, then order reference", () => {
    const urgent = assessOrder(signals({ orderId: "u", orderRef: "BRX-2002", status: "No Answer", unansweredAttemptCount: 2, lastAttemptAt: iso(HOUR) }), NOW);
    const lowA = assessOrder(signals({ orderId: "a", orderRef: "BRX-3003", createdAt: iso(0.1 * HOUR) }), NOW);
    const sameScoreOlder = assessOrder(signals({ orderId: "b", orderRef: "BRX-4004", createdAt: iso(5 * HOUR) }), NOW);
    const sameScoreNewer = assessOrder(signals({ orderId: "c", orderRef: "BRX-1005", createdAt: iso(1 * HOUR) }), NOW);

    const ranked = rankQueue([sameScoreNewer, lowA, urgent, sameScoreOlder]);
    expect(ranked.map((item) => item.orderRef)).toEqual(["BRX-2002", "BRX-4004", "BRX-1005", "BRX-3003"]);
  });

  it("breaks identical scores and ages by order reference, deterministically", () => {
    const sameTime = iso(2 * HOUR);
    const first = assessOrder(signals({ orderId: "x", orderRef: "BRX-1002", createdAt: sameTime }), NOW);
    const second = assessOrder(signals({ orderId: "y", orderRef: "BRX-1001", createdAt: sameTime }), NOW);
    expect(rankQueue([first, second]).map((item) => item.orderRef)).toEqual(["BRX-1001", "BRX-1002"]);
  });
});

describe("agent scope and empty queues", () => {
  it("returns only the viewer's orders, so another agent's orders never enter the queue", () => {
    const mine = signals({ orderId: "m", orderRef: "BRX-1001", assignedAgentId: "agent-a" });
    const theirs = signals({ orderId: "t", orderRef: "BRX-1002", assignedAgentId: "agent-b" });
    const unassigned = signals({ orderId: "n", orderRef: "BRX-1003", assignedAgentId: null });
    const scoped = scopeToAgent([mine, theirs, unassigned], "agent-a");
    expect(scoped.map((item) => item.orderRef)).toEqual(["BRX-1001"]);
  });

  it("handles an empty queue with no next order and zero counts", () => {
    const ranked = rankQueue([]);
    expect(nextRecommended(ranked)).toBeNull();
    expect(summarizeQueue(ranked)).toEqual({ active: 0, needsAttention: 0, closeToCancel: 0, uncontacted: 0, dataIssues: 0 });
  });

  it("excludes historical and finished orders from the ranked queue", () => {
    const ranked = rankQueue([
      assessOrder(signals({ orderRef: "BRX-1001", status: null }), NOW),
      assessOrder(signals({ orderRef: "BRX-1002", status: "Confirmed" }), NOW),
      assessOrder(signals({ orderRef: "BRX-1003" }), NOW),
    ]);
    expect(ranked.map((item) => item.orderRef)).toEqual(["BRX-1003"]);
  });
});

describe("summary and next recommended order", () => {
  it("counts attention, close-to-cancel and uncontacted orders from the same ranked list", () => {
    const ranked = rankQueue([
      assessOrder(signals({ orderRef: "BRX-1001", status: "No Answer", unansweredAttemptCount: 2, lastAttemptAt: iso(HOUR) }), NOW),
      assessOrder(signals({ orderRef: "BRX-1002", createdAt: iso(0.2 * HOUR) }), NOW),
    ]);
    expect(summarizeQueue(ranked)).toMatchObject({ active: 2, needsAttention: 1, closeToCancel: 1, uncontacted: 1 });
    expect(nextRecommended(ranked)?.orderRef).toBe("BRX-1001");
  });
});

describe("priority after state changes (uses the real state machine)", () => {
  it("rises after each unanswered call and leaves the queue once cancelled", () => {
    let status: "New" | "No Answer" | "Called" | "Confirmed" | "Cancelled" = "New";
    let unanswered = 0;
    let lastAttempt: string | null = null;
    const record = (step: number) => {
      const outcome = transitionOrder({ status, unansweredAttemptCount: unanswered }, { type: "call_no_answer" });
      if (!outcome.ok) throw new Error("unexpected rejection");
      status = outcome.nextStatus;
      unanswered = outcome.unansweredAttemptCount;
      lastAttempt = iso(step * HOUR);
    };

    record(3);
    const afterFirst = eligible(assessOrder(signals({ status, unansweredAttemptCount: unanswered, lastAttemptAt: lastAttempt }), NOW));
    expect(afterFirst.action).toBe("retry_call");

    record(2);
    const afterSecond = eligible(assessOrder(signals({ status, unansweredAttemptCount: unanswered, lastAttemptAt: lastAttempt }), NOW));
    expect(afterSecond.level).toBe("urgent");
    expect(afterSecond.action).toBe("call_last_chance");

    record(1);
    expect(status).toBe("Cancelled");
    expect(assessOrder(signals({ status, unansweredAttemptCount: unanswered, lastAttemptAt: lastAttempt }), NOW)).toMatchObject({
      eligible: false,
      reason: "finished",
    });
  });
});
