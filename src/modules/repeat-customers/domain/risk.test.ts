import { describe, expect, it } from "vitest";

import { SAMPLE_ORDERS, type SampleOrder } from "../../../test-fixtures/sample-orders";
import { pipelineStatusFromSource, type CancelReason } from "../../orders/domain/status";
import { assessRepeatCustomer, type OrderSnapshot } from "./risk";

function snap(
  overrides: Partial<OrderSnapshot> & Pick<OrderSnapshot, "id" | "phone" | "createdAt" | "sourceStatus">,
): OrderSnapshot {
  return {
    pipelineStatus: pipelineStatusFromSource(overrides.sourceStatus),
    cancelReason: null,
    ...overrides,
  };
}

function fromSample(order: SampleOrder): OrderSnapshot {
  return snap({
    id: order.id,
    phone: order.phone,
    createdAt: order.createdAt,
    sourceStatus: order.sourceStatus,
  });
}

function assess(current: OrderSnapshot, history: readonly OrderSnapshot[]) {
  const result = assessRepeatCustomer(current, history);
  if (!result.ok) throw new Error(`unexpected rejection on ${result.orderId}: ${result.problem}`);
  return result;
}

const PHONE = "+212600111222";
const EARLIER = "2026-10-01T10:00:00+01:00";
const LATER = "2026-10-10T10:00:00+01:00";

describe("repeat-customer rule: warnings", () => {
  it("P1: warns when a prior source order was refused", () => {
    const prior = snap({ id: "P1", phone: PHONE, createdAt: EARLIER, sourceStatus: "refused" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    const r = assess(current, [prior]);
    expect(r).toMatchObject({ warn: true, refused: 1, cancelled: 0, delivered: 0 });
  });

  it("P2: warns when a prior source order was cancelled", () => {
    const prior = snap({ id: "P2", phone: PHONE, createdAt: EARLIER, sourceStatus: "cancelled" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [prior])).toMatchObject({ warn: true, refused: 0, cancelled: 1 });
  });

  it("P3: warns when a prior CRM order was cancelled with reason refused", () => {
    const prior = snap({
      id: "P3",
      phone: PHONE,
      createdAt: EARLIER,
      sourceStatus: "new",
      pipelineStatus: "Cancelled",
      cancelReason: "refused",
    });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [prior])).toMatchObject({ warn: true, refused: 1, cancelled: 0 });
  });

  it("P4: warns when a prior CRM order was cancelled for another reason", () => {
    const reasons: CancelReason[] = ["requested_by_customer", "other", "three_unanswered_attempts"];
    for (const reason of reasons) {
      const prior = snap({
        id: `P4-${reason}`,
        phone: PHONE,
        createdAt: EARLIER,
        sourceStatus: "new",
        pipelineStatus: "Cancelled",
        cancelReason: reason,
      });
      const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
      expect(assess(current, [prior])).toMatchObject({ warn: true, refused: 0, cancelled: 1 });
    }
  });
});

describe("repeat-customer rule: no warning", () => {
  it("N1: delivered history alone does not warn", () => {
    const prior = snap({ id: "N1", phone: PHONE, createdAt: EARLIER, sourceStatus: "delivered" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [prior])).toMatchObject({ warn: false, delivered: 1, refused: 0, cancelled: 0 });
  });

  it("N2: a prior CRM order that is Confirmed does not warn", () => {
    const prior = snap({
      id: "N2",
      phone: PHONE,
      createdAt: EARLIER,
      sourceStatus: "new",
      pipelineStatus: "Confirmed",
    });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [prior])).toMatchObject({ warn: false, refused: 0, cancelled: 0, delivered: 0 });
  });

  it("N3: a prior order with a different phone never matches, even at the same time", () => {
    const prior = snap({ id: "N3", phone: "+212600999888", createdAt: EARLIER, sourceStatus: "refused" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [prior])).toMatchObject({ warn: false, refused: 0 });
  });

  it("N4: an order never counts as its own history", () => {
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "refused" });
    expect(assess(current, [current])).toMatchObject({ warn: false, refused: 0 });
  });

  it("N5: a later refused order is not history for an earlier order", () => {
    const later = snap({ id: "N5", phone: PHONE, createdAt: LATER, sourceStatus: "refused" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: EARLIER, sourceStatus: "new" });
    expect(assess(current, [later])).toMatchObject({ warn: false, refused: 0 });
  });

  it("N6: an order created at the same instant is not counted as earlier", () => {
    const sameTime = snap({ id: "N6", phone: PHONE, createdAt: LATER, sourceStatus: "refused" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [sameTime])).toMatchObject({ warn: false, refused: 0 });
  });

  it("N7: a phone written in a different format still matches, and a warning is raised", () => {
    const prior = snap({ id: "N7", phone: "0600111222", createdAt: EARLIER, sourceStatus: "refused" });
    const current = snap({ id: "C1", phone: "00212600111222", createdAt: LATER, sourceStatus: "new" });
    expect(assess(current, [prior])).toMatchObject({ warn: true, refused: 1 });
  });
});

