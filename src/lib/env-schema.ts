import { z } from "zod";

/**
 * Pure validation for the Supabase public configuration.
 *
 * This module never reads process.env and never imports server-only code, so
 * it can be unit tested. Issues name the variable and describe the problem.
 * They never contain the value, so a mistyped secret cannot leak into logs.
 */

export type EnvIssue = {
  /** Environment variable name. Never the value. */
  key: string;
  /** What is wrong. Never contains the value. */
  problem: string;
};

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export type SupabasePublicEnvResult =
  | { ok: true; value: SupabasePublicConfig }
  | { ok: false; issues: EnvIssue[] };

export type EnvSource = Readonly<Record<string, string | undefined>>;

const MISSING = "is required";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const SECRET_NAME_PATTERN = /SERVICE_ROLE|SECRET/;
const PUBLISHABLE_PREFIX = "sb_publishable_";
const SECRET_PREFIX = ["sb", "secret", ""].join("_");
const PUBLISHABLE_BODY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{10,}$/;

/** Returns a problem description, or null when the key may be used in the browser. */
export function checkPublishableKey(value: string): string | null {
  if (value.startsWith(SECRET_PREFIX)) {
    return "is a secret key; only a publishable key may be used in this variable";
  }
  if (value.startsWith(PUBLISHABLE_PREFIX)) {
    return PUBLISHABLE_BODY_PATTERN.test(value) ? null : "has an invalid publishable key format";
  }
  // Legacy Supabase keys are JWTs. Only the 'anon' role is acceptable here.
  const segments = value.split(".");
  if (segments.length === 3 && value.startsWith("eyJ")) {
    const role = readJwtRole(segments[1]);
    if (role === undefined) return "is not a valid JWT";
    if (role === "anon") return null;
    if (role === "service_role") {
      return "is a service-role key; it must never be exposed to the browser";
    }
    return "has an unsupported JWT role";
  }
  return "has an unrecognised format";
}

/** Reads the role claim without verifying the signature. Used only to classify the key. */
function readJwtRole(payloadSegment: string): string | undefined {
  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      return typeof payload.role === "string" ? payload.role : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const requiredText = z.string({ error: MISSING }).trim().min(1, { error: MISSING });

const supabaseUrlSchema = requiredText.transform((value, ctx) => {
  const fail = (message: string) => {
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("must be an absolute URL");
  }

  const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    return fail("must use https (http is allowed only for localhost or 127.0.0.1)");
  }
  if (url.username !== "" || url.password !== "") {
    return fail("must not contain credentials");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") {
    return fail("must be the project origin only, without a path, query or fragment");
  }
  return url.origin;
});

const publishableKeySchema = requiredText.superRefine((value, ctx) => {
  if (value.length === 0) return; // already reported as missing by requiredText
  const problem = checkPublishableKey(value);
  if (problem !== null) {
    ctx.addIssue({ code: "custom", message: problem });
  }
});

// z.object strips unknown keys, so no other variable (for example a service-role key) reaches the result.
const supabasePublicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrlSchema,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKeySchema,
});

/** Public variables whose names suggest a secret. Empty values are ignored. */
export function findSecretNamedPublicVariables(source: EnvSource): string[] {
  return Object.keys(source).filter(
    (key) =>
      key.startsWith("NEXT_PUBLIC_") &&
      SECRET_NAME_PATTERN.test(key) &&
      (source[key] ?? "") !== "",
  );
}

export function parseSupabasePublicEnv(source: EnvSource): SupabasePublicEnvResult {
  const leaked: EnvIssue[] = findSecretNamedPublicVariables(source).map((key) => ({
    key,
    problem: "must not be set: secret keys must never use a NEXT_PUBLIC_ name",
  }));

  const parsed = supabasePublicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!parsed.success) {
    // Copy only the variable name and the message. Never copy the input value.
    const issues = parsed.error.issues.map((issue) => ({
      key: String(issue.path[0] ?? "env"),
      problem: issue.message,
    }));
    return { ok: false, issues: [...leaked, ...issues] };
  }

  if (leaked.length > 0) {
    return { ok: false, issues: leaked };
  }

  return {
    ok: true,
    value: {
      url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
  };
}
