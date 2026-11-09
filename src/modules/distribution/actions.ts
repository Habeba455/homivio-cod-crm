"use server";

import { randomInt, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireArea } from "@/modules/auth/guards";
import { listActiveAgents } from "@/modules/orders/queries";
import { describeWorkflowError, INVALID_INPUT_MESSAGE } from "@/modules/orders/workflow-errors";

import { chooseAgents, type AgentPlan, type AssignmentMode } from "./domain/distribution";
import { buildReview, type ReviewOrderInput, type ReviewRow, type ReviewSource } from "./domain/review";
import {
  distributeInputSchema,
  distributionResultSchema,
  parseJsonOrUndefined,
  planSchema,
  proposalSchema,
  reviewPayloadSchema,
} from "./schemas";
import { loadAgentWorkloads, loadOrderSnapshots } from "./queries";

/**
 * Server actions for the Distribution Center. Admin only, checked in requireArea and again in the database.
 *
 * Review is read-only. It builds the mapping for the chosen mode, or checks the admin's edited mapping.
 * Distribute sends the reviewed plan, unchanged, to one RPC call. That call is one transaction.
 */

export type ReviewView = {
  mode: AssignmentMode;
  /** Fresh per review. Retrying the same confirmation reuses it, so the database replays instead of writing twice. */
  batchKey: string;
  /** Canonical form of the selection (orders and agents) this review was built for. */
  selectionKey: string;
  /** Canonical form of the eligible mapping. The page compares edits against it. */
  basis: string;
  /** Exact plan submitted on confirmation. */
  planJson: string;
  rows: ReviewRow[];
  agents: AgentPlan[];
  proposedCount: number;
  unassignedCount: number;
  skippedCount: number;
  excluded: { reason: string; count: number }[];
  duplicatesIgnored: number;
  unavailableAgentCount: number;
};

export type ReviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "empty"; review: ReviewView }
  | { status: "ready"; review: ReviewView };

export type DistributionSummary = {
  batchId: string;
  mode: AssignmentMode;
  replayed: boolean;
  requested: number;
  assigned: number;
  skipped: number;
  failed: number;
  reasons: { reason: string; count: number }[];
};

export type DistributeState =
  | { status: "idle" }
  | { status: "error"; message: string; refresh: boolean }
  | { status: "done"; result: DistributionSummary };

const REVIEW_INVALID: ReviewState = { status: "error", message: INVALID_INPUT_MESSAGE };
const REVIEW_UNREADABLE: ReviewState = {
  status: "error",
  message: "The review could not be built. Refresh the page and try again.",
};

/**
 * Builds the review. intent "generate" creates a new mapping for random or balanced mode.
 * Any other intent checks the mapping the admin submitted, including manual edits.
 */
