import { z } from "zod";

import { MAX_BATCH_AGENTS, MAX_BATCH_ORDERS } from "./domain/distribution";

/** Input validation for the Distribution Center. Each server action parses its input with these before use. */

const uuid = z.uuid();
const modeSchema = z.enum(["manual", "random", "balanced"]);

/** The selection sent with every review: mode, the selected orders and the participating agents. */
export const reviewPayloadSchema = z
  .object({
    mode: modeSchema,
    orderIds: z.array(uuid).min(1).max(MAX_BATCH_ORDERS),
    agentIds: z.array(uuid).min(1).max(MAX_BATCH_AGENTS),
  })
  .strict();

/** The mapping as the admin sees it in the preview. agentId null means left unassigned. */
export const proposalSchema = z
  .array(z.object({ orderId: uuid, agentId: uuid.nullable() }).strict())
  .max(MAX_BATCH_ORDERS);

/** One item of the reviewed plan. expected_version is the version the review saw. */
export const planItemSchema = z
  .object({
    order_id: uuid,
    agent_id: uuid,
    expected_version: z.number().int().min(1),
  })
  .strict();

export const planSchema = z.array(planItemSchema).min(1).max(MAX_BATCH_ORDERS);

export const distributeInputSchema = z
  .object({
    batchKey: uuid,
    plan: z.string().min(2).max(400_000),
    mode: modeSchema,
  })
  .strict();

export const itemResultSchema = z.object({
  order_id: uuid,
  outcome: z.enum(["assigned", "skipped", "failed"]),
  reason: z.string().max(60).nullable(),
});

/** Shape returned by the distribute_orders RPC. Keys must match the SQL function exactly. */
export const distributionResultSchema = z.object({
  batch_id: uuid,
  mode: modeSchema,
  replayed: z.boolean(),
  requested: z.number().int().min(0),
  assigned: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failed: z.number().int().min(0),
  items: z.array(itemResultSchema).max(MAX_BATCH_ORDERS),
});

/** Parses JSON from form input. Returns undefined instead of throwing on invalid JSON. */
export function parseJsonOrUndefined(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
