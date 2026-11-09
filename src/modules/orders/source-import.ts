import { z } from "zod";

import { normalizeMoroccanPhone } from "../repeat-customers/domain/phone";

import { SOURCE_STATUSES } from "./domain/status";

/**
 * Pure validation of sample_orders.json (architecture §5.3 and §8.1). No I/O, so it is unit tested.
 * The operator script and the dry-run test both call validateSourceFile().
 */

/** The verified file holds exactly 50 orders (configurable in the architecture, fixed here). */
export const EXPECTED_ORDER_COUNT = 50;

/** SHA-256 of the verified sample_orders.json. It is the import batch key. */
export const EXPECTED_FILE_SHA256 = "4a51cb270eb99aa1ea1e0b3c9a5bafa9d8198834aae888def536b0682995cdd4";

const nonEmptyText = z.string().trim().min(1);

const lineItemSchema = z.object({
  sku: z.string().regex(/^BRX-\d{3}$/),
  title: nonEmptyText,
  quantity: z.int().min(1),
  unit_price: z.int().min(0),
});

/** One source row. Unknown keys are stripped here only for checking. The raw object is what gets imported. */
export const sourceOrderSchema = z.object({
  id: z.string().regex(/^BRX-\d{4}$/),
  created_at: z.iso.datetime({ offset: true }),
  status: z.enum(SOURCE_STATUSES),
  customer: z.object({ name: nonEmptyText, phone: z.string() }),
  shipping_address: z.object({
    city: nonEmptyText,
    district: z.string(),
    address1: nonEmptyText,
  }),
  line_items: z.array(lineItemSchema).min(1),
  subtotal: z.int().min(0),
  shipping_fee: z.int().min(0),
  total: z.int().min(0),
  currency: z.literal("MAD"),
  payment_method: z.literal("COD"),
  history_note: z.string().optional(),
});

const fileShapeSchema = z.object({ orders: z.array(z.unknown()) }).strict();

export type RowIssue = {
  /** Location in the file, for example orders[3].customer.phone. Never contains customer values. */
  path: string;
  message: string;
};

export type ImportSummary = {
  orderCount: number;
  /** Orders that enter the CRM pipeline (source status "new"). */
  pipelineCount: number;
  /** Historical orders (delivered, refused, cancelled). Kept out of the pipeline. */
  historicalCount: number;
  customerCount: number;
  itemCount: number;
};

export type SourceFileValidation =
  | { ok: true; summary: ImportSummary; rawOrders: unknown[] }
  | { ok: false; issues: RowIssue[] };

function joinPath(prefix: string, segments: readonly PropertyKey[]): string {
  return [prefix, ...segments.map(String)].filter((part) => part !== "").join(".");
}

/**
 * Validates the whole file and reports every problem, not just the first.
 * On success, rawOrders holds the untouched source objects. The RPC hashes them, so they must not be rebuilt.
 */
export function validateSourceFile(raw: unknown): SourceFileValidation {
  const shape = fileShapeSchema.safeParse(raw);
  if (!shape.success) {
    return {
      ok: false,
      issues: shape.error.issues.map((issue) => ({
        path: joinPath("", issue.path),
        message: issue.message,
      })),
    };
  }

  const rawOrders = shape.data.orders;
  const issues: RowIssue[] = [];

  if (rawOrders.length !== EXPECTED_ORDER_COUNT) {
    issues.push({
      path: "orders",
      message: `must contain exactly ${EXPECTED_ORDER_COUNT} orders, found ${rawOrders.length}`,
    });
  }

  const idFirstSeenAt = new Map<string, number>();
  const phones = new Set<string>();
  let pipelineCount = 0;
  let itemCount = 0;

  rawOrders.forEach((row, index) => {
    const prefix = `orders[${index}]`;
    const parsed = sourceOrderSchema.safeParse(row);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ path: joinPath(prefix, issue.path), message: issue.message });
      }
      return;
    }

    const order = parsed.data;

    const firstIndex = idFirstSeenAt.get(order.id);
    if (firstIndex === undefined) {
      idFirstSeenAt.set(order.id, index);
    } else {
      issues.push({ path: `${prefix}.id`, message: `duplicates the order ID at orders[${firstIndex}]` });
    }

    // The stored phone must already be in +212 E.164 form, because the database constraint checks that exact value.
    const phone = normalizeMoroccanPhone(order.customer.phone);
    if (!phone.ok) {
      issues.push({ path: `${prefix}.customer.phone`, message: phone.problem });
    } else if (phone.e164 !== order.customer.phone) {
      issues.push({
        path: `${prefix}.customer.phone`,
        message: "must already be in +212 E.164 form without spaces or punctuation",
      });
    }

    const itemsSum = order.line_items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    if (itemsSum !== order.subtotal) {
      issues.push({ path: `${prefix}.subtotal`, message: "must equal the sum of quantity × unit_price" });
    }
    if (order.total !== order.subtotal + order.shipping_fee) {
      issues.push({ path: `${prefix}.total`, message: "must equal subtotal + shipping_fee" });
    }

    if (order.status === "new") {
      pipelineCount += 1;
    }
    phones.add(order.customer.phone);
    itemCount += order.line_items.length;
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    rawOrders,
    summary: {
      orderCount: rawOrders.length,
      pipelineCount,
      historicalCount: rawOrders.length - pipelineCount,
      customerCount: phones.size,
      itemCount,
    },
  };
}
