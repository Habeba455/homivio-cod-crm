import { describe, expect, it } from "vitest";

import { loginSchema } from "./login-schema";

describe("loginSchema", () => {
  it("trims and lowercases the email", () => {
    const parsed = loginSchema.parse({ email: "  Agent1@Example.TEST ", password: "secret" });
    expect(parsed.email).toBe("agent1@example.test");
  });

  it("rejects an invalid email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "secret" }).success).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@example.test", password: "" }).success).toBe(false);
  });

  it("rejects an overlong password", () => {
    expect(loginSchema.safeParse({ email: "a@example.test", password: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects unknown fields, so a client cannot send a role or user id", () => {
    expect(
      loginSchema.safeParse({ email: "a@example.test", password: "secret", role: "admin" }).success,
    ).toBe(false);
  });
});
