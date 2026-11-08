-- I-3 migration 7: order notes and the repeat-customer summary.
-- Architecture: docs/architecture.md §7.4 and §8.7.

create function public.add_order_note(p_order_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_body text := btrim(coalesce(p_body, ''));
  v_note_id uuid;
begin
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'note must be 1 to 2000 characters' using errcode = 'HV007';
  end if;

  v_order := app_private.load_accessible_order(p_order_id, false);

  insert into public.order_notes (order_id, author_id, body)
  values (v_order.id, auth.uid(), v_body)
  returning id into v_note_id;

  return v_note_id;
end;
$$;

-- Returns only two counts for a customer's EARLIER orders, across all agents.
-- Phone is the matching key through customers.phone_e164, and name, city and address are never compared.
-- Classification mirrors priorOutcome() in src/modules/repeat-customers/domain/risk.ts.
-- Delivered history is neutral and is not counted here.
-- The caller must be able to see the current order. Other agents' orders are never returned, only counts.
create function public.repeat_customer_summary(p_order_id uuid)
returns table (prior_refused_count integer, prior_cancelled_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  v_order := app_private.load_accessible_order(p_order_id, false);

  return query
  select
    count(*) filter (
      where prior.source_status = 'refused'
         or (prior.pipeline_status = 'Cancelled' and prior.cancel_reason = 'refused')
    )::integer,
    count(*) filter (
      where prior.source_status = 'cancelled'
         or (prior.pipeline_status = 'Cancelled' and prior.cancel_reason is distinct from 'refused')
    )::integer
  from public.orders as prior
  where prior.customer_id = v_order.customer_id
    and prior.id <> v_order.id
    and prior.source_created_at < v_order.source_created_at;
end;
$$;
