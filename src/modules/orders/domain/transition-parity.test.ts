import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AGENT_CANCEL_REASONS, PIPELINE_STATUSES, type AgentCancelReason } from "./status";
import { transitionOrder, type OrderEvent } from "./transitions";

// Paths are relative to the repository root, where Vitest runs.
const FIXTURE_PATH = "supabase/tests/transition-cases.json";
const SQL_CHECKS_PATH = "supabase/tests/i3_database_checks.sql";

const EVENT_NAMES = ["call_answered", "call_no_answer", "confirm", "cancel"] as const;
const CANCEL_REASONS = [...AGENT_CANCEL_REASONS, "three_unanswered_attempts"] as const;

const expectationSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      nextStatus: z.enum(PIPELINE_STATUSES),
      unansweredAttemptCount: z.number().int().nonnegative(),
      cancelReason: z.enum(CANCEL_REASONS).nullable(),
      autoCancelled: z.boolean(),
    })
    .strict(),
  z.object({ ok: z.literal(false), error: z.enum(["not_in_pipeline", "invalid_transition"]) }).strict(),
]);

const caseSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(PIPELINE_STATUSES).nullable(),
    unanswered: z.number().int().nonnegative(),
    event: z.enum(EVENT_NAMES),
    reason: z.enum(AGENT_CANCEL_REASONS).nullable(),
    expect: expectationSchema,
  })
  .strict();

const fixtureSchema = z.object({ cases: z.array(caseSchema).min(1) }).strict();

type FixtureCase = z.infer<typeof caseSchema>;

function toEvent(name: (typeof EVENT_NAMES)[number], reason: AgentCancelReason | null): OrderEvent {
  switch (name) {
    case "call_answered":
      return { type: "call_answered" };
    case "call_no_answer":
      return { type: "call_no_answer" };
    case "confirm":
      return { type: "confirm" };
    case "cancel":
      if (reason === null) throw new Error("a cancel case must carry a reason");
      return { type: "cancel", reason };
  }
}

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));

describe("transition fixture: TypeScript domain matches the shared cases", () => {
  it("covers every state, including historical, and every event", () => {
    const states = new Set(fixture.cases.map((c) => c.status));
    for (const status of [null, ...PIPELINE_STATUSES]) {
      expect(states.has(status)).toBe(true);
    }
    for (const event of EVENT_NAMES) {
      expect(fixture.cases.some((c) => c.event === event)).toBe(true);
    }
  });

  for (const c of fixture.cases) {
    it(c.name, (): void => {
      const outcome = transitionOrder(
        { status: c.status, unansweredAttemptCount: c.unanswered },
        toEvent(c.event, c.reason),
      );
      expect(outcome).toEqual(c.expect as FixtureCase["expect"]);
    });
  }
});

describe("transition fixture: the SQL copy matches the same file", () => {
  it("embeds identical cases in the database checks", () => {
    const sql = readFileSync(SQL_CHECKS_PATH, "utf8");
    const match = /-- BEGIN transition-cases\n[\s\S]*?v_cases jsonb := '(.+?)'::jsonb;/.exec(sql);
    if (!match?.[1]) throw new Error("transition-cases block not found in the SQL checks");
    expect(JSON.parse(match[1])).toEqual(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
  });
});
