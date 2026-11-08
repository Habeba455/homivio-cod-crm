/**
 * Automatic cancellation policy (architecture §9.3, rule 4).
 * The threshold counts total unanswered attempts over an order's life, not consecutive ones.
 */

export const UNANSWERED_ATTEMPT_LIMIT = 3;

/** Returns the unanswered-attempt count after one more unanswered call. Throws on an invalid count. */
export function unansweredCountAfter(current: number): number {
  if (!Number.isInteger(current) || current < 0) {
    throw new RangeError("unansweredAttemptCount must be a non-negative integer");
  }
  return current + 1;
}

export function shouldAutoCancel(unansweredCount: number): boolean {
  return unansweredCount >= UNANSWERED_ATTEMPT_LIMIT;
}
