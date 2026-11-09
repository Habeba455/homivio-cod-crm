import { describe, expect, it } from "vitest";

import { confirmationRate, formatRate } from "./rates";

describe("confirmationRate", () => {
  it("divides confirmed by confirmed plus cancelled", () => {
    expect(confirmationRate(3, 1)).toEqual({ confirmed: 3, cancelled: 1, decided: 4, rate: 0.75 });
  });

  it("returns null, not zero or NaN, when nothing was decided", () => {
    const result = confirmationRate(0, 0);
    expect(result.rate).toBeNull();
    expect(result.decided).toBe(0);
  });

  it("returns zero when every decided order was cancelled", () => {
    expect(confirmationRate(0, 5).rate).toBe(0);
  });

  it("returns one when every decided order was confirmed", () => {
    expect(confirmationRate(4, 0).rate).toBe(1);
  });

  it("rejects negative or non-integer counts", () => {
    expect(() => confirmationRate(-1, 0)).toThrow(RangeError);
    expect(() => confirmationRate(1.5, 0)).toThrow(RangeError);
  });
});

describe("formatRate", () => {
  it("shows one decimal place and an em dash for no decisions", () => {
    expect(formatRate(2 / 3)).toBe("66.7%");
    expect(formatRate(null)).toBe("—");
  });
});
