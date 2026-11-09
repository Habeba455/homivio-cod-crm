/**
 * Confirmation-rate arithmetic (architecture §14, item 4). Pure, so it is unit tested.
 *
 * Definition: confirmed ÷ (confirmed + cancelled). The denominator counts only pipeline orders whose terminal change
 * falls in the selected date range. Historical source orders never enter either count.
 * When the denominator is zero the rate is null, never 0 or NaN.
 */

export type ConfirmationRate = {
  confirmed: number;
  cancelled: number;
  /** confirmed + cancelled: the denominator. */
  decided: number;
  /** A value from 0 to 1, or null when nothing was decided. */
  rate: number | null;
};

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

export function confirmationRate(confirmed: number, cancelled: number): ConfirmationRate {
  assertCount("confirmed", confirmed);
  assertCount("cancelled", cancelled);
  const decided = confirmed + cancelled;
  return {
    confirmed,
    cancelled,
    decided,
    rate: decided === 0 ? null : confirmed / decided,
  };
}

/** Displays a rate as a percentage with one decimal place. A null rate shows an em dash. */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}
