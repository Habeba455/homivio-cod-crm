import { describe, expect, it } from "vitest";

import { resolveAppUser } from "./session-model";

const IDENTITY = { id: "00000000-0000-4000-8000-000000000002", email: "agent1@example.test" };

describe("resolveAppUser", () => {
  it("builds the user from the profile row", () => {
    expect(resolveAppUser(IDENTITY, { role: "agent", is_active: true, display_name: "Agent One" })).toEqual({
      id: IDENTITY.id,
      email: IDENTITY.email,
      role: "agent",
      displayName: "Agent One",
    });
  });

  it("takes the role from the profile even when the auth identity claims another role", () => {
    // The identity argument has no role field by design. This shows that a role sent in an extra field is ignored.
    const spoofed = { ...IDENTITY, role: "admin", user_metadata: { role: "admin" } } as typeof IDENTITY;
    const user = resolveAppUser(spoofed, { role: "agent", is_active: true, display_name: "Agent One" });
    expect(user?.role).toBe("agent");
  });

  it("returns null when there is no profile", () => {
    expect(resolveAppUser(IDENTITY, null)).toBeNull();
    expect(resolveAppUser(IDENTITY, undefined)).toBeNull();
  });

  it("returns null for a deactivated profile", () => {
    expect(resolveAppUser(IDENTITY, { role: "admin", is_active: false, display_name: "Admin" })).toBeNull();
  });

  it("returns null for an unknown role value", () => {
    expect(resolveAppUser(IDENTITY, { role: "superuser", is_active: true, display_name: "X" })).toBeNull();
  });

  it("returns null when extra columns are present, so the row shape stays fixed", () => {
    expect(
      resolveAppUser(IDENTITY, { role: "agent", is_active: true, display_name: "X", email: "leak@example.test" }),
    ).toBeNull();
  });

  it("returns null for an empty display name", () => {
    expect(resolveAppUser(IDENTITY, { role: "agent", is_active: true, display_name: "   " })).toBeNull();
  });
});
