"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireArea } from "@/modules/auth/guards";

import { describeWorkflowError, INVALID_INPUT_MESSAGE } from "./workflow-errors";
import {
  addNoteInput,
  assignOrderInput,
  callOutcomeInput,
  cancelOrderInput,
  confirmOrderInput,
} from "./workflow-schemas";

/**
 * Server Actions for the order workflow. Each one checks the caller's area, validates the input, then calls
 * one existing RPC with the user's session. Authorization and version checks happen in the database.
 * No action writes to a protected table directly.
 */

/** `finished` is set by recordCallAction when the call left the order Confirmed or Cancelled. */
export type ActionState = { ok: boolean; message: string | null; finished?: boolean };

const invalid: ActionState = { ok: false, message: INVALID_INPUT_MESSAGE };

async function callRpc(
  fn: "assign_order" | "log_call_attempt" | "confirm_order" | "cancel_order" | "add_order_note",
  args: Record<string, string | number>,
): Promise<{ ok: boolean; message: string; refresh: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const view = describeWorkflowError(error.code);
    return { ok: false, message: view.message, refresh: view.refresh };
  }
  return { ok: true, message: "Saved.", refresh: true };
}

function finish(result: { ok: boolean; message: string; refresh: boolean }, paths: string[]): ActionState {
  if (result.refresh) {
    for (const path of paths) revalidatePath(path, "layout");
  }
  return { ok: result.ok, message: result.message };
}

/** Admin only. The RPC rejects non-admins with HV002 and checks that the assignee is an active agent (HV008). */
export async function assignOrderAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea("admin");
  const parsed = assignOrderInput.safeParse({
    orderId: formData.get("orderId"),
    agentId: formData.get("agentId"),
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!parsed.success) return invalid;

  const result = await callRpc("assign_order", {
    p_order_id: parsed.data.orderId,
    p_agent_id: parsed.data.agentId,
    p_expected_version: parsed.data.expectedVersion,
  });
  return finish(result, ["/dashboard", "/admin", "/agent"]);
}

/** Records a call. The idempotency key makes a double submit a replay, not a second call. */
export async function recordCallAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea("agent");
  const parsed = callOutcomeInput.safeParse({
    orderId: formData.get("orderId"),
    expectedVersion: formData.get("expectedVersion"),
    outcome: formData.get("outcome"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) return invalid;

  const result = await callRpc("log_call_attempt", {
    p_order_id: parsed.data.orderId,
    p_outcome: parsed.data.outcome,
    p_expected_version: parsed.data.expectedVersion,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  const state = finish(result, ["/dashboard", "/agent"]);
  if (!result.ok) return state;
  // Read the status back, so the page knows whether this call ended the order.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("orders").select("pipeline_status").eq("id", parsed.data.orderId).maybeSingle();
  const finished = data?.pipeline_status === "Confirmed" || data?.pipeline_status === "Cancelled";
  return { ...state, finished };
}

export async function confirmOrderAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea("agent");
  const parsed = confirmOrderInput.safeParse({
    orderId: formData.get("orderId"),
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!parsed.success) return invalid;

  const result = await callRpc("confirm_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.expectedVersion,
  });
  return finish(result, ["/dashboard", "/agent"]);
}

export async function cancelOrderAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea("agent");
  const parsed = cancelOrderInput.safeParse({
    orderId: formData.get("orderId"),
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return invalid;

  const result = await callRpc("cancel_order", {
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason,
    p_expected_version: parsed.data.expectedVersion,
  });
  return finish(result, ["/dashboard", "/agent"]);
}

export async function addNoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea("agent");
  const parsed = addNoteInput.safeParse({
    orderId: formData.get("orderId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return invalid;

  const result = await callRpc("add_order_note", {
    p_order_id: parsed.data.orderId,
    p_body: parsed.data.body,
  });
  return finish(result, ["/dashboard", "/agent"]);
}
