import { describe, expect, it } from "vitest";

import { SAMPLE_ORDERS } from "../../../test-fixtures/sample-orders";
import { normalizeMoroccanPhone } from "./phone";

function expectE164(input: string, expected: string): void {
  const result = normalizeMoroccanPhone(input);
  expect(result).toEqual({ ok: true, e164: expected });
}

function expectRejected(input: string, problem: string): void {
  expect(normalizeMoroccanPhone(input)).toEqual({ ok: false, problem });
}

describe("normalizeMoroccanPhone: accepted formats", () => {
  it("keeps a canonical +212 number unchanged", () => {
    expectE164("+212600036026", "+212600036026");
  });

  it("strips spaces from an international format", () => {
    expectE164("+212 600 036 026", "+212600036026");
  });

  it("converts the 00212 international prefix", () => {
    expectE164("00212600036026", "+212600036026");
  });

  it("converts the national 0 trunk prefix", () => {
    expectE164("0600036026", "+212600036026");
  });

  it("ignores dashes and parentheses", () => {
    expectE164("0600-036-026", "+212600036026");
    expectE164("(0600) 036 026", "+212600036026");
  });

  it("accepts 212 without a plus sign", () => {
    expectE164("212600036026", "+212600036026");
  });

  it("accepts landline (5), mobile (6) and mobile (7) national prefixes", () => {
    expectE164("+212512345678", "+212512345678");
    expectE164("0712345678", "+212712345678");
  });
});

describe("normalizeMoroccanPhone: rejected inputs", () => {
  it("rejects a national number with no country or trunk prefix", () => {
    expectRejected("600036026", "must start with +212, 00212, or 0 followed by nine digits");
  });

  it("rejects a non-Moroccan international number", () => {
    expectRejected("+20 100 000 0000", "is not a Moroccan number");
  });

  it("rejects a Moroccan number whose national prefix is not 5, 6 or 7", () => {
    expectRejected("+212 400 000 000", "national number must start with 5, 6 or 7");
  });

  it("rejects a number with too many digits", () => {
    expectRejected("+2126000360260", "must have nine digits after +212");
  });

  it("rejects a number with too few digits", () => {
    expectRejected("06000360", "must start with +212, 00212, or 0 followed by nine digits");
  });

  it("rejects letters and other symbols", () => {
    expectRejected("06abc36026", "contains characters other than digits, spaces, dots, dashes or parentheses");
  });

  it("rejects an empty string", () => {
    expect(normalizeMoroccanPhone("").ok).toBe(false);
  });

  it("rejects an input longer than 40 characters", () => {
    expectRejected("0".repeat(41), "is too long");
  });
});

describe("normalizeMoroccanPhone: dataset phone numbers", () => {
  it("normalises every phone in the 50-order dataset to itself", () => {
    expect(SAMPLE_ORDERS.length).toBe(50);
    for (const order of SAMPLE_ORDERS) {
      expect(normalizeMoroccanPhone(order.phone)).toEqual({ ok: true, e164: order.phone });
    }
  });
});
