-- I-3 migration 9: privileges. Least privilege for anon, authenticated and service_role.
-- Architecture: docs/architecture.md §7.4 (direct UPDATE revoked; writes only through RPCs).

-- Future objects created by the migration role get no client privileges by default.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Tables: no client writes at all. Reads are narrowed further by the RLS policies.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.customers, public.orders, public.order_items,
  public.call_attempts, public.order_notes, public.order_events,
  public.source_records, public.import_batches
  to authenticated;

-- Functions: nothing is executable by PUBLIC or anon. Each grant below is deliberate.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

grant execute on function public.log_call_attempt(uuid, text, integer, uuid) to authenticated;
grant execute on function public.confirm_order(uuid, integer) to authenticated;
grant execute on function public.cancel_order(uuid, text, integer) to authenticated;
grant execute on function public.assign_order(uuid, uuid, integer) to authenticated;
grant execute on function public.add_order_note(uuid, text) to authenticated;
grant execute on function public.repeat_customer_summary(uuid) to authenticated;

-- Import is operator-only. transition_order is internal: it is reached only from RPCs that already authorized the caller.
grant execute on function public.import_source_orders(text, text, jsonb) to service_role;
