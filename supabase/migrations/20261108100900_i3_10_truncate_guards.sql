-- I-3 migration 10: TRUNCATE guards for tables that migrations 1 to 9 left unguarded.
-- Found by the integration test: TRUNCATE public.order_items succeeded for the owner and
-- service role, because no TRUNCATE trigger existed on it.
-- Append-only tables already use app_private.forbid_change (HV010). These source and identity
-- tables are not append-only in general, so they get a separate function with its own code (HV012).

create function app_private.forbid_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TRUNCATE is not allowed on %', tg_table_name using errcode = 'HV012';
end;
$$;

create trigger profiles_no_truncate
  before truncate on public.profiles
  for each statement execute function app_private.forbid_truncate();

create trigger customers_no_truncate
  before truncate on public.customers
  for each statement execute function app_private.forbid_truncate();

create trigger orders_no_truncate
  before truncate on public.orders
  for each statement execute function app_private.forbid_truncate();

create trigger order_items_no_truncate
  before truncate on public.order_items
  for each statement execute function app_private.forbid_truncate();
