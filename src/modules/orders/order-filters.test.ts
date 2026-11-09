import { describe, expect, it } from "vitest";

import { parseOrderFilters, sanitizeSearchText } from "./order-filters";

describe("sanitizeSearchText", () => {
  it("removes characters that could change filter syntax", () => {
    expect(sanitizeSearchText("BRX-1001,status.eq.new")).toBe("BRX-1001statuseqnew");
    expect(sanitizeSearchText("+212 600")).toBe("212 600");
    expect(sanitizeSearchText("Sale (test) %_*")).toBe("Sale test");
  });

  it("keeps accented letters, digits and dash", () => {
    expect(sanitizeSearchText("El Jadida 212-6")).toBe("El Jadida 212-6");
    expect(sanitizeSearchText("Fès")).toBe("Fès");
  });

  it("collapses whitespace and limits length", () => {
    expect(sanitizeSearchText("  a    b  ")).toBe("a b");
    expect(sanitizeSearchText("x".repeat(500))).toHaveLength(100);
  });
});

describe("parseOrderFilters", () => {
  it("defaults to all statuses and an empty query", () => {
    expect(parseOrderFilters({})).toEqual({ q: "", status: "all" });
  });

  it("accepts a known source status", () => {
    expect(parseOrderFilters({ status: "refused" })).toEqual({ q: "", status: "refused" });
  });

  it("falls back to all for an unknown status", () => {
    expect(parseOrderFilters({ status: "shipped" })).toEqual({ q: "", status: "all" });
  });

  it("uses the first value when a parameter repeats", () => {
    expect(parseOrderFilters({ q: ["Sale", "Oujda"], status: ["new", "delivered"] })).toEqual({
      q: "Sale",
      status: "new",
    });
  });
});
