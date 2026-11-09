import { isTerminal, type PipelineStatus } from "./domain/status";
import { transitionOrder, type OrderEvent } from "./domain/transitions";

/**
 * Which workflow buttons to show. This is a display decision only. The RPCs enforce the same rules on the server,
 * and both use the same state machine (transitions.ts), which is checked against the SQL copy.
 */
export type OrderActionAvailability = {
  /** Historical source order, outside the pipeline. */
  historical: boolean;
  answer: boolean;
  noAnswer: boolean;
  confirm: boolean;
  cancel: boolean;
  /** Assignment is allowed for active pipeline orders that are not finished. */
  assign: boolean;
};

export function orderActions(status: PipelineStatus | null, unansweredAttemptCount: number): OrderActionAvailability {
  const input = { status, unansweredAttemptCount };
  const allowed = (event: OrderEvent): boolean => transitionOrder(input, event).ok;

  return {
    historical: status === null,
    answer: allowed({ type: "call_answered" }),
    noAnswer: allowed({ type: "call_no_answer" }),
    confirm: allowed({ type: "confirm" }),
    cancel: allowed({ type: "cancel", reason: "other" }),
    assign: status !== null && !isTerminal(status),
  };
}
