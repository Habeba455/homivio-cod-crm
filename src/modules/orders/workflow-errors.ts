/**
 * Maps database error codes (SQLSTATE values raised by the state RPCs, see migration 06) to user messages.
 * Messages never include SQL text, identifiers or customer data.
 */

export type WorkflowErrorView = {
  message: string;
  /** True when the screen should reload the latest order, because the user's view may be stale. */
  refresh: boolean;
};

const MESSAGES: Record<string, WorkflowErrorView> = {
  HV001: { message: "Your session has ended. Sign in again.", refresh: false },
  HV002: { message: "You do not have permission to do that.", refresh: false },
  HV003: { message: "This order was not found, or it is not assigned to you.", refresh: false },
  HV004: {
    message: "Someone else changed this order. The latest version is shown below. Check it and try again.",
    refresh: true,
  },
  HV005: { message: "This order is not in the active pipeline.", refresh: true },
  HV006: { message: "That action is not allowed from the order's current status.", refresh: true },
  HV007: { message: "The request was invalid. Check the details and try again.", refresh: false },
  HV008: { message: "The selected person is not an active agent.", refresh: false },
};

const FALLBACK: WorkflowErrorView = {
  message: "Something went wrong and nothing was changed. Try again.",
  refresh: true,
};

export function describeWorkflowError(code: string | null | undefined): WorkflowErrorView {
  if (code === null || code === undefined) return FALLBACK;
  return MESSAGES[code] ?? FALLBACK;
}

export const INVALID_INPUT_MESSAGE = "The request was invalid. Check the details and try again.";
