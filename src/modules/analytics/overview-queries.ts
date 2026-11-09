import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { ReportRange } from "./domain/date-range";
import type { TerminalEvent } from "./domain/daily";

/**
 * Overview reads. They run with the admin's session, so RLS applies. Nothing here is cached.
 * Terminal events are read once for the whole period, in pages, and every chart and table is built from that list.
 * This avoids one query per day or per agent.
 */

/** Above this many terminal events in one period, the Overview asks for a narrower period instead of loading them all. */
export const OVERVIEW_EVENT_LIMIT = 20000;

const PAGE_SIZE = 1000;
const TERMINAL_TYPES = ["confirmed", "cancelled", "auto_cancelled"] as const;

const eventRowSchema = z.object({
  created_at: z.string(),
  event_type: z.enum(TERMINAL_TYPES),
  actor_id: z.uuid().nullable(),
});

export type TerminalEventsResult =
  | { ok: true; events: TerminalEvent[] }
  | { ok: false; reason: "too_many"; total: number }
  | { ok: false; reason: "failed" };

export async function loadTerminalEvents(range: ReportRange): Promise<TerminalEventsResult> {
  const supabase = await createSupabaseServerClient();

  const counted = () => {
    let query = supabase
      .from("order_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", [...TERMINAL_TYPES]);
    if (range.startUtc !== null) query = query.gte("created_at", range.startUtc);
    if (range.endUtc !== null) query = query.lt("created_at", range.endUtc);
    return query;
  };

  const head = await counted();
  if (head.error !== null || head.count === null) {
    console.error("terminal event count failed", head.error?.code);
    return { ok: false, reason: "failed" };
  }
  const total = head.count;
  if (total > OVERVIEW_EVENT_LIMIT) {
    return { ok: false, reason: "too_many", total };
  }

  const pageQuery = () => {
    let query = supabase
      .from("order_events")
      .select("created_at, event_type, actor_id")
      .in("event_type", [...TERMINAL_TYPES]);
    if (range.startUtc !== null) query = query.gte("created_at", range.startUtc);
    if (range.endUtc !== null) query = query.lt("created_at", range.endUtc);
    return query.order("created_at", { ascending: true }).order("id", { ascending: true });
  };

  const events: TerminalEvent[] = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const page = await pageQuery().range(offset, offset + PAGE_SIZE - 1);
    if (page.error !== null || page.data === null) {
      console.error("terminal event page failed", page.error?.code);
      return { ok: false, reason: "failed" };
    }
    const parsed = z.array(eventRowSchema).safeParse(page.data);
    if (!parsed.success) {
      console.error("terminal event page rejected: unexpected row shape");
      return { ok: false, reason: "failed" };
    }
    for (const row of parsed.data) {
      events.push({ createdAt: row.created_at, eventType: row.event_type, actorId: row.actor_id });
    }
    if (parsed.data.length === 0) break;
  }
  return { ok: true, events };
}

export type AttentionCounts = {
  /** Pipeline orders with no agent yet. Distribution lists exactly these. */
  unassignedNew: number;
  /** Active pipeline orders with two unanswered attempts. Rescue Queue ranks these. */
  twoUnanswered: number;
};

/** Current queue counts. These are not limited to the selected period. */
export async function loadAttentionCounts(): Promise<AttentionCounts | null> {
  const supabase = await createSupabaseServerClient();
  const orders = () => supabase.from("orders").select("id", { count: "exact", head: true });

  const [unassigned, twoUnanswered] = await Promise.all([
    orders().eq("pipeline_status", "New").is("assigned_agent_id", null),
    orders().in("pipeline_status", ["New", "No Answer", "Called"]).eq("unanswered_attempt_count", 2),
  ]);

  if (unassigned.error !== null || twoUnanswered.error !== null || unassigned.count === null || twoUnanswered.count === null) {
    console.error("attention count failed", unassigned.error?.code ?? twoUnanswered.error?.code);
    return null;
  }
  return { unassignedNew: unassigned.count, twoUnanswered: twoUnanswered.count };
}
