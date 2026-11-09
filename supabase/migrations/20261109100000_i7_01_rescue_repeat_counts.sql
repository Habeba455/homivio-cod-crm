-- Smart COD Rescue Center: batched, counts-only customer history.
--
-- NOT APPLIED to the remote database. Apply only after explicit approval.
--
-- Returns counts for the orders the caller can already see, and nothing else: no other order ids,
-- no customer details. Visibility is re-checked here because security definer bypasses RLS.
-- Classification matches public.repeat_customer_summary (migration i3_07) exactly.
-- Input: at most 500 ids (HV007 above that). Duplicate and null ids are ignored.

create function public.rescue_repeat_counts(p_order_ids uuid[])
returns table (order_id uuid, prior_refused_count integer, prior_cancelled_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if cardinality(p_order_ids) > 500 then
    raise exception 'too many order ids' using errcode = 'HV007';
  end if;

  return query
  with requested as (
    select distinct u.id
    from unnest(coalesce(p_order_ids, '{}'::uuid[])) as u(id)
    where u.id is not null
  ),
  visible as (
    select o.id, o.customer_id, o.source_created_at
    from public.orders as o
    where o.id in (select r.id from requested as r)
      and (
        public.is_admin()
        or (public.current_app_role() = 'agent' and o.assigned_agent_id = auth.uid())
      )
  )
  select
    v.id,
    count(p.id) filter (
      where p.source_status = 'refused'
         or (p.pipeline_status = 'Cancelled' and p.cancel_reason = 'refused')
    )::integer,
    count(p.id) filter (
      where p.source_status = 'cancelled'
         or (p.pipeline_status = 'Cancelled' and p.cancel_reason is distinct from 'refused')
    )::integer
  from visible as v
  left join public.orders as p
    on p.customer_id = v.customer_id
   and p.id <> v.id
   and p.source_created_at < v.source_created_at
  group by v.id;
end;
$$;

revoke execute on function public.rescue_repeat_counts(uuid[]) from public, anon;
grant execute on function public.rescue_repeat_counts(uuid[]) to authenticated;
