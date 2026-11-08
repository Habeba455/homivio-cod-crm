import { z } from "zod";

import { AGENT_CANCEL_REASONS } from "./domain/status";
import type { OrderEvent } from "./domain/transitions";

/**
 * Boundary schema for order events received from forms or Server Actions.
 * Strict objects reject unknown keys, so a client cannot smuggle extra fields into the domain.
 */
export const orderEventSchema: z.ZodType<OrderEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("call_answered") }).strict(),
  z.object({ type: z.literal("call_no_answer") }).strict(),
  z.object({ type: z.literal("confirm") }).strict(),
  z
    .object({
      type: z.literal("cancel"),
      reason: z.enum(AGENT_CANCEL_REASONS),
    })
    .strict(),
]);