export async function reviewAssignmentAction(_previous: ReviewState, formData: FormData): Promise<ReviewState> {
  await requireArea("admin");

  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") return REVIEW_INVALID;
  const payload = reviewPayloadSchema.safeParse(parseJsonOrUndefined(payloadRaw));
  if (!payload.success) return REVIEW_INVALID;

  const proposalRaw = formData.get("proposal");
  const proposal =
    typeof proposalRaw === "string" ? proposalSchema.safeParse(parseJsonOrUndefined(proposalRaw)) : { success: true as const, data: [] };
  if (!proposal.success) return REVIEW_INVALID;

  const uniqueIds = [...new Set(payload.data.orderIds)];
  const selected = new Set(uniqueIds);
  if (proposal.data.some((entry) => !selected.has(entry.orderId))) return REVIEW_INVALID;

  const generate = formData.get("intent") === "generate" && payload.data.mode !== "manual";
  const duplicatesIgnored = payload.data.orderIds.length - uniqueIds.length;

  const snapshots = await loadOrderSnapshots(uniqueIds);
  if (!snapshots.ok) return REVIEW_UNREADABLE;

  const activeAgents = await listActiveAgents();
  if (!activeAgents.ok) return REVIEW_UNREADABLE;
  const chosen = chooseAgents(
    activeAgents.agents.map((agent) => ({ agentId: agent.id, displayName: agent.displayName, currentLoad: 0 })),
    [...new Set(payload.data.agentIds)],
  );
  const workloads = await loadAgentWorkloads(chosen.agents.map((agent) => agent.agentId));
  if (workloads === null) return REVIEW_UNREADABLE;
  const agents = chosen.agents.map((agent) => ({ ...agent, currentLoad: workloads.get(agent.agentId) ?? 0 }));
  const agentNames = new Map(activeAgents.agents.map((agent) => [agent.id, agent.displayName] as const));

  const orders: ReviewOrderInput[] = uniqueIds.map((orderId) => {
    const snapshot = snapshots.byId.get(orderId) ?? null;
    return {
      orderId,
      orderRef: snapshot?.orderRef ?? "Unknown order",
      customerName: snapshot?.customerName ?? null,
      snapshot,
    };
  });

  let source: ReviewSource;
  if (generate && payload.data.mode === "random") {
    source = { kind: "random", nextIndex: (size) => randomInt(size) };
  } else if (generate) {
    source = { kind: "balanced" };
  } else {
    source = { kind: "proposal", proposal: new Map(proposal.data.map((entry) => [entry.orderId, entry.agentId] as const)) };
  }

  const review = buildReview({
    orders,
    agents,
    agentNames,
    source,
    duplicatesIgnored,
    unavailableAgentCount: chosen.unavailable.length,
  });

  const view: ReviewView = {
    mode: payload.data.mode,
    batchKey: randomUUID(),
    selectionKey: JSON.stringify([[...uniqueIds].sort(), [...new Set(payload.data.agentIds)].sort()]),
    basis: review.basis,
    planJson: JSON.stringify(
      review.assignments.map((item) => ({
        order_id: item.orderId,
        agent_id: item.agentId,
        expected_version: item.expectedVersion,
      })),
    ),
    rows: review.rows,
    agents: review.agents,
    proposedCount: review.proposedCount,
    unassignedCount: review.unassignedCount,
    skippedCount: review.skippedCount,
    excluded: review.excluded,
    duplicatesIgnored: review.duplicatesIgnored,
    unavailableAgentCount: review.unavailableAgentCount,
  };

  if (review.proposedCount === 0) return { status: "empty", review: view };
  return { status: "ready", review: view };
}

/**
 * Confirmed write. The reviewed plan is executed exactly as shown. The RPC rechecks each order and agent,
 * so anything that changed since the review is skipped, never overwritten.
 */
export async function distributeOrdersAction(_previous: DistributeState, formData: FormData): Promise<DistributeState> {
  await requireArea("admin");

  const batchKey = formData.get("batchKey");
  const planRaw = formData.get("plan");
  const mode = formData.get("mode");
  if (typeof batchKey !== "string" || typeof planRaw !== "string" || typeof mode !== "string") {
    return { status: "error", message: INVALID_INPUT_MESSAGE, refresh: false };
  }
  const input = distributeInputSchema.safeParse({ batchKey, plan: planRaw, mode });
  if (!input.success) return { status: "error", message: INVALID_INPUT_MESSAGE, refresh: false };
  const plan = planSchema.safeParse(parseJsonOrUndefined(planRaw));
  if (!plan.success) return { status: "error", message: INVALID_INPUT_MESSAGE, refresh: false };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("distribute_orders", {
    p_batch_key: input.data.batchKey,
    p_plan: plan.data,
    p_mode: input.data.mode,
  });

  // One transaction for the whole batch. On error nothing was written, so retrying with the same key is safe.
  if (error) {
    const view = describeWorkflowError(error.code);
    return { status: "error", message: view.message, refresh: view.refresh };
  }

  for (const path of ["/dashboard", "/admin", "/agent"]) revalidatePath(path, "layout");
  revalidatePath("/admin/distribution");
  revalidatePath("/admin/rescue");

  const parsed = distributionResultSchema.safeParse(data);
  if (!parsed.success) {
    return {
      status: "error",
      message: "The batch finished, but its result could not be read. Check the order list before you distribute again.",
      refresh: true,
    };
  }

  const reasonCounts = new Map<string, number>();
  for (const item of parsed.data.items) {
    if (item.outcome !== "assigned" && item.reason !== null) {
      reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1);
    }
  }

  return {
    status: "done",
    result: {
      batchId: parsed.data.batch_id,
      mode: parsed.data.mode,
      replayed: parsed.data.replayed,
      requested: parsed.data.requested,
      assigned: parsed.data.assigned,
      skipped: parsed.data.skipped,
      failed: parsed.data.failed,
      reasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })),
    },
  };
}
