import { describe, expect, it } from "vitest";

import {
  checkPublishableKey,
  parseSupabasePublicEnv,
  type EnvSource,
  type SupabasePublicEnvResult,
} from "./env-schema";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const PUBLISHABLE_KEY = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const VALID_URL = "https://abcdefghijklmnop.supabase.co";
const VALID_PUBLISHABLE = "sb_publishable_TestOnly_0123456789";
// Built at runtime so the source never contains a literal secret-shaped string.
const SECRET_PREFIX = ["sb", "secret", ""].join("_");
const FAKE_SECRET = `${SECRET_PREFIX}TestOnly0123456789`;

/** Builds an unsigned, fake JWT for classification tests. Contains no real credentials. */
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature-not-verified`;
}

function validSource(overrides: EnvSource = {}): EnvSource {
  return { [URL_KEY]: VALID_URL, [PUBLISHABLE_KEY]: VALID_PUBLISHABLE, ...overrides };
}

function expectOk(result: SupabasePublicEnvResult) {
  if (!result.ok) {
    throw new Error(`expected success, got: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function expectIssues(result: SupabasePublicEnvResult) {
  if (result.ok) {
    throw new Error("expected validation to fail");
  }
  return result.issues;
}

describe("parseSupabasePublicEnv: valid configuration", () => {
  it("accepts an https URL and a publishable key", () => {
    const value = expectOk(parseSupabasePublicEnv(validSource()));
    expect(value.url).toBe(VALID_URL);
    expect(value.publishableKey).toBe(VALID_PUBLISHABLE);
  });

  it("normalises the URL to its origin, removing a trailing slash", () => {
    const value = expectOk(parseSupabasePublicEnv(validSource({ [URL_KEY]: `${VALID_URL}/` })));
    expect(value.url).toBe(VALID_URL);
  });

  it("accepts a local Supabase URL over http", () => {
    const value = expectOk(
      parseSupabasePublicEnv(validSource({ [URL_KEY]: "http://127.0.0.1:54321" })),
    );
    expect(value.url).toBe("http://127.0.0.1:54321");
  });

  it("accepts a legacy anon JWT", () => {
    const anon = fakeJwt({ role: "anon" });
    const value = expectOk(parseSupabasePublicEnv(validSource({ [PUBLISHABLE_KEY]: anon })));
    expect(value.publishableKey).toBe(anon);
  });

  it("returns only the URL and publishable key, so a service-role value never reaches the config", () => {
    const value = expectOk(
      parseSupabasePublicEnv(
        validSource({ SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET }),
      ),
    );
    expect(Object.keys(value).sort()).toEqual(["publishableKey", "url"]);
    expect(JSON.stringify(value)).not.toContain(SECRET_PREFIX);
  });
});

describe("parseSupabasePublicEnv: missing values", () => {
  it("reports a missing URL as required", () => {
    const issues = expectIssues(parseSupabasePublicEnv(validSource({ [URL_KEY]: undefined })));
    expect(issues).toEqual([{ key: URL_KEY, problem: "is required" }]);
  });

  it("reports a missing publishable key as required", () => {
    const issues = expectIssues(
      parseSupabasePublicEnv(validSource({ [PUBLISHABLE_KEY]: undefined })),
    );
    expect(issues).toEqual([{ key: PUBLISHABLE_KEY, problem: "is required" }]);
  });

  it("treats an empty string as missing", () => {
    const issues = expectIssues(parseSupabasePublicEnv(validSource({ [URL_KEY]: "" })));
    expect(issues).toEqual([{ key: URL_KEY, problem: "is required" }]);
  });

  it("treats a whitespace-only publishable key as missing, with a single issue", () => {
    const issues = expectIssues(parseSupabasePublicEnv(validSource({ [PUBLISHABLE_KEY]: "   " })));
    expect(issues).toEqual([{ key: PUBLISHABLE_KEY, problem: "is required" }]);
  });

  it("treats a whitespace-only URL as missing, with a single issue", () => {
    const issues = expectIssues(parseSupabasePublicEnv(validSource({ [URL_KEY]: "   " })));
    expect(issues).toEqual([{ key: URL_KEY, problem: "is required" }]);
  });

  it("reports every missing variable in one pass", () => {
    const issues = expectIssues(parseSupabasePublicEnv({}));
    expect(issues.map((issue) => issue.key)).toEqual([URL_KEY, PUBLISHABLE_KEY]);
  });
});

