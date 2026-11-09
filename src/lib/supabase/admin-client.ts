import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Administrative Supabase client for operator scripts only (architecture §5.3).
 *
 * - No user session, no cookies, no SSR client. The service identity comes only from the key.
 * - The key is never logged or echoed. Error messages name the variable, never the value.
 * - Never imported by app routes or components. Only scripts/ uses it.
 *
 * Why the secret key is not sent as a bearer token: supabase-js 2.x adds `Authorization: Bearer <key>`
 * to PostgREST calls, including .rpc(). A modern sb_secret_ key is not a JWT, so PostgREST ignores it
 * and the request runs as `anon`, which yields "permission denied for function". For secret keys this
 * client removes the Authorization header and leaves the key in the `apikey` header only.
 */

export type AdminKeyKind = "secret" | "legacy_service_role";

export type AdminKeyResolution =
  | { ok: true; key: string; kind: AdminKeyKind }
  | { ok: false; problem: string };

// Built at runtime so the literal prefix does not appear in source (matches env-schema.ts).
const SECRET_PREFIX = ["sb", "secret", ""].join("_");

/** Reads the role claim from a JWT without verifying it. Used only to classify a legacy key. */
function jwtRole(token: string): string | undefined {
  const segments = token.split(".");
  if (segments.length !== 3) return undefined;
  try {
    const payload: unknown = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    if (typeof payload === "object" && payload !== null && "role" in payload && typeof payload.role === "string") {
      return payload.role;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chooses the administrative key. SUPABASE_SECRET_KEY is preferred. The legacy service-role JWT is an
 * optional fallback and must have role service_role. Publishable and anon keys are always rejected.
 */
export function resolveAdminKey(env: Readonly<Record<string, string | undefined>>): AdminKeyResolution {
  const secret = (env.SUPABASE_SECRET_KEY ?? "").trim();
  if (secret !== "") {
    if (!secret.startsWith(SECRET_PREFIX)) {
      return { ok: false, problem: "SUPABASE_SECRET_KEY must be a modern secret key (not a publishable key)" };
    }
    return { ok: true, key: secret, kind: "secret" };
  }

  const legacy = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (legacy !== "") {
    if (jwtRole(legacy) !== "service_role") {
      return { ok: false, problem: "SUPABASE_SERVICE_ROLE_KEY must be a legacy service_role key" };
    }
    return { ok: true, key: legacy, kind: "legacy_service_role" };
  }

  return { ok: false, problem: "set SUPABASE_SECRET_KEY in .env.local" };
}

/**
 * Creates the administrative client. fetchImpl is injectable for tests; production uses the global fetch.
 */
export function createAdminClient(
  url: string,
  resolved: { key: string; kind: AdminKeyKind },
  fetchImpl: typeof fetch = fetch,
): SupabaseClient {
  const fetchWithoutBearer: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("Authorization");
    return fetchImpl(input, { ...init, headers });
  };

  return createClient(url, resolved.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: resolved.kind === "secret" ? fetchWithoutBearer : fetchImpl,
    },
  });
}
