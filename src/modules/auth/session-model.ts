import { z } from "zod";

import { APP_ROLES, type AppRole } from "./roles";

/** The only columns read from `profiles` for authentication. */
export const profileRowSchema = z
  .object({
    role: z.enum(APP_ROLES),
    is_active: z.boolean(),
    display_name: z.string().trim().min(1).max(120),
  })
  .strict();

export type AppUser = {
  id: string;
  email: string | null;
  role: AppRole;
  displayName: string;
};

/**
 * Builds the signed-in user from the validated auth identity and the profile row.
 * It accepts no metadata argument on purpose: user_metadata is editable by the user, so it can never grant a role.
 * Returns null when the profile is missing, malformed, or deactivated. A null result means "not signed in".
 */
export function resolveAppUser(
  authIdentity: { id: string; email: string | null },
  profileRow: unknown,
): AppUser | null {
  const parsed = profileRowSchema.safeParse(profileRow);
  if (!parsed.success || !parsed.data.is_active) {
    return null;
  }
  return {
    id: authIdentity.id,
    email: authIdentity.email,
    role: parsed.data.role,
    displayName: parsed.data.display_name,
  };
}
