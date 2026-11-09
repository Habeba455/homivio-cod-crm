import { Suspense } from "react";
import { redirect } from "next/navigation";

import { homePathFor } from "@/modules/auth/roles";
import { getCurrentUser } from "@/modules/auth/session";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="brand text-2xl">Homivio</p>
          <p className="muted mt-1 text-sm">COD order confirmation console</p>
        </div>
        <div className="card p-7">
          <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="muted mb-6 text-sm">Use the account your administrator created for you.</p>
          <Suspense fallback={<p className="muted text-sm">Checking your session…</p>}>
            <LoginGate />
          </Suspense>
        </div>
        <p className="muted mt-6 text-center text-xs">Access is limited to authorised Homivio staff.</p>
      </div>
    </main>
  );
}

/** Signed-in users with an active profile are sent to their area. Everyone else sees the form. */
async function LoginGate() {
  const user = await getCurrentUser();
  if (user !== null) {
    redirect(homePathFor(user.role));
  }
  return <LoginForm />;
}
