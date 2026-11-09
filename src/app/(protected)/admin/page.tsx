import Link from "next/link";
import { Suspense } from "react";

import { cityFilterLabel } from "@/modules/analytics/domain/cities";
import { requireArea } from "@/modules/auth/guards";
import { formatDateTime, formatMad } from "@/modules/orders/format";
import { ORDER_STATUS_FILTERS, parseOrderFilters, type OrderListFilters, type OrderStatusFilter } from "@/modules/orders/order-filters";
import { listActiveAgents, listOrdersForAdmin, type ActiveAgent, type AdminOrderRow } from "@/modules/orders/queries";
import { orderActions } from "@/modules/orders/workflow-view";

import { AssignAgentForm } from "../_components/assign-agent-form";

const STATUS_LABELS: Record<OrderStatusFilter, string> = {
  all: "All statuses",
  new: "New (in pipeline)",
  delivered: "Delivered (historical)",
  refused: "Refused (historical)",
  cancelled: "Cancelled (historical)",
};

/** Synchronous page: the session read and the queries happen inside the Suspense boundary, never above it. */
export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<OrdersLoading />}>
      <AdminOrders searchParams={searchParams} />
    </Suspense>
  );
}

function OrdersLoading() {
  return (
    <section className="card p-6" aria-busy="true" aria-live="polite">
      <p className="muted text-sm">Loading orders…</p>
    </section>
  );
}

/** Keeps only the filters that are set, so the clear link and the search form stay consistent. */
function ordersHref(filters: Pick<OrderListFilters, "q" | "status" | "city">): string {
  const params = new URLSearchParams();
  if (filters.q !== "") params.set("q", filters.q);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.city !== "") params.set("city", filters.city);
  const query = params.toString();
  return query === "" ? "/admin" : `/admin?${query}`;
}

async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireArea("admin");

  const filters = parseOrderFilters(await searchParams);
  const [result, agentResult] = await Promise.all([listOrdersForAdmin(filters), listActiveAgents()]);
  const isFiltered = filters.q !== "" || filters.status !== "all" || filters.city !== "";

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
        <p className="muted mt-1 text-sm">
          Assign pipeline orders to active agents. Historical orders cannot be assigned.
        </p>
      </header>

      <form method="get" role="search" className="card flex flex-wrap items-end gap-3 p-4">
        {filters.city !== "" ? <input type="hidden" name="city" value={filters.city} /> : null}
        <div className="min-w-64 flex-1">
          <label htmlFor="q" className="label">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Order, customer, phone or city"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="status" className="label">
            Status
          </label>
          <select id="status" name="status" defaultValue={filters.status} className="input">
            {ORDER_STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary btn-white">
          Apply
        </button>
      </form>

      {filters.city !== "" ? (
        <p className="muted text-sm" role="status">
          Showing orders shipped to <strong className="text-foreground font-semibold">{cityFilterLabel(filters.city)}</strong>.{" "}
          <Link href={ordersHref({ ...filters, city: "" })} className="underline-offset-2 hover:underline">
            Clear city filter
          </Link>
        </p>
      ) : null}

      {!agentResult.ok ? (
        <div className="alert-error" role="alert">
          Agents could not be loaded, so assignment is unavailable. Refresh the page to try again.
        </div>
      ) : null}

      {result.ok ? (
        <OrdersTable rows={result.rows} agents={agentResult.ok ? agentResult.agents : []} truncated={result.truncated} isFiltered={isFiltered} />
      ) : (
        <div className="alert-error" role="alert">
          Orders could not be loaded. Refresh the page to try again.
        </div>
      )}
    </div>
  );
}

function OrdersTable({
  rows,
  agents,
  truncated,
  isFiltered,
}: {
  rows: AdminOrderRow[];
  agents: ActiveAgent[];
  truncated: boolean;
  isFiltered: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="card p-6">
        <p className="text-sm font-medium">
          {isFiltered ? "No orders match these filters." : "No orders have been imported yet."}
        </p>
      </section>
    );
  }

  return (
    <section className="card overflow-x-auto">
      <p className="muted border-b border-border px-4 py-3 text-sm">
        Showing {rows.length} order{rows.length === 1 ? "" : "s"}
        {truncated ? ` (first ${rows.length}; narrow the search to see more)` : ""}.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="muted text-xs uppercase tracking-wide">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Reference</th>
            <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
            <th scope="col" className="px-4 py-3 font-semibold">Phone</th>
            <th scope="col" className="px-4 py-3 font-semibold">City</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 font-semibold">Agent</th>
            <th scope="col" className="px-4 py-3 font-semibold">Assign</th>
            <th scope="col" className="px-4 py-3 font-semibold">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 font-mono text-xs">{row.source_order_id}</td>
              <td className="px-4 py-3">{row.customer?.display_name ?? "—"}</td>
              <td className="px-4 py-3 font-mono text-xs">{row.customer?.phone_e164 ?? "—"}</td>
              <td className="px-4 py-3">{row.shipping_city}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatMad(row.total)}</td>
              <td className="px-4 py-3">
                <span className="badge">{row.pipeline_status ?? row.source_status}</span>
              </td>
              <td className="px-4 py-3">{row.agent?.display_name ?? "Unassigned"}</td>
              <td className="px-4 py-3">
                <AssignCell row={row} agents={agents} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.source_created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AssignCell({ row, agents }: { row: AdminOrderRow; agents: ActiveAgent[] }) {
  // Assignment does not depend on the unanswered-call count, so 0 is passed for this check only.
  const actions = orderActions(row.pipeline_status, 0);

  if (actions.historical) {
    return <span className="muted text-xs">Historical, not assignable</span>;
  }
  if (!actions.assign) {
    return <span className="muted text-xs">Finished, not reassignable</span>;
  }
  if (agents.length === 0) {
    return <span className="muted text-xs">No active agents</span>;
  }
  return (
    <AssignAgentForm
      orderId={row.id}
      expectedVersion={row.version}
      currentAgentId={row.assigned_agent_id}
      agents={agents.map((agent) => ({ id: agent.id, displayName: agent.displayName }))}
    />
  );
}
