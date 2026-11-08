import type { CancelReason, PipelineStatus, SourceStatus } from "../../orders/domain/status";
import { normalizeMoroccanPhone } from "./phone";

/**
 * The only fields the repeat-customer rule reads from an order.
 * Name, city and address are deliberately absent: they never take part in matching.
 */
export type OrderSnapshot = {
  id: string;
  phone: string;
  createdAt: string;
  sourceStatus: SourceStatus;
  pipelineStatus: PipelineStatus | null;
  cancelReason: CancelReason | null;
};

export type PriorOutcome = "refused" | "cancelled" | "delivered";

/** Classifies one order as history. Returns null for orders that carry no history signal. */
export function priorOutcome(order: OrderSnapshot): PriorOutcome | null {
  if (order.sourceStatus === "refused") return "refused";
  if (order.sourceStatus === "cancelled") return "cancelled";
  if (order.pipelineStatus === "Cancelled") {
    return order.cancelReason === "refused" ? "refused" : "cancelled";
  }
  if (order.sourceStatus === "delivered") return "delivered";
  return null;
}

export type RepeatCustomerAssessment =
  | { ok: true; warn: boolean; refused: number; cancelled: number; delivered: number }
  | { ok: false; orderId: string; problem: string };

/**
 * Repeat-customer rule (architecture §8.7).
 * - Matches on normalised phone only. Name, city and address are never compared.
 * - Counts only orders created strictly before the current order, and never the current order itself.
 * - Warns only for refused or cancelled history. Delivered history is neutral.
 * - Fails loudly when a phone cannot be normalised, rather than skipping data silently.
 */
export function assessRepeatCustomer(
  current: OrderSnapshot,
  history: readonly OrderSnapshot[],
): RepeatCustomerAssessment {
  const currentPhone = normalizeMoroccanPhone(current.phone);
  if (!currentPhone.ok) {
    return { ok: false, orderId: current.id, problem: currentPhone.problem };
  }
  const currentTime = Date.parse(current.createdAt);
  if (Number.isNaN(currentTime)) {
    return { ok: false, orderId: current.id, problem: "has an invalid createdAt" };
  }

  let refused = 0;
  let cancelled = 0;
  let delivered = 0;

  for (const prior of history) {
    if (prior.id === current.id) continue;

    const priorPhone = normalizeMoroccanPhone(prior.phone);
    if (!priorPhone.ok) {
      return { ok: false, orderId: prior.id, problem: priorPhone.problem };
    }
    if (priorPhone.e164 !== currentPhone.e164) continue;

    const priorTime = Date.parse(prior.createdAt);
    if (Number.isNaN(priorTime)) {
      return { ok: false, orderId: prior.id, problem: "has an invalid createdAt" };
    }
    if (priorTime >= currentTime) continue;

    switch (priorOutcome(prior)) {
      case "refused":
        refused += 1;
        break;
      case "cancelled":
        cancelled += 1;
        break;
      case "delivered":
        delivered += 1;
        break;
      case null:
        break;
    }
  }

  return { ok: true, warn: refused + cancelled > 0, refused, cancelled, delivered };
}
