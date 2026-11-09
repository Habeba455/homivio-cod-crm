import { describe, expect, it } from "vitest";

import { createAdminClient, resolveAdminKey } from "./admin-client";

// Fake keys, built at runtime. These are not real credentials.
const SECRET_PREFIX = ["sb", "secret", ""].join("_");
const PUBLISHABLE_PREFIX = ["sb", "publishable", ""].join("_");
const FAKE_SECRET = `${SECRET_PREFIX}fakefakefakefake1234`;

function fakeJwt(role: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

describe("resolveAdminKey", () => {
  it("prefers SUPABASE_SECRET_KEY", () => {
    expect(resolveAdminKey({ SUPABASE_SECRET_KEY: FAKE_SECRET })).toEqual({
      ok: true,
      key: FAKE_SECRET,
      kind: "secret",
    });
  });

  it("rejects a publishable key in the secret variable", () => {
    const result = resolveAdminKey({ SUPABASE_SECRET_KEY: `${PUBLISHABLE_PREFIX}fakefakefake1234` });
    expect(result.ok).toBe(false);
  });

  it("accepts the legacy fallback only with the service_role role", () => {
    expect(resolveAdminKey({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt("service_role") })).toMatchObject({
      ok: true,
      kind: "legacy_service_role",
    });
    expect(resolveAdminKey({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt("anon") }).ok).toBe(false);
  });

  it("reports a missing key without echoing any value", () => {
    const result = resolveAdminKey({ SUPABASE_SECRET_KEY: `${PUBLISHABLE_PREFIX}leaked-value-123` });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).not.toContain("leaked-value-123");
    }
    expect(resolveAdminKey({}).ok).toBe(false);
  });
});

type Recorded = { url: string; headers: Headers };

function recordingFetch(recorded: Recorded[]): typeof fetch {
  return async (input, init) => {
    recorded.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ status: "imported" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("createAdminClient", () => {
  it("sends the secret key only in apikey, never as a bearer token", async () => {
    const recorded: Recorded[] = [];
    const client = createAdminClient(
      "https://example.supabase.co",
      { key: FAKE_SECRET, kind: "secret" },
      recordingFetch(recorded),
    );

    const { error } = await client.rpc("import_source_orders", { p_orders: [] });

    expect(error).toBeNull();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toContain("/rest/v1/rpc/import_source_orders");
    expect(recorded[0].headers.get("apikey")).toBe(FAKE_SECRET);
    expect(recorded[0].headers.get("authorization")).toBeNull();
  });

  it("keeps the bearer header for the legacy service_role JWT", async () => {
    const recorded: Recorded[] = [];
    const jwt = fakeJwt("service_role");
    const client = createAdminClient(
      "https://example.supabase.co",
      { key: jwt, kind: "legacy_service_role" },
      recordingFetch(recorded),
    );

    await client.rpc("import_source_orders", { p_orders: [] });

    expect(recorded[0].headers.get("authorization")).toBe(`Bearer ${jwt}`);
  });
});
