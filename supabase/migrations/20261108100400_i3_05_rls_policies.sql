-- I-3 migration 5: Row Level Security on every application table.
-- Architecture: docs/architecture.md §7.3 and §7.4.
-- Only SELECT policies exist. Writes happen through security definer RPCs, so no client write policy is needed.
-- RLS is deliberately NOT forced: table owners (used by the RPCs) must read the tables they protect.

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.import_batches enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.source_records enable row level security;
alter table public.call_attempts enable row level security;
alter table public.order_notes enable row level security;
alter table public.order_events enable row level security;

-- Profiles: a user sees their own profile; admins see all profiles.
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));

-- Customers: visible only when the caller can see at least one of that customer's orders.
-- The inner query runs under the caller's orders policy, so no extra rule is needed.
create policy customers_select_via_visible_orders on public.customers
  for select to authenticated
  using (exists (select 1 from public.orders as o where o.customer_id = customers.id));

-- Orders: admins see all; an active agent sees only orders assigned to them.
create policy orders_select_admin_or_assigned on public.orders
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.current_app_role()) = 'agent' and assigned_agent_id = (select auth.uid()))
  );

-- Child tables: visible exactly when the parent order is visible.
create policy order_items_select_via_visible_order on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders as o where o.id = order_items.order_id));

create policy call_attempts_select_via_visible_order on public.call_attempts
  for select to authenticated
  using (exists (select 1 from public.orders as o where o.id = call_attempts.order_id));

create policy order_notes_select_via_visible_order on public.order_notes
  for select to authenticated
  using (exists (select 1 from public.orders as o where o.id = order_notes.order_id));

create policy order_events_select_via_visible_order on public.order_events
  for select to authenticated
  using (exists (select 1 from public.orders as o where o.id = order_events.order_id));

-- Raw source payloads (names and addresses) and import history: admins only.
create policy source_records_select_admin on public.source_records
  for select to authenticated
  using ((select public.is_admin()));

create policy import_batches_select_admin on public.import_batches
  for select to authenticated
  using ((select public.is_admin()));
