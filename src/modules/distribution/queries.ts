import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PIPELINE_STATUSES } from "../orders/domain/status";

import { MAX_BATCH_ORDERS, type OrderSnapshot } from "./domain/distribution";

/**
 * Reads for the Distribution Center. Each runs with the admin's session, so RLS applies.
 * The server action rechecks every order before it plans anything.
 */

const ID_CHUNK_SIZE = 100;
const PAGE_SIZE = 1000;
const ACTIVE_STATUSES = ["New", "No Answer", "Called"] as const;

export type CandidateRow = {
  id: string;
  orderRef: string;
  city: string;
  createdAt: string;
  total: number;
  customerName: string | null;
};

const candidateSchema = z.object({
  id: z.uuid(),
  source_order_id: z.string(),
  shipping_city: z.string(),
  source_created_at: z.string(),
  total: z.number(),
  customer: z.object({ display_name: z.string() }).nullable(),
});

const snapshotSchema = z.object({
  id: z.uuid(),
  source_order_id: z.string(),
  pipeline_status: z.enum(PIPELINE_STATUSES).nullable(),
  assigned_agent_id: z.uuid().nullable(),
  version: z.number().int(),
  source_created_at: z.string(),
  customer: z.object({ display_name: z.string() }).nullable(),
});

/** Unassigned new orders, oldest first. Capped at MAX_BATCH_ORDERS. `total` is the full count. */
export async function loadDistributionCandidates(): Promise<
  { ok: true; rows: CandidateRow[]; total: number; truncated: boolean } | { ok: false }
> {
  const supabase = await createSupabaseServerClient();
  const countResult = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_status", "New")
    .is("assigned_agent_id", null);
  if (countResult.error) {
    console.error("distribution count failed", countResult.error.code);
    return { ok: false };
  }
  const total = countResult.count ?? 0;
  const target = Math.min(total, MAX_BATCH_ORDERS);

  // PostgREST returns at most 1000 rows per request, so read in pages.
  const rows: CandidateRow[] = [];
  for (let from = 0; from < target; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, target) - 1;
    const page = await supabase
      .from("orders")
      .select("id, source_order_id, shipping_city, source_created_at, total, customer:customers!customer_id(display_name)")
      .eq("pipeline_status", "New")
      .is("assigned_agent_id", null)
      .order("source_created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (page.error) {
      console.error("distribution page failed", page.error.code);
      return { ok: false };
    }
    const parsed = z.array(candidateSchema).safeParse(page.data);
    if (!parsed.success) {
      console.error("distribution rows rejected: unexpected row shape");
      return { ok: false };
    }
    for (const row of parsed.data) {
      rows.push({
        id: row.id,
        orderRef: row.source_order_id,
        city: row.shipping_city,
        createdAt: row.source_created_at,
        total: row.total,
        customerName: row.customer?.display_name ?? null,
      });
    }
  }

  return { ok: true, rows, total, truncated: total > MAX_BATCH_ORDERS };
}

/** Current state of the given orders, keyed by order id. Missing ids are simply absent from the map. */
export async function loadOrderSnapshots(
  ids: readonly string[],
): Promise<{ ok: true; byId: Map<string, OrderSnapshot> } | { ok: false }> {
  const supabase = await createSupabaseServerClient();
  const byId = new Map<string, OrderSnapshot>();
  for (let start = 0; start < ids.length; start += ID_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + ID_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("orders")
      .select("id, source_order_id, pipeline_status, assigned_agent_id, version, source_created_at, customer:customers!customer_id(display_name)")
      .in("id", chunk);
    if (error) {
      console.error("distribution snapshot failed", error.code);
      return { ok: false };
    }
    const parsed = z.array(snapshotSchema).safeParse(data);
    if (!parsed.success) {
      console.error("distribution snapshot rejected: unexpected row shape");
      return { ok: false };
    }
    for (const row of parsed.data) {
      byId.set(row.id, {
        orderId: row.id,
        orderRef: row.source_order_id,
        pipelineStatus: row.pipeline_status,
        assignedAgentId: row.assigned_agent_id,
        version: row.version,
        createdAt: row.source_created_at,
        customerName: row.customer?.display_name ?? null,
      });
    }
  }
  return { ok: true, byId };
}

/** Active pipeline orders per agent: each agent's current workload. One small count query per agent. */
export async function loadAgentWorkloads(agentIds: readonly string[]): Promise<Map<string, number> | null> {
  const supabase = await createSupabaseServerClient();
  const results = await Promise.all(
    agentIds.map((agentId) =>
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("assigned_agent_id", agentId)
        .in("pipeline_status", [...ACTIVE_STATUSES]),
    ),
  );
  const loads = new Map<string, number>();
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const agentId = agentIds[i];
    if (result === undefined || agentId === undefined) return null;
    if (result.error) {
      console.error("workload count failed", result.error.code);
      return null;
    }
    loads.set(agentId, result.count ?? 0);
  }
  return loads;
}
