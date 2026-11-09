/**
 * Optimistic redirect for proxy.ts: anonymous visitors go to login.
 * This is NOT the authorization boundary. Every protected page re-checks the session and the profile role on the server (guards.ts), and RLS enforces row access.
 *
 * The proxy does not redirect signed-in users away from /login. A session can be valid while the profile is missing or
 * deactivated. Redirecting on session alone would loop: /login -> protected page -> /login. The login page decides
 * with the same profile check the guards use.
 */
export const LOGIN_PATH = "/login";
export const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/agent"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Returns the path to redirect to, or null to let the request continue. */
export function decideProxyRedirect(pathname: string, hasSession: boolean): string | null {
  return !hasSession && isProtectedPath(pathname) ? LOGIN_PATH : null;
}
