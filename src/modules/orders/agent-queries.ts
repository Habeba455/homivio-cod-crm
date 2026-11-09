import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PIPELINE_STATUSES, SOURCE_STATUSES } from "./domain/status";

/**
 * Agent workspace reads. They run with the caller's session, so RLS already limits rows to assigned orders.
 * Each query also filters by the caller's id, as a second layer. Nothing here is cached.
 */

const customerSchema = z.object({ display_name: z.string(), phone_e164: z.string() });

const assignedRowSchema = z.object({
  id: z.uuid(),
  source_order_id: z.string(),
  pipeline_status: z.enum(PIPELINE_STATUSES),
  shipping_city: z.string(),
  total: z.number(),
  source_created_at: z.string(),
  version: z.number().int(),
  unanswered_attempt_count: z.number().int(),
  customer: customerSchema.nullable(),
});

export type AssignedOrderRow = z.infer<typeof assignedRowSchema>;

export async function listAssignedOrders(agentId: string): Promise<{ ok: true; rows: AssignedOrderRow[] } | { ok: false }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, source_order_id, pipeline_status, shipping_city, total, source_created_at, version, unanswered_attempt_count, " +
        "customer:customers!customer_id(display_name, phone_e164)",
    )
    .eq("assigned_agent_id", agentId)
    .not("pipeline_status", "is", null)
    .order("source_created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("assigned orders failed", error.code);
    return { ok: false };
  }
  const parsed = z.array(assignedRowSchema).safeParse(data);
  if (!parsed.success) {
    console.error("assigned orders rejected: unexpected row shape");
    return { ok: false };
  }
  return { ok: true, rows: parsed.data };
}

const orderDetailSchema = z.object({
  id: z.uuid(),
  source_order_id: z.string(),
  assigned_agent_id: z.uuid().nullable(),
  source_status: z.enum(SOURCE_STATUSES),
  pipeline_status: z.enum(PIPELINE_STATUSES).nullable(),
  shipping_city: z.string(),
  shipping_district: z.string(),
  shipping_address1: z.string(),
  subtotal: z.number(),
  shipping_fee: z.number(),
  total: z.number(),
  source_created_at: z.string(),
  version: z.number().int(),
  unanswered_attempt_count: z.number().int(),
  cancel_reason: z.string().nullable(),
  customer: customerSchema,
});

const itemSchema = z.object({
  line_no: z.number().int(),
  sku: z.string(),
  title: z.string(),
  quantity: z.number().int(),
  unit_price: z.number(),
});

const attemptSchema = z.object({
  id: z.uuid(),
  outcome: z.enum(["answered", "no_answer"]),
  unanswered_attempt_count_after: z.number().int(),
  attempted_at: z.string(),
});

const eventSchema = z.object({
  id: z.uuid(),
  event_type: z.string(),
  from_status: z.enum(PIPELINE_STATUSES).nullable(),
  to_status: z.enum(PIPELINE_STATUSES).nullable(),
  created_at: z.string(),
});

const noteSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  created_at: z.string(),
});

export type AgentOrderDetail = z.infer<typeof orderDetailSchema>;
export type AgentOrderItem = z.infer<typeof itemSchema>;
export type AgentCallAttempt = z.infer<typeof attemptSchema>;
export type AgentOrderEvent = z.infer<typeof eventSchema>;
export type AgentOrderNote = z.infer<typeof noteSchema>;

export type AgentOrderView =
  | {
      status: "ok";
      order: AgentOrderDetail;
      items: AgentOrderItem[];
      attempts: AgentCallAttempt[];
      events: AgentOrderEvent[];
      notes: AgentOrderNote[];
    }
  | { status: "not_found" }
  | { status: "error" };

/** Loads one order and its history for the agent screen. Missing or invisible orders return not_found. */
export async function getAgentOrderView(orderId: string): Promise<AgentOrderView> {
  const supabase = await createSupabaseServerClient();

  const orderResult = await supabase
    .from("orders")
    .select(
      "id, source_order_id, assigned_agent_id, source_status, pipeline_status, shipping_city, shipping_district, " +
        "shipping_address1, subtotal, shipping_fee, total, source_created_at, version, unanswered_attempt_count, " +
        "cancel_reason, customer:customers!customer_id(display_name, phone_e164)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderResult.error) {
    console.error("order detail failed", orderResult.error.code);
    return { status: "error" };
  }
  if (orderResult.data === null) {
    return { status: "not_found" };
  }
  const orderParsed = orderDetailSchema.safeParse(orderResult.data);
  if (!orderParsed.success) {
    console.error("order detail rejected: unexpected row shape");
    return { status: "error" };
  }

  const [items, attempts, events, notes] = await Promise.all([
    supabase.from("order_items").select("line_no, sku, title, quantity, unit_price").eq("order_id", orderId).order("line_no"),
    supabase
      .from("call_attempts")
      .select("id, outcome, unanswered_attempt_count_after, attempted_at")
      .eq("order_id", orderId)
      .order("attempted_at", { ascending: false }),
    supabase
      .from("order_events")
      .select("id, event_type, from_status, to_status, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("order_notes").select("id, body, created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(100),
  ]);

  const failed = [items, attempts, events, notes].find((result) => result.error !== null);
  if (failed !== undefined) {
    console.error("order history failed", failed.error?.code);
    return { status: "error" };
  }

  const itemRows = z.array(itemSchema).safeParse(items.data);
  const attemptRows = z.array(attemptSchema).safeParse(attempts.data);
  const eventRows = z.array(eventSchema).safeParse(events.data);
  const noteRows = z.array(noteSchema).safeParse(notes.data);
  if (!itemRows.success || !attemptRows.success || !eventRows.success || !noteRows.success) {
    console.error("order history rejected: unexpected row shape");
    return { status: "error" };
  }

  return {
    status: "ok",
    order: orderParsed.data,
    items: itemRows.data,
    attempts: attemptRows.data,
    events: eventRows.data,
    notes: noteRows.data,
  };
}

const repeatSummarySchema = z.array(
  z.object({ prior_refused_count: z.number().int(), prior_cancelled_count: z.number().int() }),
);

/**
 * Counts of earlier refused and cancelled orders for the same phone.
 * Returns null when the check fails, so the UI never shows a false zero.
 */
export async function getRepeatCustomerCounts(orderId: string): Promise<{ refused: number; cancelled: number } | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("repeat_customer_summary", { p_order_id: orderId });
  if (error) {
    console.error("repeat customer check failed", error.code);
    return null;
  }
  const parsed = repeatSummarySchema.safeParse(data);
  if (!parsed.success) return null;
  const first = parsed.data[0];
  return first === undefined ? null : { refused: first.prior_refused_count, cancelled: first.prior_cancelled_count };
}
