import { createBrowserClient } from "@supabase/ssr";

import { parseSupabasePublicEnv } from "../env-schema";

/**
 * Browser Supabase client. Only the public URL and publishable key are read here.
 * Auth in this app uses Server Actions and httpOnly cookies, so this client is not used for sign-in.
 * It exists for future client-only features that need Supabase directly, and it must never receive a secret.
 */
export function createSupabaseBrowserClient() {
  const result = parseSupabasePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.ok) {
    throw new Error("Supabase browser configuration is invalid. See .env.example.");
  }
  return createBrowserClient(result.value.url, result.value.publishableKey);
}
