import { formatDateTime } from "@/modules/orders/format";
import type { RescueRow } from "@/modules/rescue/domain/queue";

import type { RescueBoardItem } from "./rescue-board";
import { ACTION_LABELS } from "./rescue-ui";

/** Maps a server-side queue row to plain props for the client boards. Runs on the server only. */
export function toBoardItem(row: RescueRow): RescueBoardItem {
  const a = row.assessment;
  return {
    id: a.orderId,
    ref: a.orderRef,
    customer: row.customerName ?? "—",
    city: row.shippingCity,
    agent: row.agentName ?? "Unassigned",
    level: a.level,
    score: a.score,
    action: ACTION_LABELS[a.action],
    status: a.status,
    reasons: a.reasons.map((reason) => ({ code: reason.code, text: reason.text, points: reason.points })),
    last: a.lastAttemptAt === null ? "Never" : formatDateTime(a.lastAttemptAt),
  };
}
