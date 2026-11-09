import { Suspense } from "react";

import { requireArea } from "@/modules/auth/guards";

/** Synchronous page: the request-time session read happens inside the Suspense boundary, never above it. */
export default function AgentPage() {
  return (
    <Suspense fallback={<section className="card max-w-2xl p-6" aria-busy="true" />}>
      <AgentContent />
    </Suspense>
  );
}

async function AgentContent() {
  const user = await requireArea("agent");

  return (
    <section className="card max-w-2xl p-6">
      <h1 className="text-xl font-semibold tracking-tight">Agent workspace</h1>
      <p className="muted mt-2 text-sm">Signed in as {user.displayName}. Your assigned orders appear here in Phase I-6.</p>
    </section>
  );
}
