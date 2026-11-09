"use client";

import { useActionState, useMemo, useState } from "react";

import {
  distributeOrdersAction,
  reviewAssignmentAction,
  type DistributeState,
  type DistributionSummary,
  type ReviewState,
  type ReviewView,
} from "@/modules/distribution/actions";
import { normalizeProposal, type AssignmentMode } from "@/modules/distribution/domain/distribution";
import { REVIEW_REASON_LABELS, type ReviewRow } from "@/modules/distribution/domain/review";
import { formatDateTime, formatMad } from "@/modules/orders/format";

export type CandidateView = {
  id: string;
  orderRef: string;
  customerName: string | null;
  city: string;
  createdAt: string;
  total: number;
};
export type AgentView = { id: string; displayName: string; currentLoad: number };

const IDLE_REVIEW: ReviewState = { status: "idle" };
const IDLE_DISTRIBUTE: DistributeState = { status: "idle" };
const PAGE_SIZE = 100;

const MODES: { value: AssignmentMode; label: string; description: string }[] = [
  { value: "manual", label: "Manual", description: "Choose the agent for each order yourself, or assign many orders to one agent." },
  { value: "random", label: "Random", description: "A genuinely random draw across the selected agents. It does not balance workload." },
  { value: "balanced", label: "Smart Balanced", description: "Each order goes to the agent with the lowest projected workload. Ties are fixed." },
];

const MODE_LABEL: Record<AssignmentMode, string> = { manual: "Manual", random: "Random", balanced: "Smart Balanced" };

/**
 * Mode selection, order selection, agent choice, the editable preview, and confirmation.
 * The server decides what is eligible and builds every mapping. The browser only sends the admin's choices.
 */
