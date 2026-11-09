import { describe, expect, it } from "vitest";

import { describeEvent, formatMad } from "./format";

describe("formatMad", () => {
  it("formats whole MAD amounts with a thousands separator", () => {
    expect(formatMad(1250)).toBe("1,250 MAD");
  });
});

describe("describeEvent", () => {
  it("labels known audit events", () => {
    expect(describeEvent("auto_cancelled")).toMatch(/three unanswered/);
  });

  it("does not hide unknown event types", () => {
    expect(describeEvent("something_new")).toBe("Order updated");
  });
});
