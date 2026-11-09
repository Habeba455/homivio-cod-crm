import "server-only";

import { redirect } from "next/navigation";

import { areaRedirect, type AppArea } from "./roles";
import { getCurrentUser } from "./session";
import type { AppUser } from "./session-model";

/** Requires a signed-in, active user. Anonymous callers are sent to login. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  return user;
}

/** Requires a user whose role may open the area. Users without access go to their own home. */
export async function requireArea(area: AppArea): Promise<AppUser> {
  const user = await requireUser();
  const target = areaRedirect(user.role, area);
  if (target !== null) {
    redirect(target);
  }
  return user;
}
