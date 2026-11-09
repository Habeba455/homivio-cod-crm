import { describe, expect, it } from "vitest";

import { orderActions } from "./workflow-view";

describe("orderActions", () => {
  it("allows answer, no answer, cancel and assignment for a new order, but not confirm", () => {
    expect(orderActions("New", 0)).toMatchObject({ answer: true, noAnswer: true, cancel: true, assign: true, confirm: false });
  });

  it("allows confirm only after the customer has answered", () => {
    expect(orderActions("Called", 0)).toMatchObject({ confirm: true, answer: true, assign: true });
    expect(orderActions("No Answer", 1)).toMatchObject({ confirm: false, answer: true });
  });

  it("closes every action for confirmed and cancelled orders", () => {
    for (const status of ["Confirmed", "Cancelled"] as const) {
      expect(orderActions(status, 0)).toMatchObject({
        answer: false,
        noAnswer: false,
        confirm: false,
        cancel: false,
        assign: false,
      });
    }
  });

  it("treats historical orders as outside the workflow", () => {
    expect(orderActions(null, 0)).toEqual({
      historical: true,
      answer: false,
      noAnswer: false,
      confirm: false,
      cancel: false,
      assign: false,
    });
  });

  it("still offers the third unanswered call, which the database then auto-cancels", () => {
    // The third unanswered call is a valid action. The state machine moves the order to Cancelled.
    expect(orderActions("No Answer", 2).noAnswer).toBe(true);
  });
});
