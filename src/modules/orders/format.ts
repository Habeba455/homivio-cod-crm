/** Display helpers for order values. Pure, so they run the same on the server and in tests. */

export function formatMad(amount: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)} MAD`;
}

/** Shown in Morocco time, because all order dates are for Moroccan operations. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(new Date(iso));
}

const EVENT_LABELS: Record<string, string> = {
  imported: "Imported from the source file",
  call_answered: "Customer answered",
  call_no_answer: "No answer",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  auto_cancelled: "Cancelled automatically after three unanswered calls",
  assigned: "Assigned to an agent",
  reassigned: "Reassigned to another agent",
};

/** Human label for an audit event. Unknown types are shown neutrally rather than hidden. */
export function describeEvent(eventType: string): string {
  return EVENT_LABELS[eventType] ?? "Order updated";
}

export const CANCEL_REASON_LABELS: Record<string, string> = {
  refused: "Refused",
  requested_by_customer: "Requested by customer",
  other: "Other",
  three_unanswered_attempts: "Three unanswered attempts",
};
