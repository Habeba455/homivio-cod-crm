import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "../env";

/**
 * Used only by proxy.ts. Validates the session with Supabase Auth and rotates cookies when needed.
 * The result is an optimistic signal. Pages still authorize on the server.
 */
export async function refreshSession(request: NextRequest): Promise<{ response: NextResponse; hasSession: boolean }> {
  let response = NextResponse.next({ request });
  const config = getSupabasePublicConfig();

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  return { response, hasSession: !error && data.user !== null };
}
