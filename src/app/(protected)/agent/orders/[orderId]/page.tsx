import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { requireArea } from "@/modules/auth/guards";
import { getAgentOrderView, getRepeatCustomerCounts } from "@/modules/orders/agent-queries";
import { CANCEL_REASON_LABELS, describeEvent, formatDateTime, formatMad } from "@/modules/orders/format";
import { orderActions } from "@/modules/orders/workflow-view";
import { assessOrder } from "@/modules/rescue/domain/priority";

import { AddNoteForm } from "../../../_components/add-note-form";
import { AgentOrderActions } from "../../../_components/agent-order-actions";
import { RescueContextPanel } from "../../../_components/rescue-ui";

const orderIdSchema = z.uuid();

/** Synchronous page: the session read and the order lookup happen inside the Suspense boundary. */
export default function AgentOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  return (
    <Suspense
      fallback={
        <section className="card max-w-3xl p-6" aria-busy="true" aria-live="polite">
          <p className="muted text-sm">Loading order…</p>
        </section>
      }
    >
      <AgentOrderDetail params={params} />
    </Suspense>
  );
}

async function AgentOrderDetail({ params }: { params: Promise<{ orderId: string }> }) {
  const user = await requireArea("agent");
  const { orderId } = await params;
  if (!orderIdSchema.safeParse(orderId).success) notFound();

  const view = await getAgentOrderView(orderId);
  if (view.status === "error") {
    return (
      <div className="alert-error max-w-3xl" role="alert">
        This order could not be loaded. Refresh the page to try again.
      </div>
    );
  }
  // Not found and not assigned to this user both return the same 404, so existence is not revealed.
  if (view.status === "not_found" || view.order.assigned_agent_id !== user.id) notFound();

  const { order, items, attempts, events, notes } = view;
  const isHistorical = order.pipeline_status === null;
  const actions = orderActions(order.pipeline_status, order.unanswered_attempt_count);
  const repeat = await getRepeatCustomerCounts(order.id);
  const assessment = assessOrder(
    {
      orderId: order.id,
      orderRef: order.source_order_id,
      status: order.pipeline_status,
      unansweredAttemptCount: order.unanswered_attempt_count,
      createdAt: order.source_created_at,
      lastAttemptAt: attempts[0]?.attempted_at ?? null,
      history: repeat,
      assignedAgentId: order.assigned_agent_id,
    },
    new Date(),
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <Link href="/agent" className="muted text-sm underline-offset-2 hover:underline">
          ← Your orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold tracking-tight">{order.source_order_id}</h1>
          <span className="badge">{order.pipeline_status ?? order.source_status}</span>
          <span className="muted text-sm">Unanswered calls: {order.unanswered_attempt_count}</span>
          {order.cancel_reason !== null ? (
            <span className="muted text-sm">
              Reason: {CANCEL_REASON_LABELS[order.cancel_reason] ?? "Recorded"}
            </span>
          ) : null}
        </div>
      </div>

      {repeat === null ? (
        <div role="note" className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-800">
          <p className="font-semibold">Earlier order history is unavailable right now</p>
          <p className="mt-1">Check the details before you call.</p>
        </div>
      ) : repeat.refused + repeat.cancelled > 0 ? (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Earlier orders for this phone number</p>
          <p className="mt-1">
            {repeat.refused > 0 ? `${repeat.refused} refused` : null}
            {repeat.refused > 0 && repeat.cancelled > 0 ? " and " : null}
            {repeat.cancelled > 0 ? `${repeat.cancelled} cancelled` : null}
            . Check the details before you call.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">Customer</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="muted text-xs">Name</dt>
              <dd>{order.customer.display_name}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Phone</dt>
              <dd className="font-mono">{order.customer.phone_e164}</dd>
            </div>
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold">Shipping</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="muted text-xs">City</dt>
              <dd>{order.shipping_city}</dd>
            </div>
            <div>
              <dt className="muted text-xs">District</dt>
              <dd>{order.shipping_district}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Address</dt>
              <dd>{order.shipping_address1}</dd>
            </div>
          </dl>
        </section>
      </div>

      <RescueContextPanel assessment={assessment} />

      <section className="card overflow-x-auto">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold">Items and amount</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-2 font-semibold">SKU</th>
              <th scope="col" className="px-5 py-2 font-semibold">Product</th>
              <th scope="col" className="px-5 py-2 text-right font-semibold">Qty</th>
              <th scope="col" className="px-5 py-2 text-right font-semibold">Unit price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.line_no}>
                <td className="px-5 py-2 font-mono text-xs">{item.sku}</td>
                <td className="px-5 py-2">{item.title}</td>
                <td className="px-5 py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="px-5 py-2 text-right tabular-nums">{formatMad(item.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid max-w-xs gap-1 px-5 py-4 text-sm">
          <div className="flex justify-between"><dt className="muted">Subtotal</dt><dd className="tabular-nums">{formatMad(order.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="muted">Shipping</dt><dd className="tabular-nums">{formatMad(order.shipping_fee)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMad(order.total)}</dd></div>
        </dl>
      </section>

      {isHistorical ? (
        <p className="card p-5 text-sm">This historical order is outside the confirmation pipeline. No calls can be recorded.</p>
      ) : (
        <AgentOrderActions
          orderId={order.id}
          expectedVersion={order.version}
          available={{ answer: actions.answer, noAnswer: actions.noAnswer, confirm: actions.confirm, cancel: actions.cancel }}
        />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">Notes</h2>
          <div className="mt-4">
            <AddNoteForm orderId={order.id} />
          </div>
          <ul className="mt-5 space-y-3 text-sm">
            {notes.length === 0 ? <li className="muted">No notes yet.</li> : null}
            {notes.map((note) => (
              <li key={note.id} className="rounded-md bg-slate-50 p-3">
                <p className="whitespace-pre-wrap">{note.body}</p>
                <p className="muted mt-1 text-xs">{formatDateTime(note.created_at)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold">Call history</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {attempts.length === 0 ? <li className="muted">No calls recorded yet.</li> : null}
            {attempts.map((attempt) => (
              <li key={attempt.id} className="flex justify-between gap-3">
                <span>{attempt.outcome === "answered" ? "Answered" : "No answer"}</span>
                <span className="muted text-xs">
                  {formatDateTime(attempt.attempted_at)} · unanswered {attempt.unanswered_attempt_count_after}
                </span>
              </li>
            ))}
          </ul>

          <h2 className="mt-6 text-sm font-semibold">Audit timeline</h2>
          <ol className="mt-4 space-y-2 border-l border-slate-200 pl-4 text-sm">
            {events.length === 0 ? <li className="muted">No events yet.</li> : null}
            {events.map((event) => (
              <li key={event.id}>
                <p>{describeEvent(event.event_type)}</p>
                <p className="muted text-xs">{formatDateTime(event.created_at)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
