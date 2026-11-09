import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { ReportRange } from "./domain/date-range";
import type { SnapshotCounts } from "./domain/snapshot";

/**
 * Analytics reads. Each query runs with the Admin's session, so RLS applies. The page also requires the admin area.
 * Counts use exact `count` queries, not row fetches, so PostgREST row limits cannot truncate the results.
 * Nothing here is cached: the figures depend on the viewer and on current data.
 */

export async function loadSnapshotCounts(): Promise<SnapshotCounts | null> {
  const supabase = await createSupabaseServerClient();
  const orders = () => supabase.from("orders").select("id", { count: "exact", head: true });

  const results = await Promise.all([
    orders(),
    orders().is("pipeline_status", null),
    orders().eq("pipeline_status", "New"),
    orders().eq("pipeline_status", "No Answer"),
    orders().eq("pipeline_status", "Called"),
    orders().eq("pipeline_status", "Confirmed"),
    orders().eq("pipeline_status", "Cancelled"),
  ]);

  const failed = results.find((result) => result.error !== null || result.count === null);
  if (failed !== undefined) {
    console.error("snapshot count failed", failed.error?.code);
    return null;
  }
  const [total, historical, nw, noAnswer, called, confirmed, cancelled] = results.map((result) => result.count ?? 0);
  return {
    total,
    historical,
    New: nw,
    "No Answer": noAnswer,
    Called: called,
    Confirmed: confirmed,
    Cancelled: cancelled,
  };
}

export type TerminalCounts = { confirmed: number; cancelled: number };

/**
 * Terminal changes recorded in the range, from the audit log. Each order can reach a terminal state once,
 * so counting events counts orders. An auto-cancel is a cancellation. The actor filter gives per-agent attribution.
 */
export async function loadTerminalCounts(range: ReportRange, actorId: string | null): Promise<TerminalCounts | null> {
  const supabase = await createSupabaseServerClient();

  const scoped = () => {
    let query = supabase.from("order_events").select("id", { count: "exact", head: true });
    if (range.startUtc !== null) query = query.gte("created_at", range.startUtc);
    if (range.endUtc !== null) query = query.lt("created_at", range.endUtc);
    if (actorId !== null) query = query.eq("actor_id", actorId);
    return query;
  };

  const [confirmed, cancelled] = await Promise.all([
    scoped().eq("event_type", "confirmed"),
    scoped().in("event_type", ["cancelled", "auto_cancelled"]),
  ]);

  if (confirmed.error !== null || cancelled.error !== null || confirmed.count === null || cancelled.count === null) {
    console.error("terminal count failed", confirmed.error?.code ?? cancelled.error?.code);
    return null;
  }
  return { confirmed: confirmed.count, cancelled: cancelled.count };
}

export type AgentProfile = { id: string; displayName: string; isActive: boolean };

const agentProfileSchema = z.object({ id: z.uuid(), display_name: z.string(), is_active: z.boolean() });

/** Every agent account, active or not, so past work by a deactivated agent stays visible in the report. */
export async function listAgentProfiles(): Promise<AgentProfile[] | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, is_active")
    .eq("role", "agent")
    .order("display_name", { ascending: true });
  if (error) {
    console.error("agent profile list failed", error.code);
    return null;
  }
  const parsed = z.array(agentProfileSchema).safeParse(data);
  if (!parsed.success) {
    console.error("agent profile list rejected: unexpected row shape");
    return null;
  }
  return parsed.data.map((agent) => ({ id: agent.id, displayName: agent.display_name, isActive: agent.is_active }));
}
