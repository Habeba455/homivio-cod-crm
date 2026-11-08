-- I-3 migration 4: SQL order state machine and the shared order-access helper.
-- Mirrors src/modules/orders/domain/transitions.ts. Both are checked against supabase/tests/transition-cases.json.
-- Architecture: docs/architecture.md §9.

create type public.transition_outcome as (
  ok boolean,
  next_status public.pipeline_status,
  next_unanswered_count integer,
  cancel_reason text,
  auto_cancelled boolean,
  error text
);

-- Pure and deterministic. Rejections are returned, not raised, except for malformed input.
create function public.transition_order(
  p_status public.pipeline_status,
  p_unanswered_count integer,
  p_event text,
  p_reason text
)
returns public.transition_outcome
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_unanswered_count is null or p_unanswered_count < 0 then
    raise exception 'unanswered count must be a non-negative integer' using errcode = 'HV007';
  end if;
  if p_event not in ('call_answered', 'call_no_answer', 'confirm', 'cancel') then
    raise exception 'unknown order event' using errcode = 'HV007';
  end if;

  -- Same order of checks as the TypeScript module: not_in_pipeline, then terminal, then event.
  if p_status is null then
    return (false, null, null, null, false, 'not_in_pipeline')::public.transition_outcome;
  end if;
  if p_status in ('Confirmed', 'Cancelled') then
    return (false, null, null, null, false, 'invalid_transition')::public.transition_outcome;
  end if;

  if p_event = 'call_answered' then
    return (true, 'Called'::public.pipeline_status, p_unanswered_count, null, false, null)::public.transition_outcome;
  end if;

  if p_event = 'call_no_answer' then
    v_count := p_unanswered_count + 1;
    if v_count >= 3 then
      return (true, 'Cancelled'::public.pipeline_status, v_count, 'three_unanswered_attempts', true, null)::public.transition_outcome;
    end if;
    return (
      true,
      (case when p_status = 'Called' then 'Called' else 'No Answer' end)::public.pipeline_status,
      v_count, null, false, null
    )::public.transition_outcome;
  end if;

  if p_event = 'confirm' then
    if p_status <> 'Called' then
      return (false, null, null, null, false, 'invalid_transition')::public.transition_outcome;
    end if;
    return (true, 'Confirmed'::public.pipeline_status, p_unanswered_count, null, false, null)::public.transition_outcome;
  end if;

  -- cancel
  if p_reason not in ('refused', 'requested_by_customer', 'other') then
    raise exception 'invalid cancel reason' using errcode = 'HV007';
  end if;
  return (true, 'Cancelled'::public.pipeline_status, p_unanswered_count, p_reason, false, null)::public.transition_outcome;
end;
$$;

-- Single place that decides whether the caller may act on an order.
-- Admins see every order. Agents see only orders assigned to them. Anyone else, and any
-- order the caller may not see, produce the same 'not found' error, so existence is not leaked.
-- When p_lock is true the row is locked for the rest of the transaction.
create function app_private.load_accessible_order(p_order_id uuid, p_lock boolean)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_order public.orders;
begin
  v_role := public.current_app_role();
  if v_role is null then
    raise exception 'authentication required' using errcode = 'HV001';
  end if;

  if p_lock then
    select * into v_order from public.orders as o where o.id = p_order_id for update;
  else
    select * into v_order from public.orders as o where o.id = p_order_id;
  end if;

  if not found then
    raise exception 'order not found' using errcode = 'HV003';
  end if;
  if v_role <> 'admin' and v_order.assigned_agent_id is distinct from auth.uid() then
    raise exception 'order not found' using errcode = 'HV003';
  end if;
  return v_order;
end;
$$;
