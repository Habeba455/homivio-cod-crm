import { describe, expect, it } from "vitest";

import { describeWorkflowError, INVALID_INPUT_MESSAGE } from "./workflow-errors";

/**
 * Detects real SQL statements and PostgreSQL error details. Ordinary English words such as "selected" do not match.
 */
const SQL_OR_DB_DETAIL: readonly RegExp[] = [
  /\bSELECT\s+[\s\S]+?\s+FROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\b(?:public|app_private|auth)\.\w+/,
  /\b(?:relation|column|function|type|table)\s+"[^"]*"\s+does not exist\b/i,
  /\bSQLSTATE\b/i,
  /\bERROR:\s/,
  /\bpg_\w+/,
];

function exposesSqlOrDbDetail(text: string): boolean {
  return SQL_OR_DB_DETAIL.some((pattern) => pattern.test(text));
}

const ALL_CODES = ["HV001", "HV002", "HV003", "HV004", "HV005", "HV006", "HV007", "HV008", "XX999"];

describe("describeWorkflowError", () => {
  it("asks the screen to refresh after a version conflict", () => {
    expect(describeWorkflowError("HV004").refresh).toBe(true);
  });

  it("does not refresh on an authorization failure", () => {
    expect(describeWorkflowError("HV002").refresh).toBe(false);
  });

  it("maps the not-found code to a message that does not reveal existence", () => {
    expect(describeWorkflowError("HV003").message).toMatch(/not found, or it is not assigned to you/);
  });

  it("returns a safe fallback for unknown codes and for missing codes", () => {
    expect(describeWorkflowError("XX999").message).toMatch(/nothing was changed/);
    expect(describeWorkflowError(undefined).refresh).toBe(true);
  });

  it("never returns SQL or database error text for any production code", () => {
    for (const code of ALL_CODES) {
      expect(exposesSqlOrDbDetail(describeWorkflowError(code).message)).toBe(false);
    }
  });

  it("does not flag the legitimate word 'selected' in the agent-eligibility message", () => {
    const message = describeWorkflowError("HV008").message;
    expect(message).toBe("The selected person is not an active agent.");
    expect(exposesSqlOrDbDetail(message)).toBe(false);
  });

  it("never echoes raw database text, even if it were passed in as a code", () => {
    const raw = 'relation "public.orders" does not exist';
    expect(exposesSqlOrDbDetail(raw)).toBe(true);
    const view = describeWorkflowError(raw);
    expect(view.message).not.toBe(raw);
    expect(exposesSqlOrDbDetail(view.message)).toBe(false);
  });

  it("detects real SQL statements and PostgreSQL error details", () => {
    expect(exposesSqlOrDbDetail("SELECT id FROM public.orders WHERE id = $1")).toBe(true);
    expect(exposesSqlOrDbDetail("INSERT INTO public.call_attempts (order_id) VALUES ($1)")).toBe(true);
    expect(exposesSqlOrDbDetail("ERROR: duplicate key value violates unique constraint")).toBe(true);
    expect(exposesSqlOrDbDetail("SQLSTATE 42501")).toBe(true);
  });

  it("keeps the shared invalid-input message free of SQL text", () => {
    expect(exposesSqlOrDbDetail(INVALID_INPUT_MESSAGE)).toBe(false);
  });
});
