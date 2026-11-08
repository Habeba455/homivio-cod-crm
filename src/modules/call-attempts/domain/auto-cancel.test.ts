import { describe, expect, it } from "vitest";

import { UNANSWERED_ATTEMPT_LIMIT, shouldAutoCancel, unansweredCountAfter } from "./auto-cancel";

describe("auto-cancel policy", () => {
  it("uses a limit of three unanswered attempts", () => {
    expect(UNANSWERED_ATTEMPT_LIMIT).toBe(3);
  });

  it("increments the unanswered count by one", () => {
    expect(unansweredCountAfter(0)).toBe(1);
    expect(unansweredCountAfter(2)).toBe(3);
  });

  it("does not cancel at one or two unanswered attempts", () => {
    expect(shouldAutoCancel(1)).toBe(false);
    expect(shouldAutoCancel(2)).toBe(false);
  });

  it("cancels at exactly three unanswered attempts", () => {
    expect(shouldAutoCancel(3)).toBe(true);
    expect(shouldAutoCancel(4)).toBe(true);
  });

  it("rejects an invalid starting count", () => {
    expect(() => unansweredCountAfter(-1)).toThrow(RangeError);
    expect(() => unansweredCountAfter(1.5)).toThrow(RangeError);
    expect(() => unansweredCountAfter(Number.NaN)).toThrow(RangeError);
  });
});
