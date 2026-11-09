import { Suspense } from "react";
import { redirect } from "next/navigation";

import { homePathFor } from "@/modules/auth/roles";
import { getCurrentUser } from "@/modules/auth/session";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="lg">
      <span className="lg-orb lg-orb-a" aria-hidden="true" />
      <span className="lg-orb lg-orb-b" aria-hidden="true" />
      <div className="lg-wrap">
        <div className="lg-brand">
          <span className="lg-mark" aria-hidden="true">H</span>
          <div className="text-center">
            <p className="lg-name">Homivio</p>
            <p className="lg-sub">COD order confirmation console</p>
          </div>
        </div>
        <div className="lg-card">
          <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="muted mb-6 text-sm">Use the account your administrator created for you.</p>
          <Suspense fallback={<p className="muted text-sm">Checking your session…</p>}>
            <LoginGate />
          </Suspense>
        </div>
        <p className="lg-foot">Access is limited to authorised Homivio staff.</p>
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
