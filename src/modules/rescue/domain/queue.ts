import {
  assessOrder,
  rankQueue,
  summarizeQueue,
  type EligibleAssessment,
  type OrderSignals,
  type QueueSummary,
} from "./priority";

/** One active order with the display fields the queue needs. Built on the server from persisted data. */
export type RescueItem = {
  signals: OrderSignals;
  customerName: string | null;
  agentName: string | null;
  shippingCity: string;
};

export type RescueRow = {
  assessment: EligibleAssessment;
  customerName: string | null;
  agentName: string | null;
  shippingCity: string;
};

export type RescueQueue = {
  rows: RescueRow[];
  summary: QueueSummary;
  next: RescueRow | null;
};

/**
 * Ranks the queue. When agentId is given, only that agent's orders are considered, as defence in depth
 * on top of RLS. Pure: `now` is passed in.
 */
export function buildRescueQueue(items: readonly RescueItem[], now: Date, agentId?: string): RescueQueue {
  const scoped = agentId === undefined ? items : items.filter((item) => item.signals.assignedAgentId === agentId);
  const byId = new Map(scoped.map((item) => [item.signals.orderId, item] as const));
  const ranked = rankQueue(scoped.map((item) => assessOrder(item.signals, now)));

  const rows: RescueRow[] = [];
  for (const assessment of ranked) {
    const item = byId.get(assessment.orderId);
    if (item !== undefined) {
      rows.push({
        assessment,
        customerName: item.customerName,
        agentName: item.agentName,
        shippingCity: item.shippingCity,
      });
    }
  }

  return { rows, summary: summarizeQueue(ranked), next: rows[0] ?? null };
}
