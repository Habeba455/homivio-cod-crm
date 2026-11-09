import "server-only";

import { cache } from "react";
import { connection } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { resolveAppUser, type AppUser } from "./session-model";

/**
 * The signed-in user for this request, or null when anonymous, deactivated, or without a profile.
 *
 * - Uncached across requests. The session and the role are read on every request, so a demoted or
 *   deactivated user loses access on the next request. Do not add `use cache` or `use cache: private` here.
 * - React cache() only deduplicates calls within one render pass.
 * - The role comes from the `profiles` row, never from user_metadata or any client value.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  // Marks this as request-time rendering before the Supabase client reads the clock (token expiry).
  // Without it, prerendering fails with the Date.now() error. Does not cache anything.
  await connection();

  const supabase = await createSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || userData.user === null) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active, display_name")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) {
    // Log only the error code. Do not log identifiers or row data.
    console.error("profile lookup failed", profileError.code);
    return null;
  }

  return resolveAppUser({ id: userData.user.id, email: userData.user.email ?? null }, profile);
});
