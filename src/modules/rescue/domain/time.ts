/**
 * Time helpers for the Rescue Center. Pure, so they are tested with fixed instants.
 *
 * Scoring uses elapsed hours, which do not depend on any time zone.
 * Casablanca time is used only for the non-scoring "outside calling hours" note.
 */

export const CASABLANCA_TIME_ZONE = "Africa/Casablanca";

/** Operational assumption: local hours when calls are normally made, [start, end). Documented in docs/rescue-center.md. */
export const CALLING_WINDOW = { startHour: 9, endHour: 20 } as const;

const MS_PER_HOUR = 3_600_000;

/** Whole hours elapsed since an instant, never negative. Future instants (clock skew) count as zero. */
export function elapsedHours(fromMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - fromMs) / MS_PER_HOUR);
}

/** Hour of day (0 to 23) in Casablanca at the given instant. */
export function casablancaHour(instant: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: CASABLANCA_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(instant)
    .find((item) => item.type === "hour");
  return Number(part?.value ?? NaN);
}

export function isWithinCallingWindow(instant: Date): boolean {
  const hour = casablancaHour(instant);
  return hour >= CALLING_WINDOW.startHour && hour < CALLING_WINDOW.endHour;
}
