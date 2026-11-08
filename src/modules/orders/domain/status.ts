/**
 * Order status vocabulary (architecture §8.2 and §9.1). Pure constants and types.
 */

/** Statuses of the confirmation pipeline. */
export const PIPELINE_STATUSES = ["New", "No Answer", "Called", "Confirmed", "Cancelled"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Status values kept verbatim from sample_orders.json. */
export const SOURCE_STATUSES = ["new", "delivered", "refused", "cancelled"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Reasons an agent can record when cancelling an order. */
export const AGENT_CANCEL_REASONS = ["refused", "requested_by_customer", "other"] as const;
export type AgentCancelReason = (typeof AGENT_CANCEL_REASONS)[number];

/** Why an order was cancelled: chosen by an agent, or set automatically after three unanswered attempts. */
export type CancelReason = AgentCancelReason | "three_unanswered_attempts";

const TERMINAL_STATUSES: ReadonlySet<PipelineStatus> = new Set<PipelineStatus>(["Confirmed", "Cancelled"]);

export function isTerminal(status: PipelineStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Pipeline status given to an order at import. Only "new" orders enter the confirmation pipeline.
 * Historical outcomes map to null, and are never treated as confirmations (architecture §8.2).
 */
export function pipelineStatusFromSource(source: SourceStatus): PipelineStatus | null {
  return source === "new" ? "New" : null;
}
