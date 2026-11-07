import "server-only";

import { parseSupabasePublicEnv, type SupabasePublicConfig } from "./env-schema";

/**
 * Server-side access to the Supabase public configuration.
 *
 * Validation runs when a feature calls this function, not at import time, so a
 * missing variable cannot break an unrelated build or route. Only the URL and
 * the publishable key are returned. The service-role key is never read here.
 *
 * This module is server-only. Next.js reads NEXT_PUBLIC_ values at runtime on
 * the server, and browser code must not import this module.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig {
  const result = parseSupabasePublicEnv(process.env);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.key} ${issue.problem}`).join("; ");
    throw new Error(`Invalid Supabase configuration: ${details}. See .env.example.`);
  }
  return result.value;
}
