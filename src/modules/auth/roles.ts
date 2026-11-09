/**
 * Application roles. The only source of truth is the `profiles.role` column in the database.
 * Roles are never read from user_metadata, app_metadata, or any client-supplied value.
 */
export const APP_ROLES = ["admin", "agent"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Which roles may open each area. Admins see everything; agents see only their own orders (enforced in RLS). */
export const AREA_ROLES = {
  admin: ["admin"],
  agent: ["admin", "agent"],
} as const satisfies Record<string, readonly AppRole[]>;

export type AppArea = keyof typeof AREA_ROLES;

export function canAccessArea(role: AppRole, area: AppArea): boolean {
  return (AREA_ROLES[area] as readonly AppRole[]).includes(role);
}

/** Where a signed-in user lands after login. */
export function homePathFor(role: AppRole): "/admin" | "/agent" {
  return role === "admin" ? "/admin" : "/agent";
}

/** Returns where to send a user who may not open an area, or null when access is allowed. */
export function areaRedirect(role: AppRole, area: AppArea): string | null {
  return canAccessArea(role, area) ? null : homePathFor(role);
}
