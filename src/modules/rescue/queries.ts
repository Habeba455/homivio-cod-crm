import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PIPELINE_STATUSES } from "../orders/domain/status";

import type { OrderSignals } from "./domain/priority";
import type { RescueItem } from "./domain/queue";

/**
 * Batched reads for the Rescue Center. They run with the caller's session, so RLS limits rows.
 * Oldest orders come first, so if the cap is reached, the most overdue orders are kept.
 */
export const RESCUE_ORDER_LIMIT = 500;
const ID_CHUNK_SIZE = 100;
const ATTEMPT_LIMIT_PER_CHUNK = 1000;
const ACTIVE_STATUSES = ["New", "No Answer", "Called"] as const;
const ORDER_SELECT =
  "id, source_order_id, pipeline_status, assigned_agent_id, unanswered_attempt_count, source_created_at, shipping_city, " +
  "customer:customers!customer_id(display_name), agent:profiles!assigned_agent_id(display_name)";

const orderRowSchema = z.object({
  id: z.uuid(),
  source_order_id: z.string(),
  pipeline_status: z.enum(PIPELINE_STATUSES).nullable(),
  assigned_agent_id: z.uuid().nullable(),
  unanswered_attempt_count: z.number().int(),
  source_created_at: z.string(),
  shipping_city: z.string(),
  customer: z.object({ display_name: z.string() }).nullable(),
  agent: z.object({ display_name: z.string() }).nullable(),
});

const attemptRowSchema = z.object({ order_id: z.uuid(), attempted_at: z.string() });

const historyRowSchema = z.object({
  order_id: z.uuid(),
  prior_refused_count: z.number().int(),
  prior_cancelled_count: z.number().int(),
});

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type RescueLoad =
  | {
      ok: true;
      items: RescueItem[];
      /** More active orders exist than RESCUE_ORDER_LIMIT. */
      truncated: boolean;
      /** False when a chunk of call history hit its cap, so some last-attempt times may be missing. */
      attemptsComplete: boolean;
      /** False when the customer-history function is unavailable. History is then unknown, never zero. */
      historyAvailable: boolean;
    }
  | { ok: false };

/** Loads active pipeline orders with batched call history and customer history. Optionally limited to one agent. */
export async function loadRescueItems(options: { agentId?: string } = {}): Promise<RescueLoad> {
  const supabase = await createSupabaseServerClient();

  let orderQuery = supabase
    .from("orders")
    .select(ORDER_SELECT)
    .in("pipeline_status", [...ACTIVE_STATUSES])
    .order("source_created_at", { ascending: true })
    .limit(RESCUE_ORDER_LIMIT + 1);
  if (options.agentId !== undefined) {
    orderQuery = orderQuery.eq("assigned_agent_id", options.agentId);
  }

  const ordersResult = await orderQuery;
  if (ordersResult.error) {
    console.error("rescue orders failed", ordersResult.error.code);
    return { ok: false };
  }
  const parsed = z.array(orderRowSchema).safeParse(ordersResult.data);
  if (!parsed.success) {
    console.error("rescue orders rejected: unexpected row shape");
    return { ok: false };
  }

  const truncated = parsed.data.length > RESCUE_ORDER_LIMIT;
  const orders = parsed.data.slice(0, RESCUE_ORDER_LIMIT);
  if (orders.length === 0) {
    return { ok: true, items: [], truncated: false, attemptsComplete: true, historyAvailable: true };
  }

  const ids = orders.map((order) => order.id);
  const attempts = await loadLastAttempts(supabase, ids);
  if (attempts === null) {
    return { ok: false };
  }
  const historyByOrder = await loadHistory(supabase, ids);

  const items: RescueItem[] = orders.map((order) => {
    const signals: OrderSignals = {
      orderId: order.id,
      orderRef: order.source_order_id,
      status: order.pipeline_status,
      unansweredAttemptCount: order.unanswered_attempt_count,
      createdAt: order.source_created_at,
      lastAttemptAt: attempts.last.get(order.id) ?? null,
      history: historyByOrder?.get(order.id) ?? null,
      assignedAgentId: order.assigned_agent_id,
    };
    return {
      signals,
      customerName: order.customer?.display_name ?? null,
      agentName: order.agent?.display_name ?? null,
      shippingCity: order.shipping_city,
    };
  });

  return {
    ok: true,
    items,
    truncated,
    attemptsComplete: attempts.complete,
    historyAvailable: historyByOrder !== null,
  };
}

/** Latest attempt time per order, read in id chunks to keep request URLs short. */
async function loadLastAttempts(
  supabase: ServerClient,
  ids: string[],
): Promise<{ last: Map<string, string>; complete: boolean } | null> {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(start, start + ID_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((part) =>
      supabase
        .from("call_attempts")
        .select("order_id, attempted_at")
        .in("order_id", part)
        .order("attempted_at", { ascending: false })
        .limit(ATTEMPT_LIMIT_PER_CHUNK),
    ),
  );

  const last = new Map<string, string>();
  let complete = true;
  for (const result of results) {
    if (result.error) {
      console.error("rescue attempts failed", result.error.code);
      return null;
    }
    const parsed = z.array(attemptRowSchema).safeParse(result.data);
    if (!parsed.success) {
      console.error("rescue attempts rejected: unexpected row shape");
      return null;
    }
    if (parsed.data.length >= ATTEMPT_LIMIT_PER_CHUNK) {
      complete = false;
    }
    // Rows are newest first, so the first row seen for each order is its latest attempt.
    for (const attempt of parsed.data) {
      if (!last.has(attempt.order_id)) {
        last.set(attempt.order_id, attempt.attempted_at);
      }
    }
  }
  return { last, complete };
}

/** Batched customer history. Returns null when unavailable, for example before migration i7_01 is applied. */
async function loadHistory(
  supabase: ServerClient,
  ids: string[],
): Promise<Map<string, { refused: number; cancelled: number }> | null> {
  const { data, error } = await supabase.rpc("rescue_repeat_counts", { p_order_ids: ids });
  if (error) {
    console.error("rescue history unavailable", error.code);
    return null;
  }
  const parsed = z.array(historyRowSchema).safeParse(data);
  if (!parsed.success) {
    console.error("rescue history rejected: unexpected row shape");
    return null;
  }
  return new Map(
    parsed.data.map((row) => [
      row.order_id,
      { refused: row.prior_refused_count, cancelled: row.prior_cancelled_count },
    ]),
  );
}
