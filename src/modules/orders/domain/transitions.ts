import { shouldAutoCancel, unansweredCountAfter } from "../../call-attempts/domain/auto-cancel";
import { isTerminal, type AgentCancelReason, type CancelReason, type PipelineStatus } from "./status";

/**
 * Events that change or record the outcome of an order. Assignment is a permission
 * check handled by the application layer, not a status change, so it is not modelled here.
 */
export type OrderEvent =
  | { type: "call_answered" }
  | { type: "call_no_answer" }
  | { type: "confirm" }
  | { type: "cancel"; reason: AgentCancelReason };

export type TransitionInput = {
  /** null for historical source orders, which sit outside the pipeline. */
  status: PipelineStatus | null;
  /** Total unanswered attempts recorded for the order so far. */
  unansweredAttemptCount: number;
};

export type TransitionError = "not_in_pipeline" | "invalid_transition";

export type TransitionOutcome =
  | {
      ok: true;
      nextStatus: PipelineStatus;
      unansweredAttemptCount: number;
      cancelReason: CancelReason | null;
      autoCancelled: boolean;
    }
  | { ok: false; error: TransitionError };

/**
 * Order state machine (architecture §9). Pure and deterministic: it returns the next state
 * or a rejection, and never mutates its input. The SQL state function is the authoritative
 * copy; this module mirrors it, and both are checked against the same cases.
 */
export function transitionOrder(input: TransitionInput, event: OrderEvent): TransitionOutcome {
  const { status, unansweredAttemptCount } = input;

  if (status === null) return reject("not_in_pipeline");
  if (isTerminal(status)) return reject("invalid_transition");

  switch (event.type) {
    case "call_answered":
      // Reaching the customer moves New or No Answer to Called. A later answered call leaves Called unchanged.
      return accept("Called", unansweredAttemptCount, null);

    case "call_no_answer": {
      const count = unansweredCountAfter(unansweredAttemptCount);
      if (shouldAutoCancel(count)) {
        return accept("Cancelled", count, "three_unanswered_attempts", true);
      }
      // An unanswered call keeps a Called order in Called.
      return accept(status === "Called" ? "Called" : "No Answer", count, null);
    }

    case "confirm":
      return status === "Called"
        ? accept("Confirmed", unansweredAttemptCount, null)
        : reject("invalid_transition");

    case "cancel":
      return accept("Cancelled", unansweredAttemptCount, event.reason);
  }
}

function accept(
  nextStatus: PipelineStatus,
  unansweredAttemptCount: number,
  cancelReason: CancelReason | null,
  autoCancelled = false,
): TransitionOutcome {
  return { ok: true, nextStatus, unansweredAttemptCount, cancelReason, autoCancelled };
}

function reject(error: TransitionError): TransitionOutcome {
  return { ok: false, error };
}
