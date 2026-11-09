/**
 * Current-status counts. Pure, so the active-pipeline rule is tested in one place.
 */

export type SnapshotCounts = {
  /** Every imported order, pipeline and historical. */
  total: number;
  /** Historical source orders (delivered, refused, cancelled) with no pipeline status. */
  historical: number;
  New: number;
  "No Answer": number;
  Called: number;
  Confirmed: number;
  Cancelled: number;
};

/** Active pipeline: orders still being worked. Confirmed and Cancelled are terminal. Historical orders are excluded. */
export function activePipelineCount(counts: Pick<SnapshotCounts, "New" | "No Answer" | "Called">): number {
  return counts.New + counts["No Answer"] + counts.Called;
}

/** Pipeline total must equal the sum of its statuses, and historical plus pipeline must equal the total. */
export function snapshotIsConsistent(counts: SnapshotCounts): boolean {
  const pipeline = activePipelineCount(counts) + counts.Confirmed + counts.Cancelled;
  return counts.historical + pipeline === counts.total;
}
