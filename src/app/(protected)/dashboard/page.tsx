import { Suspense } from "react";
import { redirect } from "next/navigation";

import { requireUser } from "@/modules/auth/guards";
import { homePathFor } from "@/modules/auth/roles";

/** Synchronous page: the request-time session read happens inside the Suspense boundary, never above it. */
export default function DashboardPage() {
  return (
    <Suspense fallback={<section className="card max-w-2xl p-6" aria-busy="true" />}>
      <DashboardRedirect />
    </Suspense>
  );
}

async function DashboardRedirect(): Promise<null> {
  const user = await requireUser();
  redirect(homePathFor(user.role));
}
