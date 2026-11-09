"use client";

import { useRef, useState } from "react";

import {
  cancelOrderAction,
  confirmOrderAction,
  recordCallAction,
  type ActionState,
} from "@/modules/orders/workflow-actions";
import { CANCEL_REASON_LABELS } from "@/modules/orders/format";

import { ActionMessage } from "./action-message";
import { useOrderTransition } from "./order-transition";
import { SubmitButton } from "./submit-button";

const INITIAL: ActionState = { ok: false, message: null };

export type AvailableActions = { answer: boolean; noAnswer: boolean; confirm: boolean; cancel: boolean };

/** Each form submits its own action. A finishing action that succeeds hands over to the next order through the page's transition. */
export function AgentOrderActions({
  orderId,
  expectedVersion,
  available,
  nextHref,
}: {
  orderId: string;
  expectedVersion: number;
  available: AvailableActions;
  nextHref: string;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <CallForm orderId={orderId} expectedVersion={expectedVersion} available={available} nextHref={nextHref} />
      <ConfirmForm orderId={orderId} expectedVersion={expectedVersion} enabled={available.confirm} nextHref={nextHref} />
      <CancelForm orderId={orderId} expectedVersion={expectedVersion} enabled={available.cancel} nextHref={nextHref} />
    </div>
  );
}

function CallForm({
  orderId,
  expectedVersion,
  available,
  nextHref,
}: {
  orderId: string;
  expectedVersion: number;
  available: AvailableActions;
  nextHref: string;
}) {
  const leave = useOrderTransition();
  const [result, setResult] = useState<ActionState>(INITIAL);
  // One key per user action. A retry of the same outcome reuses it, so the server replays instead of recording
  // a second call. Keys are kept on the client and cleared after success.
  const keysByOutcome = useRef<Record<string, string>>({});

  async function submit(formData: FormData) {
    const outcome = String(formData.get("outcome") ?? "");
    let key = keysByOutcome.current[outcome];
    if (key === undefined) {
      key = crypto.randomUUID();
      keysByOutcome.current[outcome] = key;
    }
    formData.set("idempotencyKey", key);
    const next = await recordCallAction(INITIAL, formData);
    setResult(next);
    if (next.ok) keysByOutcome.current = {};
    // The third unanswered call cancels the order. The server reports that, so the page moves on to the next order.
    if (next.ok && next.finished) leave(nextHref);
  }

  return (
    <form action={submit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">Record a call</h2>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="outcome" value="answered" label="Customer answered" variant="btn-primary" disabled={!available.answer} />
        <SubmitButton name="outcome" value="no_answer" label="No answer" variant="btn-ghost" disabled={!available.noAnswer} />
      </div>
      <p className="muted text-xs">Three unanswered calls cancel the order automatically.</p>
      <ActionMessage ok={result.ok} message={result.message} />
    </form>
  );
}

function ConfirmForm({
  orderId,
  expectedVersion,
  enabled,
  nextHref,
}: {
  orderId: string;
  expectedVersion: number;
  enabled: boolean;
  nextHref: string;
}) {
  const leave = useOrderTransition();
  const [result, setResult] = useState<ActionState>(INITIAL);

  async function submit(formData: FormData) {
    const next = await confirmOrderAction(INITIAL, formData);
    setResult(next);
    if (next.ok) leave(nextHref);
  }

  return (
    <form action={submit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">Confirm order</h2>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <p className="muted text-xs">Available once the customer has answered.</p>
      <SubmitButton label="Confirm order" disabled={!enabled} />
      <ActionMessage ok={result.ok} message={result.message} />
    </form>
  );
}

function CancelForm({
  orderId,
  expectedVersion,
  enabled,
  nextHref,
}: {
  orderId: string;
  expectedVersion: number;
  enabled: boolean;
  nextHref: string;
}) {
  const leave = useOrderTransition();
  const [result, setResult] = useState<ActionState>(INITIAL);
  const reasonId = `reason-${orderId}`;

  async function submit(formData: FormData) {
    const next = await cancelOrderAction(INITIAL, formData);
    setResult(next);
    if (next.ok) leave(nextHref);
  }

  return (
    <form action={submit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">Cancel order</h2>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <label htmlFor={reasonId} className="label">
        Reason
      </label>
      <select id={reasonId} name="reason" required className="input" disabled={!enabled} defaultValue="refused">
        <option value="refused">{CANCEL_REASON_LABELS.refused}</option>
        <option value="requested_by_customer">{CANCEL_REASON_LABELS.requested_by_customer}</option>
        <option value="other">{CANCEL_REASON_LABELS.other}</option>
      </select>
      <SubmitButton label="Cancel order" variant="btn-ghost" disabled={!enabled} />
      <ActionMessage ok={result.ok} message={result.message} />
    </form>
  );
}
