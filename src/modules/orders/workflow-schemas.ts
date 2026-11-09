import { z } from "zod";

import { AGENT_CANCEL_REASONS } from "./domain/status";

/**
 * Input schemas for the order workflow Server Actions. Form values arrive as strings, so numbers are coerced.
 * Strict objects reject unknown keys. The database is the final authority; these checks only reject bad input early.
 */

const uuid = z.uuid();
const expectedVersion = z.coerce.number().int().min(1);

export const assignOrderInput = z
  .object({ orderId: uuid, agentId: uuid, expectedVersion })
  .strict();

export const callOutcomeInput = z
  .object({
    orderId: uuid,
    expectedVersion,
    outcome: z.enum(["answered", "no_answer"]),
    idempotencyKey: uuid,
  })
  .strict();

export const confirmOrderInput = z.object({ orderId: uuid, expectedVersion }).strict();

export const cancelOrderInput = z
  .object({
    orderId: uuid,
    expectedVersion,
    reason: z.enum(AGENT_CANCEL_REASONS),
  })
  .strict();

export const addNoteInput = z
  .object({
    orderId: uuid,
    body: z.string().trim().min(1).max(2000),
  })
  .strict();
