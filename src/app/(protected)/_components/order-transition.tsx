"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/** Time the exit transition plays before the router opens the next order. Matches .od-leaving in globals.css. */
const LEAVE_MS = 380;

type Leave = (nextHref: string) => void;

const OrderTransitionContext = createContext<Leave | null>(null);

/**
 * Owns the exit transition for one order page. State lives in React, not in the DOM, so nothing is left behind
 * when the next order renders. Render it with key={orderId} so each order starts with a fresh transition.
 */
export function OrderTransition({ className, children }: { className: string; children: ReactNode }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);

  const leave = useCallback<Leave>(
    (nextHref) => {
      if (started.current) return;
      started.current = true;
      setLeaving(true);
      window.setTimeout(() => router.push(nextHref), LEAVE_MS);
    },
    [router],
  );
  const value = useMemo(() => leave, [leave]);

  return (
    <OrderTransitionContext.Provider value={value}>
      <div className={leaving ? `${className} od-leaving` : className}>{children}</div>
    </OrderTransitionContext.Provider>
  );
}

/** Call from an event handler once a finishing action succeeds. Throws if used outside OrderTransition. */
export function useOrderTransition(): Leave {
  const leave = useContext(OrderTransitionContext);
  if (leave === null) throw new Error("useOrderTransition must be used inside OrderTransition");
  return leave;
}
