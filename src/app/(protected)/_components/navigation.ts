import type { AppRole } from "@/modules/auth/roles";

export type NavIcon = "overview" | "orders" | "distribution" | "rescue" | "analytics";

export type NavItem = { href: string; label: string; icon?: NavIcon };

/** Admins see every workspace. Agents see their own queue; order detail pages are reached from it. */
const ADMIN_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/admin", label: "Orders", icon: "orders" },
  { href: "/admin/distribution", label: "Distribution", icon: "distribution" },
  { href: "/admin/rescue", label: "Rescue Queue", icon: "rescue" },
  { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
];

const AGENT_NAV: readonly NavItem[] = [{ href: "/agent", label: "My Queue", icon: "rescue" }];

export function navigationFor(role: AppRole): { home: "/dashboard" | "/agent"; items: readonly NavItem[] } {
  return role === "admin" ? { home: "/dashboard", items: ADMIN_NAV } : { home: "/agent", items: AGENT_NAV };
}
