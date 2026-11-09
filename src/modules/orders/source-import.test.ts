import { describe, expect, it } from "vitest";

import { EXPECTED_ORDER_COUNT, validateSourceFile } from "./source-import";

// Synthetic rows for unit tests only. These are not the client's data.
function makeOrder(index: number, status: "new" | "delivered" | "refused" | "cancelled" = "new") {
  const quantity = (index % 2) + 1;
  const unitPrice = 100;
  const subtotal = quantity * unitPrice;
  const shippingFee = subtotal >= 318 ? 0 : 30;
  return {
    id: `BRX-${1001 + index}`,
    created_at: "2026-10-20T10:00:00+01:00",
    status,
    customer: { name: `Test Customer ${index}`, phone: `+2126${String(index).padStart(8, "0")}` },
    shipping_address: { city: "Sale", district: "Centre", address1: "Rue test n°1" },
    line_items: [{ sku: "BRX-001", title: "Produit test", quantity, unit_price: unitPrice }],
    subtotal,
    shipping_fee: shippingFee,
    total: subtotal + shippingFee,
    currency: "MAD",
    payment_method: "COD",
  };
}

function makeFile(count = EXPECTED_ORDER_COUNT, historicalFrom = 44) {
  return {
    orders: Array.from({ length: count }, (_, index) =>
      makeOrder(index, index >= historicalFrom ? "delivered" : "new"),
    ),
  };
}

describe("validateSourceFile", () => {
  it("accepts 50 orders and counts pipeline, historical, customers and items", () => {
    const result = validateSourceFile(makeFile());
    expect(result).toMatchObject({
      ok: true,
      summary: { orderCount: 50, pipelineCount: 44, historicalCount: 6, customerCount: 50, itemCount: 50 },
    });
  });

  it("returns the untouched source objects for hashing", () => {
    const file = makeFile();
    const result = validateSourceFile(file);
    expect(result.ok && result.rawOrders[0]).toBe(file.orders[0]);
  });

  it("rejects a file with the wrong order count", () => {
    const result = validateSourceFile(makeFile(49, 43));
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.issues.map((issue) => issue.path)).toContain("orders");
  });

  it("rejects a subtotal that does not match the line items", () => {
    const file = makeFile();
    file.orders[3].subtotal += 1;
    const result = validateSourceFile(file);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toContain("orders[3].subtotal");
  });

  it("rejects a total that does not equal subtotal plus shipping", () => {
    const file = makeFile();
    file.orders[5].total += 1;
    const result = validateSourceFile(file);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toContain("orders[5].total");
  });

  it("rejects a phone outside +212 E.164 form", () => {
    const file = makeFile();
    file.orders[7].customer.phone = "+33612345678";
    const result = validateSourceFile(file);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toContain("orders[7].customer.phone");
  });

  it("rejects a duplicate order ID", () => {
    const file = makeFile();
    file.orders[9].id = file.orders[2].id;
    const result = validateSourceFile(file);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toContain("orders[9].id");
  });

  it("rejects an unknown source status", () => {
    const file = makeFile();
    (file.orders[0] as { status: string }).status = "shipped";
    const result = validateSourceFile(file);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toContain("orders[0].status");
  });

  it("rejects extra top-level keys", () => {
    const result = validateSourceFile({ ...makeFile(), extra: true });
    expect(result).toMatchObject({ ok: false });
  });

  it("reports every bad row, not only the first", () => {
    const file = makeFile();
    file.orders[1].subtotal += 1;
    file.orders[20].total += 1;
    const result = validateSourceFile(file);
    const paths = !result.ok ? result.issues.map((issue) => issue.path) : [];
    expect(paths).toEqual(expect.arrayContaining(["orders[1].subtotal", "orders[20].total"]));
  });
});
