import type { PipelineStatus } from "../../orders/domain/status";

import { elapsedHours, isWithinCallingWindow } from "./time";

/**
 * Smart COD Rescue Center: deterministic, explainable prioritisation.
 *
 * These are business rules, not a prediction. Every point comes from a visible reason, and no model is involved.
 * Only active pipeline orders are scored. Historical and finished orders are reported as ineligible.
 */

export type PriorityLevel = "urgent" | "high" | "normal" | "low";

export type RecommendedAction =
  | "call_last_chance"
  | "confirm_or_cancel"
  | "first_call"
  | "retry_call"
  | "follow_up_call"
  | "review";

export type ReasonCode =
  | "auto_cancel_next"
  | "one_unanswered"
  | "never_contacted"
  | "waiting_first_contact"
  | "waiting_long"
  | "stale_contact"
  | "customer_answered"
  | "customer_history"
  | "history_unavailable"
  | "outside_calling_hours"
  | "data_issue";

export type Reason = { code: ReasonCode; text: string; points: number };

/** Everything the rules read. Built from persisted data only, never from client input. */
export type OrderSignals = {
  orderId: string;
  orderRef: string;
  /** null for historical source orders. */
  status: PipelineStatus | null;
  unansweredAttemptCount: number;
  /** source_created_at, ISO 8601. */
  createdAt: string;
  /** Time of the most recent call attempt, or null when the order was never called. */
  lastAttemptAt: string | null;
  /** Earlier refused and cancelled orders for the same customer. Null means the history could not be read. */
  history: { refused: number; cancelled: number } | null;
  assignedAgentId: string | null;
};

export type EligibleAssessment = {
  eligible: true;
  orderId: string;
  orderRef: string;
  assignedAgentId: string | null;
  status: PipelineStatus;
  level: PriorityLevel;
  score: number;
  reasons: Reason[];
  action: RecommendedAction;
  unansweredAttemptCount: number;
  lastAttemptAt: string | null;
  /** Creation time in milliseconds. Invalid dates sort last. */
  createdAtMs: number;
  hasDataIssue: boolean;
};

export type IneligibleAssessment = {
  eligible: false;
  orderId: string;
  orderRef: string;
  reason: "historical" | "finished";
};

export type Assessment = EligibleAssessment | IneligibleAssessment;

/** Points per signal. Exported so the rules are documented and tested from one place. */
export const PRIORITY_POINTS = {
  autoCancelNext: 70,
  oneUnanswered: 20,
  neverContacted: 30,
  waitingFirstContact: 20,
  waitingLong: 15,
  staleContact: 10,
  customerAnswered: 25,
  customerHistory: 15,
} as const;

export const WAITING_HOURS = 24;
export const WAITING_LONG_HOURS = 72;
export const STALE_CONTACT_HOURS = 24;

/** Score thresholds for each level. */
export const LEVEL_THRESHOLDS = { urgent: 70, high: 40, normal: 20 } as const;

