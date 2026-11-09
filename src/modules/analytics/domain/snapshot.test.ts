import { describe, expect, it } from "vitest";

import { activePipelineCount, snapshotIsConsistent, type SnapshotCounts } from "./snapshot";

const sample: SnapshotCounts = {
  total: 50,
  historical: 6,
  New: 20,
  "No Answer": 5,
  Called: 9,
  Confirmed: 6,
  Cancelled: 4,
};

describe("activePipelineCount", () => {
  it("counts New, No Answer and Called, and excludes terminal statuses", () => {
    expect(activePipelineCount(sample)).toBe(34);
  });
});

describe("snapshotIsConsistent", () => {
  it("accepts counts where historical plus pipeline equals the total", () => {
    expect(snapshotIsConsistent(sample)).toBe(true);
  });

  it("rejects counts that do not add up", () => {
    expect(snapshotIsConsistent({ ...sample, total: 51 })).toBe(false);
  });
});
