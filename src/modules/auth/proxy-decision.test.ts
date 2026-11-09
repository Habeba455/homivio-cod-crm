import { describe, expect, it } from "vitest";

import { decideProxyRedirect, isProtectedPath } from "./proxy-decision";

describe("isProtectedPath", () => {
  it("protects the application areas and their sub-paths", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/admin/orders/123")).toBe(true);
    expect(isProtectedPath("/agent")).toBe(true);
  });

  it("does not protect public paths or look-alike prefixes", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/administrator")).toBe(false);
    expect(isProtectedPath("/agents-public")).toBe(false);
  });
});

describe("decideProxyRedirect", () => {
  it("sends anonymous visitors from protected paths to login", () => {
    expect(decideProxyRedirect("/admin", false)).toBe("/login");
    expect(decideProxyRedirect("/agent/queue", false)).toBe("/login");
  });

  it("lets anonymous visitors reach login and public paths", () => {
    expect(decideProxyRedirect("/login", false)).toBeNull();
    expect(decideProxyRedirect("/", false)).toBeNull();
  });

  it("lets a visitor with a session reach protected paths", () => {
    expect(decideProxyRedirect("/admin", true)).toBeNull();
  });

  it("does not redirect a session holder away from login, so a profile-less account cannot loop", () => {
    expect(decideProxyRedirect("/login", true)).toBeNull();
  });
});