export function DistributionCenter({
  candidates,
  total,
  truncated,
  agents,
}: {
  candidates: CandidateView[];
  total: number;
  truncated: boolean;
  agents: AgentView[];
}) {
  const [mode, setMode] = useState<AssignmentMode>("balanced");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [agentIds, setAgentIds] = useState<Set<string>>(() => new Set(agents.map((agent) => agent.id)));
  const [city, setCity] = useState("all");
  const [search, setSearch] = useState("");
  const [review, reviewAction, reviewPending] = useActionState(reviewAssignmentAction, IDLE_REVIEW);
  // Admin edits to the preview. Kept with the key of the review they belong to, so a new review starts clean.
  const [choiceState, setChoiceState] = useState<{ key: string; values: Record<string, string | null> }>({ key: "", values: {} });

  const candidateIds = useMemo(() => new Set(candidates.map((item) => item.id)), [candidates]);
  const selectedIds = useMemo(() => [...selected].filter((id) => candidateIds.has(id)).sort(), [selected, candidateIds]);
  const agentList = useMemo(() => [...agentIds].sort(), [agentIds]);
  const chosenAgents = useMemo(() => agents.filter((agent) => agentIds.has(agent.id)), [agents, agentIds]);
  const selectionKey = JSON.stringify([selectedIds, agentList]);
  const payload = JSON.stringify({ mode, orderIds: selectedIds, agentIds: agentList });

  const cities = useMemo(() => [...new Set(candidates.map((item) => item.city))].sort(), [candidates]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return candidates.filter(
      (item) => (city === "all" || item.city === city) && (query === "" || item.orderRef.toLowerCase().includes(query)),
    );
  }, [candidates, city, search]);
  const allMatchingSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id));

  const reviewed = review.status === "ready" || review.status === "empty" ? review.review : null;
  const stale = reviewed !== null && (reviewed.mode !== mode || reviewed.selectionKey !== selectionKey);
  const current = reviewed !== null && !stale ? reviewed : null;

  const draftRows: ReviewRow[] = useMemo(
    () =>
      candidates
        .filter((item) => selected.has(item.id))
        .map((item) => ({
          orderId: item.id,
          orderRef: item.orderRef,
          customerName: item.customerName,
          currentAgentName: null,
          proposedAgentId: null,
          proposedAgentName: null,
          status: "unassigned" as const,
          reason: "no_agent",
          editable: true,
        })),
    [candidates, selected],
  );
  const rows = current !== null ? current.rows : draftRows;
  const editorKey = current !== null ? current.batchKey : `draft-${mode}`;
  const choices = useMemo<Record<string, string | null>>(() => (choiceState.key === editorKey ? choiceState.values : {}), [choiceState, editorKey]);

  const effective = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of rows) {
      const value = row.editable && row.orderId in choices ? (choices[row.orderId] ?? null) : row.proposedAgentId;
      // An agent that is no longer selected cannot be shown in the dropdown, so it is never sent. It shows as unassigned.
      map.set(row.orderId, value !== null && agentIds.has(value) ? value : null);
    }
    return map;
  }, [rows, choices, agentIds]);

  const editableEntries = rows
    .filter((row) => row.editable)
    .map((row) => ({ orderId: row.orderId, agentId: effective.get(row.orderId) ?? null }));
  const dirty = current !== null && normalizeProposal(editableEntries) !== current.basis;
  const proposalJson = JSON.stringify(editableEntries);
  const liveAdded = new Map<string, number>();
  for (const entry of editableEntries) {
    if (entry.agentId !== null) liveAdded.set(entry.agentId, (liveAdded.get(entry.agentId) ?? 0) + 1);
  }

  function toggleOrder(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllMatching() {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of filtered) next.add(item.id);
      return next;
    });
  }

  function toggleAgent(id: string) {
    setAgentIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function choose(ids: string[], agentId: string | null) {
    setChoiceState((previous) => {
      const base = previous.key === editorKey ? previous.values : {};
      const values = { ...base };
      for (const id of ids) values[id] = agentId;
      return { key: editorKey, values };
    });
  }

  const disabled = selectedIds.length === 0 || agentList.length === 0 || reviewPending;
  const canConfirm = current !== null && review.status === "ready" && !dirty;

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-4" aria-label="Assignment mode">
        <div role="group" aria-label="Assignment mode" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={mode === item.value}
              onClick={() => setMode(item.value)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
                mode === item.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="muted mt-3 text-sm">{MODES.find((item) => item.value === mode)?.description}</p>
      </section>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Eligible orders" value={total} />
        <Stat label="Matching filters" value={filtered.length} />
        <Stat label="Selected" value={selectedIds.length} />
        <Stat label="Agents chosen" value={agentList.length} />
      </dl>

      {truncated ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Only the first 2,000 eligible orders are loaded. Distribute the rest in a later batch.
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <section className="card p-6">
          <p className="text-sm font-medium">No orders are waiting for assignment.</p>
          <p className="muted mt-1 text-sm">
            Only new orders with no assignee appear here. Assigned, confirmed, cancelled and historical orders are not included.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="card p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                City
                <select className="input py-1.5 text-sm" value={city} onChange={(event) => setCity(event.target.value)}>
                  <option value="all">All cities</option>
                  {cities.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Order reference
                <input className="input py-1.5 text-sm" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="BRX-" />
              </label>
              <button type="button" className="btn btn-ghost text-sm" onClick={selectAllMatching} disabled={filtered.length === 0 || allMatchingSelected}>
                Select all matching ({filtered.length})
              </button>
              <button type="button" className="btn btn-ghost text-sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Clear selection
              </button>
            </div>
            <div className="mt-4 max-h-96 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Select</span></th>
                    <th scope="col" className="px-3 py-2 font-semibold">Order ID</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Customer</th>
                    <th scope="col" className="px-3 py-2 font-semibold">City</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Created</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Select ${item.orderRef}`} checked={selected.has(item.id)} onChange={() => toggleOrder(item.id)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{item.orderRef}</td>
                      <td className="px-3 py-2">{item.customerName ?? "—"}</td>
                      <td className="px-3 py-2">{item.city}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDateTime(item.createdAt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMad(item.total)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="muted px-3 py-6 text-center text-sm">No orders match these filters.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold">Agents</h2>
            <p className="muted mt-1 text-xs">Only active agents appear. Workload counts New, No Answer and Called orders.</p>
            <ul className="mt-4 space-y-3">
              {agents.map((agent) => (
                <li key={agent.id} className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={agentIds.has(agent.id)} onChange={() => toggleAgent(agent.id)} />
                    {agent.displayName}
                  </label>
                  <span className="muted text-xs tabular-nums">{agent.currentLoad} active</span>
                </li>
              ))}
              {agents.length === 0 ? <li className="muted text-sm">No active agents. Activate an agent before assigning.</li> : null}
            </ul>
          </section>
        </div>
      )}

      {candidates.length > 0 ? (
        <section className="card flex flex-col gap-5 p-5" aria-labelledby="preview-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="preview-title" className="text-sm font-semibold">Preview</h2>
            <p className="muted text-xs">Nothing is written until you confirm below.</p>
          </div>

          <form action={reviewAction} className="flex flex-col gap-4">
            <input type="hidden" name="payload" value={payload} />
            <input type="hidden" name="proposal" value={proposalJson} />

            {rows.length === 0 ? (
              <p className="muted text-sm">Select orders above to build a preview.</p>
            ) : (
              <ProposalEditor
                key={editorKey}
                rows={rows}
                agents={chosenAgents}
                effective={effective}
                onChoose={choose}
              />
            )}

            <div className="flex flex-wrap items-center gap-3">
              {mode !== "manual" ? (
                <button type="submit" name="intent" value="generate" className="btn btn-ghost" disabled={disabled}>
                  {mode === "random" ? (current !== null ? "Generate a new random mapping" : "Generate random mapping") : "Recalculate balanced plan"}
                </button>
              ) : null}
              <button type="submit" name="intent" value="review" className="btn btn-primary" disabled={disabled}>
                {mode === "manual" ? "Review assignments" : "Check my edits"}
              </button>
              {reviewPending ? <span className="muted text-sm" aria-live="polite">Building review…</span> : null}
            </div>
          </form>

          {review.status === "error" ? <div className="alert-error" role="alert">{review.message}</div> : null}

          {stale ? (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              The mode, orders or agents changed after this review. Review again before you confirm.
            </div>
          ) : null}

          {current !== null && dirty ? (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              You changed the proposed assignments. Check your edits before you confirm.
            </div>
          ) : null}
          {current !== null && review.status === "empty" ? (
            <p className="text-sm font-medium">No order can be assigned with this selection. Read the status column for the reasons.</p>
          ) : null}

          {current !== null ? (
            <>
              <WorkloadBars agents={chosenAgents} added={liveAdded} title={`Workload: ${MODE_LABEL[current.mode]} plan`} />
              <Summary review={current} />
            </>
          ) : rows.length > 0 ? (
            <WorkloadBars agents={chosenAgents} added={liveAdded} title="Current workload" />
          ) : null}

          {canConfirm && current !== null ? (
            <ConfirmDistribution key={current.batchKey} review={current} />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <dt className="muted text-xs">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Summary({ review }: { review: ReviewView }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <span><strong>{review.proposedCount}</strong> to assign</span>
      <span><strong>{review.unassignedCount}</strong> left unassigned</span>
      <span><strong>{review.skippedCount}</strong> skipped</span>
      {review.unavailableAgentCount > 0 ? <span>{review.unavailableAgentCount} chosen agents not active</span> : null}
      {review.duplicatesIgnored > 0 ? <span>{review.duplicatesIgnored} repeated selections ignored</span> : null}
    </div>
  );
}

function statusFor(row: ReviewRow, effectiveAgent: string | null): { label: string; tone: string } {
  if (!row.editable) {
    return { label: REVIEW_REASON_LABELS[row.reason ?? ""] ?? "Skipped", tone: "border-slate-200 bg-slate-100 text-slate-600" };
  }
  if (effectiveAgent === null) {
    return {
      label: row.reason === "agent_unavailable" ? "Agent not active" : "Needs an agent",
      tone: "border-amber-300 bg-amber-50 text-amber-900",
    };
  }
  if (effectiveAgent !== row.proposedAgentId) {
    return { label: "Changed", tone: "border-violet-200 bg-violet-50 text-violet-800" };
  }
  return { label: "Proposed", tone: "border-blue-200 bg-blue-50 text-blue-800" };
}

/** Presentational table: the admin changes agents here. State lives in the parent, so the dirty check can see it. */
function ProposalEditor({
  rows,
  agents,
  effective,
  onChoose,
}: {
  rows: ReviewRow[];
  agents: AgentView[];
  effective: Map<string, string | null>;
  onChoose: (ids: string[], agentId: string | null) => void;
}) {
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [bulkAgent, setBulkAgent] = useState("");

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const checkedEditable = rows.filter((row) => row.editable && checked.has(row.orderId)).map((row) => row.orderId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Bulk agent for selected rows
          <select className="input py-1.5 text-sm" value={bulkAgent} onChange={(event) => setBulkAgent(event.target.value)}>
            <option value="">Choose an agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.displayName}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost text-sm" disabled={checkedEditable.length === 0 || bulkAgent === ""} onClick={() => onChoose(checkedEditable, bulkAgent)}>
          Assign {checkedEditable.length} selected
        </button>
        <button type="button" className="btn btn-ghost text-sm" disabled={checkedEditable.length === 0} onClick={() => onChoose(checkedEditable, null)}>
          Unassign selected
        </button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}>Previous</button>
          <span className="muted tabular-nums">Page {safePage + 1} of {pageCount}</span>
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1}>Next</button>
        </div>
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Select</span></th>
              <th scope="col" className="px-3 py-2 font-semibold">Order ID</th>
              <th scope="col" className="px-3 py-2 font-semibold">Customer</th>
              <th scope="col" className="px-3 py-2 font-semibold">Current agent</th>
              <th scope="col" className="px-3 py-2 font-semibold">Proposed agent</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((row) => {
              const agentId = effective.get(row.orderId) ?? null;
              const status = statusFor(row, agentId);
              return (
                <tr key={row.orderId} className="align-middle hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {row.editable ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.orderRef}`}
                        checked={checked.has(row.orderId)}
                        onChange={() =>
                          setChecked((previous) => {
                            const next = new Set(previous);
                            if (next.has(row.orderId)) next.delete(row.orderId);
                            else next.add(row.orderId);
                            return next;
                          })
                        }
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{row.orderRef}</td>
                  <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{row.currentAgentName ?? "Unassigned"}</td>
                  <td className="px-3 py-2">
                    {row.editable ? (
                      <select
                        aria-label={`Agent for ${row.orderRef}`}
                        className="input py-1 text-sm"
                        value={agentId ?? ""}
                        onChange={(event) => onChoose([row.orderId], event.target.value === "" ? null : event.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.displayName}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Workload per agent: current (grey) and new orders (blue), on one scale. */
function WorkloadBars({ agents, added, title }: { agents: AgentView[]; added: Map<string, number>; title: string }) {
  const projected = agents.map((agent) => agent.currentLoad + (added.get(agent.id) ?? 0));
  const maxLoad = Math.max(1, ...projected);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{title}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> Current</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> New</span>
      </div>
      <ul className="space-y-3">
        {agents.map((agent, index) => {
          const newOrders = added.get(agent.id) ?? 0;
          const currentPct = (agent.currentLoad / maxLoad) * 100;
          const addedPct = (newOrders / maxLoad) * 100;
          return (
            <li key={agent.id} className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)_auto] md:items-center">
              <span className="text-sm font-medium">{agent.displayName}</span>
              <div
                className="relative h-3 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={`${agent.displayName}: ${agent.currentLoad} now, ${newOrders} new, ${projected[index] ?? 0} after`}
              >
                <div className="absolute inset-y-0 left-0 bg-slate-400" style={{ width: `${currentPct}%` }} />
                <div className="absolute inset-y-0 bg-blue-600" style={{ left: `${currentPct}%`, width: `${addedPct}%` }} />
              </div>
              <span className="text-xs tabular-nums text-slate-700">
                {agent.currentLoad} → <strong>{projected[index] ?? 0}</strong> <span className="muted">(+{newOrders})</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Keyed by batch key, so each new review starts with a fresh confirmation state. */
function ConfirmDistribution({ review }: { review: ReviewView }) {
  const [state, action, pending] = useActionState(distributeOrdersAction, IDLE_DISTRIBUTE);
  const count = review.proposedCount;

  return (
    <form action={action} className="flex flex-col gap-3 border-t border-slate-200 pt-5">
      <h3 className="text-sm font-semibold">Confirm and write</h3>
      <p className="text-sm">
        You are approving exactly <strong>{count}</strong> {count === 1 ? "assignment" : "assignments"} in{" "}
        <strong>{MODE_LABEL[review.mode]}</strong> mode. Each one is recorded under your admin account, and the mapping shown above is written as-is.
      </p>
      <input type="hidden" name="batchKey" value={review.batchKey} />
      <input type="hidden" name="plan" value={review.planJson} />
      <input type="hidden" name="mode" value={review.mode} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required className="mt-1" disabled={pending || state.status === "done"} />
        <span>I have reviewed this mapping and approve it. Orders changed since the review will be skipped, not overwritten.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || state.status === "done"}>
          {pending ? "Writing batch…" : `Distribute ${count} ${count === 1 ? "order" : "orders"}`}
        </button>
        <p aria-live="polite" className="muted text-sm">
          {pending ? "Writing the batch in one transaction. Keep this page open." : null}
        </p>
      </div>
      {state.status === "error" ? <p role="alert" className="alert-error">{state.message}</p> : null}
      {state.status === "done" ? <ResultSummary result={state.result} /> : null}
    </form>
  );
}

function ResultSummary({ result }: { result: DistributionSummary }) {
  return (
    <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-4" role="status" aria-live="polite">
      <h3 className="text-sm font-semibold text-emerald-900">
        {result.replayed ? "This batch was already applied. Showing the stored result." : `${MODE_LABEL[result.mode]} distribution complete`}
      </h3>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div><dt className="text-xs text-emerald-800">Assigned</dt><dd className="text-xl font-semibold tabular-nums">{result.assigned}</dd></div>
        <div><dt className="text-xs text-emerald-800">Skipped</dt><dd className="text-xl font-semibold tabular-nums">{result.skipped}</dd></div>
        <div><dt className="text-xs text-emerald-800">Failed</dt><dd className="text-xl font-semibold tabular-nums">{result.failed}</dd></div>
      </dl>
      {result.reasons.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-emerald-900">
          {result.reasons.map((item) => (
            <li key={item.reason}>{item.count} skipped: {REVIEW_REASON_LABELS[item.reason] ?? "Not assigned"}</li>
          ))}
        </ul>
      ) : null}
      <p className="muted mt-3 text-xs">Batch {result.batchId.slice(0, 8)}. Each assignment is recorded in the order history.</p>
    </section>
  );
}
