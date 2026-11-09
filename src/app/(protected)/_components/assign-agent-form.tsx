"use client";

import { useActionState } from "react";

import { assignOrderAction, type ActionState } from "@/modules/orders/workflow-actions";

import { ActionMessage } from "./action-message";
import { SubmitButton } from "./submit-button";

const INITIAL: ActionState = { ok: false, message: null };

export function AssignAgentForm({
  orderId,
  expectedVersion,
  currentAgentId,
  agents,
}: {
  orderId: string;
  expectedVersion: number;
  currentAgentId: string | null;
  agents: { id: string; displayName: string }[];
}) {
  const [state, formAction] = useActionState(assignOrderAction, INITIAL);
  const selectId = `agent-${orderId}`;

  return (
    // The key remounts the form when the stored assignment or version changes, so the select shows the latest value.
    <form key={`${currentAgentId ?? "none"}-${expectedVersion}`} action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <label htmlFor={selectId} className="sr-only">
        Choose agent
      </label>
      <select
        id={selectId}
        name="agentId"
        required
        defaultValue={currentAgentId ?? ""}
        className="input py-1.5 text-sm"
      >
        <option value="" disabled>
          Choose an agent
        </option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id} disabled={agent.id === currentAgentId}>
            {agent.displayName}
          </option>
        ))}
      </select>
      <SubmitButton label={currentAgentId === null ? "Assign" : "Reassign"} pendingLabel="Saving…" />
      <div className="basis-full">
        <ActionMessage ok={state.ok} message={state.message} />
      </div>
    </form>
  );
}
