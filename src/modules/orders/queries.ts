import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadRawCityNamesForCity } from "@/modules/analytics/city-queries";

import { PIPELINE_STATUSES, SOURCE_STATUSES } from "./domain/status";
import type { OrderListFilters } from "./order-filters";

export const ADMIN_ORDER_LIST_LIMIT = 200;

const adminOrderRowSchema = z.object({
  id: z.uuid(),
  source_order_id: z.string(),
  source_status: z.enum(SOURCE_STATUSES),
  pipeline_status: z.enum(PIPELINE_STATUSES).nullable(),
  assigned_agent_id: z.uuid().nullable(),
  version: z.number().int(),
  shipping_city: z.string(),
  total: z.number(),
  source_created_at: z.string(),
  customer: z.object({ display_name: z.string(), phone_e164: z.string() }).nullable(),
  agent: z.object({ display_name: z.string() }).nullable(),
});

export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export type AdminOrderList = { ok: true; rows: AdminOrderRow[]; truncated: boolean } | { ok: false };

/**
 * Lists orders for an Admin. Runs with the caller's session, so RLS decides what is visible.
 * Not cached: the result depends on the signed-in user and the current data.
 */
export async function listOrdersForAdmin(filters: OrderListFilters): Promise<AdminOrderList> {
  const supabase = await createSupabaseServerClient();

  // Customer name and phone search goes through customers first, then matches orders by customer id.
  let matchingCustomerIds: string[] = [];
  if (filters.q !== "") {
    const { data, error } = await supabase
      .from("customers")
      .select("id")
      .or(`display_name.ilike.%${filters.q}%,phone_e164.ilike.%${filters.q}%`)
      .limit(ADMIN_ORDER_LIST_LIMIT);
    if (error) {
      console.error("customer search failed", error.code);
      return { ok: false };
    }
    matchingCustomerIds = (data ?? []).map((customer) => customer.id);
  }

  let query = supabase
    .from("orders")
    .select(
      "id, source_order_id, source_status, pipeline_status, assigned_agent_id, version, shipping_city, total, source_created_at, " +
        "customer:customers!customer_id(display_name, phone_e164), " +
        "agent:profiles!assigned_agent_id(display_name)",
    )
    .order("source_created_at", { ascending: false })
    .limit(ADMIN_ORDER_LIST_LIMIT + 1);

  if (filters.status !== "all") {
    query = query.eq("source_status", filters.status);
  }

  if (filters.q !== "") {
    const clauses = [`source_order_id.ilike.%${filters.q}%`, `shipping_city.ilike.%${filters.q}%`];
    if (matchingCustomerIds.length > 0) {
      // UUIDs only, so this list cannot inject filter syntax.
      clauses.push(`customer_id.in.(${matchingCustomerIds.join(",")})`);
    }
    query = query.or(clauses.join(","));
  }

  if (filters.city !== "") {
    // Exact match on every raw value the map counts for this city. PostgREST quotes values that contain commas.
    const names = await loadRawCityNamesForCity(filters.city);
    if (names === null) {
      return { ok: false };
    }
    if (names.length === 0) {
      return { ok: true, rows: [], truncated: false };
    }
    query = query.in("shipping_city", names);
  }

  const { data, error } = await query;
  if (error) {
    console.error("order list failed", error.code);
    return { ok: false };
  }

  const parsed = z.array(adminOrderRowSchema).safeParse(data);
  if (!parsed.success) {
    console.error("order list rejected: unexpected row shape");
    return { ok: false };
  }

  return {
    ok: true,
    rows: parsed.data.slice(0, ADMIN_ORDER_LIST_LIMIT),
    truncated: parsed.data.length > ADMIN_ORDER_LIST_LIMIT,
  };
}

export type ActiveAgent = { id: string; displayName: string };

const activeAgentSchema = z.object({ id: z.uuid(), display_name: z.string() });

/** Active agents for the assignment control. Admins may read every profile through RLS. */
export async function listActiveAgents(): Promise<{ ok: true; agents: ActiveAgent[] } | { ok: false }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("role", "agent")
    .eq("is_active", true)
    .order("display_name", { ascending: true });
  if (error) {
    console.error("agent list failed", error.code);
    return { ok: false };
  }
  const parsed = z.array(activeAgentSchema).safeParse(data);
  if (!parsed.success) {
    console.error("agent list rejected: unexpected row shape");
    return { ok: false };
  }
  return {
    ok: true,
    agents: parsed.data.map((agent) => ({ id: agent.id, displayName: agent.display_name })),
  };
}
