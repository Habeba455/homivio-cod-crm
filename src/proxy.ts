import { NextResponse, type NextRequest } from "next/server";

import { refreshSession } from "@/lib/supabase/refresh-session";
import { decideProxyRedirect } from "@/modules/auth/proxy-decision";

/**
 * Session refresh and optimistic redirects only. Authorization happens on the server and in RLS.
 * Cookies rotated while validating the session are copied onto any redirect response.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { response, hasSession } = await refreshSession(request);

  const target = decideProxyRedirect(request.nextUrl.pathname, hasSession);
  if (target === null) {
    return response;
  }

  const redirect = NextResponse.redirect(new URL(target, request.url));
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