function levelFor(score: number): PriorityLevel {
  if (score >= LEVEL_THRESHOLDS.urgent) return "urgent";
  if (score >= LEVEL_THRESHOLDS.high) return "high";
  if (score >= LEVEL_THRESHOLDS.normal) return "normal";
  return "low";
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function chooseAction(
  status: PipelineStatus,
  unanswered: number,
  neverContacted: boolean,
  hoursSinceLast: number | null,
): RecommendedAction {
  if (unanswered === 2) return "call_last_chance";
  if (status === "Called") return "confirm_or_cancel";
  if (neverContacted) return "first_call";
  if (unanswered === 1) return "retry_call";
  if (hoursSinceLast !== null && hoursSinceLast >= STALE_CONTACT_HOURS) return "follow_up_call";
  return "review";
}

const CALL_ACTIONS: ReadonlySet<RecommendedAction> = new Set<RecommendedAction>([
  "call_last_chance",
  "first_call",
  "retry_call",
  "follow_up_call",
]);

/**
 * Assesses one order. The reasons, score, level and action all come from the same signals.
 * `now` is passed in, so the result is deterministic and testable.
 */
export function assessOrder(signals: OrderSignals, now: Date): Assessment {
  if (signals.status === null) {
    return { eligible: false, orderId: signals.orderId, orderRef: signals.orderRef, reason: "historical" };
  }
  if (signals.status === "Confirmed" || signals.status === "Cancelled") {
    return { eligible: false, orderId: signals.orderId, orderRef: signals.orderRef, reason: "finished" };
  }
  const status = signals.status;

  const reasons: Reason[] = [];
  let score = 0;
  const add = (code: ReasonCode, text: string, points: number) => {
    reasons.push({ code, text, points });
    score += points;
  };
  const note = (code: ReasonCode, text: string) => reasons.push({ code, text, points: 0 });

  // Missing or inconsistent data is reported, not guessed. Each check below marks the order for review.
  const createdMs = Date.parse(signals.createdAt);
  const createdValid = !Number.isNaN(createdMs);
  const lastMs = signals.lastAttemptAt === null ? null : Date.parse(signals.lastAttemptAt);
  const lastValid = lastMs === null || !Number.isNaN(lastMs);
  const rawUnanswered = signals.unansweredAttemptCount;
  const countValid = Number.isSafeInteger(rawUnanswered) && rawUnanswered >= 0;
  const unanswered = countValid ? rawUnanswered : 0;

  const dataIssue =
    !createdValid ||
    !lastValid ||
    !countValid ||
    (unanswered >= 3) ||
    (status === "New" && unanswered > 0) ||
    (unanswered > 0 && signals.lastAttemptAt === null);

  const nowMs = now.getTime();
  const hoursSinceCreated = createdValid ? elapsedHours(createdMs, nowMs) : 0;
  const hoursSinceLast = lastMs !== null && !Number.isNaN(lastMs) ? elapsedHours(lastMs, nowMs) : null;
  const neverContacted = status === "New" && unanswered === 0 && signals.lastAttemptAt === null;

  // Automatic cancellation risk (architecture §9: cancel after three unanswered calls).
  if (unanswered === 2) {
    add("auto_cancel_next", "Two unanswered calls. One more unanswered call cancels this order automatically.", PRIORITY_POINTS.autoCancelNext);
  } else if (unanswered === 1) {
    add("one_unanswered", "One unanswered call so far.", PRIORITY_POINTS.oneUnanswered);
  }

  // Never contacted, and how long it has waited.
  if (neverContacted) {
    add("never_contacted", "Not contacted yet.", PRIORITY_POINTS.neverContacted);
    if (hoursSinceCreated >= WAITING_HOURS) {
      add(
        "waiting_first_contact",
        `Waiting ${Math.floor(hoursSinceCreated)} ${plural(Math.floor(hoursSinceCreated), "hour", "hours")} for first contact.`,
        PRIORITY_POINTS.waitingFirstContact,
      );
    }
    if (hoursSinceCreated >= WAITING_LONG_HOURS) {
      add("waiting_long", "Waiting more than 3 days for first contact.", PRIORITY_POINTS.waitingLong);
    }
  }

  // Time since the last attempt, for orders still waiting on the customer.
  if (status !== "Called" && hoursSinceLast !== null && hoursSinceLast >= STALE_CONTACT_HOURS) {
    add(
      "stale_contact",
      `No call attempt for ${Math.floor(hoursSinceLast)} ${plural(Math.floor(hoursSinceLast), "hour", "hours")}.`,
      PRIORITY_POINTS.staleContact,
    );
  }

  if (status === "Called") {
    add("customer_answered", "Customer answered. Confirm the order or cancel it.", PRIORITY_POINTS.customerAnswered);
  }

  // Customer history. Counts only, from the batched, authorised history read.
  if (signals.history === null) {
    note("history_unavailable", "Customer history is unavailable right now.");
  } else {
    const { refused, cancelled } = signals.history;
    if (refused + cancelled > 0) {
      add(
        "customer_history",
        `Earlier orders for this customer: ${refused} refused, ${cancelled} cancelled. Check the details before calling.`,
        PRIORITY_POINTS.customerHistory,
      );
    }
  }

  const action = chooseAction(status, unanswered, neverContacted, hoursSinceLast);

  if (CALL_ACTIONS.has(action) && !isWithinCallingWindow(now)) {
    note("outside_calling_hours", "Outside typical calling hours (09:00 to 20:00, Casablanca). Consider calling later.");
  }
  if (dataIssue) {
    note("data_issue", "Some order data is incomplete. Check the order before acting.");
  }

  return {
    eligible: true,
    orderId: signals.orderId,
    orderRef: signals.orderRef,
    assignedAgentId: signals.assignedAgentId,
    status,
    level: levelFor(score),
    score,
    reasons,
    action,
    unansweredAttemptCount: unanswered,
    lastAttemptAt: signals.lastAttemptAt,
    createdAtMs: createdValid ? createdMs : Number.MAX_SAFE_INTEGER,
    hasDataIssue: dataIssue,
  };
}

/** Queue order: higher score first, then more unanswered calls, then older orders, then order reference. */
export function compareForQueue(a: EligibleAssessment, b: EligibleAssessment): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.unansweredAttemptCount !== b.unansweredAttemptCount) return b.unansweredAttemptCount - a.unansweredAttemptCount;
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.orderRef < b.orderRef ? -1 : a.orderRef > b.orderRef ? 1 : 0;
}

/** Eligible assessments in queue order. Ineligible ones are removed, never ranked. */
export function rankQueue(assessments: readonly Assessment[]): EligibleAssessment[] {
  return assessments
    .filter((item): item is EligibleAssessment => item.eligible)
    .sort(compareForQueue);
}

/** Keeps only the signals for orders assigned to the viewer. Used for agent queues. */
export function scopeToAgent(signals: readonly OrderSignals[], viewerId: string): OrderSignals[] {
  return signals.filter((item) => item.assignedAgentId === viewerId);
}

/** The single order an agent should open next: the top of the ranked queue, or null when nothing is active. */
export function nextRecommended(ranked: readonly EligibleAssessment[]): EligibleAssessment | null {
  return ranked[0] ?? null;
}

export type QueueSummary = {
  active: number;
  /** Urgent or high priority. */
  needsAttention: number;
  /** Two unanswered calls: one more cancels the order. */
  closeToCancel: number;
  /** Assigned, pipeline New, never called. */
  uncontacted: number;
  /** Orders whose data is incomplete and need a manual check. */
  dataIssues: number;
};

export function summarizeQueue(ranked: readonly EligibleAssessment[]): QueueSummary {
  return {
    active: ranked.length,
    needsAttention: ranked.filter((item) => item.level === "urgent" || item.level === "high").length,
    closeToCancel: ranked.filter((item) => item.unansweredAttemptCount === 2).length,
    uncontacted: ranked.filter((item) => item.status === "New" && item.lastAttemptAt === null).length,
    dataIssues: ranked.filter((item) => item.hasDataIssue).length,
  };
}
