"use client";

import { useActionState } from "react";

import { addNoteAction, type ActionState } from "@/modules/orders/workflow-actions";

import { ActionMessage } from "./action-message";
import { SubmitButton } from "./submit-button";

const INITIAL: ActionState = { ok: false, message: null };

export function AddNoteForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(addNoteAction, INITIAL);
  return (
    // React resets uncontrolled forms after a successful action, so the note box clears itself.
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="note-body" className="label">
        Add a note
      </label>
      <textarea id="note-body" name="body" required maxLength={2000} rows={3} className="input" />
      <SubmitButton label="Add note" variant="btn-ghost" />
      <ActionMessage ok={state.ok} message={state.message} />
    </form>
  );
}
