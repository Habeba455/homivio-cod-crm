import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXPECTED_FILE_SHA256, validateSourceFile } from "./source-import";

// Dry run against the real file. Skipped unless SAMPLE_ORDERS_PATH points to sample_orders.json.
// Example: SAMPLE_ORDERS_PATH="$HOME/Downloads/sample_orders.json" npm test
// The test prints no order contents.
const samplePath = process.env.SAMPLE_ORDERS_PATH ?? "";

describe.skipIf(samplePath === "")("sample_orders.json dry run", () => {
  it("matches the verified checksum and the verified counts", () => {
    const bytes = readFileSync(samplePath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(EXPECTED_FILE_SHA256);

    const result = validateSourceFile(JSON.parse(bytes.toString("utf8")));
    expect(result).toMatchObject({
      ok: true,
      summary: { orderCount: 50, pipelineCount: 44, historicalCount: 6, customerCount: 44, itemCount: 80 },
    });
  });
});
