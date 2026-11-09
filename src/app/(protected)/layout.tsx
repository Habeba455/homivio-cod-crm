import { Suspense, type ReactNode } from "react";

import { signOut } from "@/modules/auth/actions";
import { requireUser } from "@/modules/auth/guards";

import { AdminShell } from "./_components/admin-shell";
import { navigationFor } from "./_components/navigation";

/**
 * Every protected route passes through here. The session is read at request time behind Suspense,
 * as Cache Components requires. Each page also checks its own area with requireArea().
 * Every role gets the same dark shell, so the agent and admin screens share one template.
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
  const nav = navigationFor(user.role);
  const signOutForm = (
    <form action={signOut}>
      <button type="submit" className="adm-signout">
        Sign out
      </button>
    </form>
  );

  return (
    <AdminShell items={nav.items} user={{ displayName: user.displayName, role: user.role }} signOutForm={signOutForm}>
      {children}
    </AdminShell>
  );
}