describe("parseSupabasePublicEnv: invalid URLs", () => {
  it("rejects a value that is not an absolute URL", () => {
    const issues = expectIssues(parseSupabasePublicEnv(validSource({ [URL_KEY]: "not a url" })));
    expect(issues).toEqual([{ key: URL_KEY, problem: "must be an absolute URL" }]);
  });

  it("rejects plain http for a remote host", () => {
    const issues = expectIssues(
      parseSupabasePublicEnv(validSource({ [URL_KEY]: "http://abcdefghijklmnop.supabase.co" })),
    );
    expect(issues[0].problem).toMatch(/must use https/);
  });

  it("rejects credentials embedded in the URL", () => {
    const issues = expectIssues(
      parseSupabasePublicEnv(validSource({ [URL_KEY]: "https://user:pass@abcdefghijklmnop.supabase.co" })),
    );
    expect(issues[0].problem).toBe("must not contain credentials");
  });

  it("rejects a URL with a path", () => {
    const issues = expectIssues(
      parseSupabasePublicEnv(validSource({ [URL_KEY]: `${VALID_URL}/rest/v1` })),
    );
    expect(issues[0].problem).toMatch(/project origin only/);
  });

  it("rejects a URL with a query string", () => {
    const issues = expectIssues(parseSupabasePublicEnv(validSource({ [URL_KEY]: `${VALID_URL}?x=1` })));
    expect(issues[0].problem).toMatch(/project origin only/);
  });
});

describe("checkPublishableKey: key classification", () => {
  it("accepts a well-formed publishable key", () => {
    expect(checkPublishableKey(VALID_PUBLISHABLE)).toBeNull();
  });

  it("rejects a secret key", () => {
    expect(checkPublishableKey(FAKE_SECRET)).toMatch(/secret key/);
  });

  it("rejects a publishable key with a body that is too short", () => {
    expect(checkPublishableKey("sb_publishable_short")).toBe("has an invalid publishable key format");
  });

  it("rejects a value in no recognised format", () => {
    expect(checkPublishableKey("random-string-value")).toBe("has an unrecognised format");
  });

  it("rejects a service-role JWT", () => {
    expect(checkPublishableKey(fakeJwt({ role: "service_role" }))).toMatch(/service-role key/);
  });

  it("rejects a JWT with an unsupported role", () => {
    expect(checkPublishableKey(fakeJwt({ role: "authenticated" }))).toBe("has an unsupported JWT role");
  });

  it("rejects a JWT whose payload is not JSON", () => {
    const notJson = Buffer.from("not json").toString("base64url");
    expect(checkPublishableKey(`eyJhbGc.${notJson}.sig`)).toBe("is not a valid JWT");
  });
});

describe("parseSupabasePublicEnv: secret safety", () => {
  it("never echoes an invalid value in its issues", () => {
    const secretLike = `${SECRET_PREFIX}DoNotEchoThisValue123456`;
    const issues = expectIssues(
      parseSupabasePublicEnv(
        validSource({ [URL_KEY]: "not a url DoNotEchoThisValue", [PUBLISHABLE_KEY]: secretLike }),
      ),
    );
    expect(JSON.stringify(issues)).not.toContain("DoNotEchoThisValue");
  });

  it("rejects a secret-named variable under the NEXT_PUBLIC_ prefix", () => {
    const issues = expectIssues(
      parseSupabasePublicEnv(validSource({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "anything" })),
    );
    expect(issues).toEqual([
      {
        key: "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
        problem: "must not be set: secret keys must never use a NEXT_PUBLIC_ name",
      },
    ]);
  });

  it("ignores an empty secret-named NEXT_PUBLIC variable", () => {
    expectOk(parseSupabasePublicEnv(validSource({ NEXT_PUBLIC_SUPABASE_SECRET: "" })));
  });
});