describe("repeat-customer rule: matching uses phone only", () => {
  it("ignores name, city and address, which are not part of the snapshot", () => {
    const prior = { ...snap({ id: "M1", phone: PHONE, createdAt: EARLIER, sourceStatus: "refused" }), city: "Rabat", name: "Same Name" };
    const current = { ...snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" }), city: "Fes", name: "Same Name" };
    expect(assess(current, [prior])).toMatchObject({ warn: true, refused: 1 });
  });

  it("matches a repeat customer even when the cities in the dataset differ", () => {
    const rabat = SAMPLE_ORDERS.find((o) => o.id === "BRX-1002");
    const sale = SAMPLE_ORDERS.find((o) => o.id === "BRX-1035");
    if (!rabat || !sale) throw new Error("fixture missing");
    expect(rabat.city).not.toBe(sale.city);
    const r = assess(fromSample(sale), [fromSample(rabat)]);
    expect(r).toMatchObject({ warn: true, refused: 1 });
  });
});

describe("repeat-customer rule: failures", () => {
  it("fails loudly on an unnormalisable current phone", () => {
    const current = snap({ id: "F1", phone: "12345", createdAt: LATER, sourceStatus: "new" });
    expect(assessRepeatCustomer(current, [])).toEqual({
      ok: false,
      orderId: "F1",
      problem: "must start with +212, 00212, or 0 followed by nine digits",
    });
  });

  it("fails loudly on an unnormalisable prior phone instead of skipping it", () => {
    const prior = snap({ id: "F2", phone: "+1 555 0100", createdAt: EARLIER, sourceStatus: "refused" });
    const current = snap({ id: "C1", phone: PHONE, createdAt: LATER, sourceStatus: "new" });
    expect(assessRepeatCustomer(current, [prior])).toMatchObject({ ok: false, orderId: "F2" });
  });

  it("fails loudly on an invalid createdAt", () => {
    const current = snap({ id: "F3", phone: PHONE, createdAt: "not-a-date", sourceStatus: "new" });
    expect(assessRepeatCustomer(current, [])).toMatchObject({ ok: false, orderId: "F3", problem: "has an invalid createdAt" });
  });
});

describe("repeat-customer rule: full 50-order dataset", () => {
  const all = SAMPLE_ORDERS.map(fromSample);
  const active = all.filter((o) => o.sourceStatus === "new");

  it("warns on exactly the four dataset orders with refused or cancelled earlier history", () => {
    const warned = active.filter((c) => assess(c, all).warn).map((c) => c.id);
    expect(warned).toEqual(["BRX-1009", "BRX-1018", "BRX-1035", "BRX-1037"]);
  });

  it("marks exactly the two dataset orders with only delivered earlier history as neutral", () => {
    const deliveredOnly = active.filter((c) => {
      const r = assess(c, all);
      return !r.warn && r.delivered > 0;
    });
    expect(deliveredOnly.map((c) => c.id)).toEqual(["BRX-1020", "BRX-1024"]);
  });

  it("finds no history for the remaining 38 active orders", () => {
    const none = active.filter((c) => {
      const r = assess(c, all);
      return r.refused + r.cancelled + r.delivered === 0;
    });
    expect(none.length).toBe(38);
  });

  it("never warns on a historical order's own phone history from before it was created", () => {
    const first = all.find((o) => o.id === "BRX-1001");
    if (!first) throw new Error("fixture missing");
    expect(assess(first, all)).toMatchObject({ warn: false, delivered: 0, refused: 0, cancelled: 0 });
  });
});
