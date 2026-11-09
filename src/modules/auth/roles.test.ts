import { describe, expect, it } from "vitest";

import { AREA_ROLES, areaRedirect, canAccessArea, homePathFor } from "./roles";

describe("canAccessArea", () => {
  it("lets only admins into the admin area", () => {
    expect(canAccessArea("admin", "admin")).toBe(true);
    expect(canAccessArea("agent", "admin")).toBe(false);
  });

  it("lets both roles into the agent area, where RLS limits agents to their own orders", () => {
    expect(canAccessArea("admin", "agent")).toBe(true);
    expect(canAccessArea("agent", "agent")).toBe(true);
  });

  it("matches the AREA_ROLES table for every combination", () => {
    for (const area of Object.keys(AREA_ROLES) as Array<keyof typeof AREA_ROLES>) {
      for (const role of ["admin", "agent"] as const) {
        expect(canAccessArea(role, area)).toBe((AREA_ROLES[area] as readonly string[]).includes(role));
      }
    }
  });
});

describe("homePathFor", () => {
  it("sends admins to the admin area and agents to the agent area", () => {
    expect(homePathFor("admin")).toBe("/dashboard");
    expect(homePathFor("agent")).toBe("/agent");
  });
});

describe("areaRedirect", () => {
  it("returns null when access is allowed", () => {
    expect(areaRedirect("admin", "admin")).toBeNull();
    expect(areaRedirect("agent", "agent")).toBeNull();
    expect(areaRedirect("admin", "agent")).toBeNull();
  });

  it("sends an agent who opens the admin area to their own home, not to login", () => {
    expect(areaRedirect("agent", "admin")).toBe("/agent");
  });
});
