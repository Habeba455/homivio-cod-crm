import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { requireUser } from "@/modules/auth/guards";
import { canAccessArea } from "@/modules/auth/roles";
import { signOut } from "@/modules/auth/actions";

/**
 * Every protected route passes through here. The session is read at request time behind Suspense,
 * as Cache Components requires. Each page also checks its own area with requireArea().
 */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
      <ProtectedShell>{children}</ProtectedShell>
    </Suspense>
  );
}

async function ProtectedShell({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="app-header">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="brand">
            Homivio
          </Link>
          <nav aria-label="Main" className="flex items-center gap-4 text-sm font-medium">
            {canAccessArea(user.role, "admin") ? <Link href="/admin">Admin</Link> : null}
            {canAccessArea(user.role, "admin") ? <Link href="/admin/rescue">Rescue queue</Link> : null}
            {canAccessArea(user.role, "admin") ? <Link href="/admin/distribution">Distribution</Link> : null}
            {canAccessArea(user.role, "admin") ? <Link href="/admin/analytics">Analytics</Link> : null}
            <Link href="/agent">Rescue Center</Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold">{user.displayName}</p>
            <span className="badge">{user.role}</span>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
