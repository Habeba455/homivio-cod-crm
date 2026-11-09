import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "../env";

/**
 * Request-scoped Supabase client for Server Components, Server Actions and Route Handlers.
 * It uses the publishable key with the user's session cookies, so RLS applies to every query.
 * It never uses the service-role key. Create it per request. Do not store it in a module-level variable.
 */
export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the session on the next request.
        }
      },
    },
  });
}
