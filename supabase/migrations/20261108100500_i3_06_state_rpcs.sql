-- I-3 migration 6: state-changing RPCs. Each function is one transaction:
-- lock the order, check authorization, check version, apply the transition, write the attempt and the audit event.
-- Error codes (SQLSTATE) are part of the contract the application maps to messages:
--   HV001 authentication required     HV002 forbidden for this role
--   HV003 order not found (or not visible to caller)
--   HV004 version conflict            HV005 order not in the pipeline
--   HV006 invalid transition          HV007 invalid input
--   HV008 assignee not an active agent

create type public.order_mutation as (
  order_id uuid,
  status public.pipeline_status,
  version integer,
  unanswered_attempt_count integer,
  cancel_reason text,
  replayed boolean
);

create function public.log_call_attempt(
  p_order_id uuid,
  p_outcome text,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns public.order_mutation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_existing public.call_attempts;
  v_event text;
  v_transition public.transition_outcome;
  v_actor uuid := auth.uid();
  v_new_version integer;
begin
  if p_idempotency_key is null or p_expected_version is null
     or p_outcome not in ('answered', 'no_answer') then
    raise exception 'invalid call attempt input' using errcode = 'HV007';
  end if;

  v_order := app_private.load_accessible_order(p_order_id, true);

  -- Replay: the same key returns the stored result without writing anything.
  select * into v_existing from public.call_attempts as a where a.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id is distinct from p_order_id then
      raise exception 'idempotency key already used for another order' using errcode = 'HV007';
    end if;
    return (v_order.id, v_order.pipeline_status, v_order.version,
            v_order.unanswered_attempt_count, v_order.cancel_reason, true)::public.order_mutation;
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'order was changed by someone else' using errcode = 'HV004';
  end if;
  if v_order.pipeline_status is null then
    raise exception 'order is not in the pipeline' using errcode = 'HV005';
  end if;

  v_event := case when p_outcome = 'answered' then 'call_answered' else 'call_no_answer' end;
  v_transition := public.transition_order(v_order.pipeline_status, v_order.unanswered_attempt_count, v_event, null);
  if not v_transition.ok then
    raise exception 'transition rejected: %', v_transition.error using errcode = 'HV006';
  end if;

  update public.orders as o
  set pipeline_status = v_transition.next_status,
      unanswered_attempt_count = v_transition.next_unanswered_count,
      cancel_reason = v_transition.cancel_reason,
      cancelled_at = case when v_transition.auto_cancelled then now() else o.cancelled_at end,
      version = o.version + 1
  where o.id = v_order.id
  returning o.version into v_new_version;

  insert into public.call_attempts (order_id, agent_id, outcome, idempotency_key, unanswered_attempt_count_after)
  values (v_order.id, v_actor, p_outcome::public.call_outcome, p_idempotency_key, v_transition.next_unanswered_count);

  insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
  values (v_order.id, v_actor, v_event, v_order.pipeline_status, v_transition.next_status,
          jsonb_build_object('version', v_new_version, 'unanswered_attempt_count', v_transition.next_unanswered_count));

  if v_transition.auto_cancelled then
    insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
    values (v_order.id, v_actor, 'auto_cancelled', v_order.pipeline_status, 'Cancelled'::public.pipeline_status,
            jsonb_build_object('reason', v_transition.cancel_reason, 'version', v_new_version));
  end if;

  return (v_order.id, v_transition.next_status, v_new_version,
          v_transition.next_unanswered_count, v_transition.cancel_reason, false)::public.order_mutation;
end;
$$;

create function public.confirm_order(p_order_id uuid, p_expected_version integer)
returns public.order_mutation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_transition public.transition_outcome;
  v_new_version integer;
begin
  if p_expected_version is null then
    raise exception 'invalid input' using errcode = 'HV007';
  end if;

  v_order := app_private.load_accessible_order(p_order_id, true);
  if v_order.version <> p_expected_version then
    raise exception 'order was changed by someone else' using errcode = 'HV004';
  end if;
  if v_order.pipeline_status is null then
    raise exception 'order is not in the pipeline' using errcode = 'HV005';
  end if;

  v_transition := public.transition_order(v_order.pipeline_status, v_order.unanswered_attempt_count, 'confirm', null);
  if not v_transition.ok then
    raise exception 'transition rejected: %', v_transition.error using errcode = 'HV006';
  end if;

  update public.orders as o
  set pipeline_status = v_transition.next_status,
      confirmed_at = now(),
      version = o.version + 1
  where o.id = v_order.id
  returning o.version into v_new_version;

  insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
  values (v_order.id, auth.uid(), 'confirmed', v_order.pipeline_status, v_transition.next_status,
          jsonb_build_object('version', v_new_version));

  return (v_order.id, v_transition.next_status, v_new_version,
          v_order.unanswered_attempt_count, null, false)::public.order_mutation;
end;
$$;

create function public.cancel_order(p_order_id uuid, p_reason text, p_expected_version integer)
returns public.order_mutation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_transition public.transition_outcome;
  v_new_version integer;
begin
  if p_expected_version is null or p_reason is null then
    raise exception 'invalid input' using errcode = 'HV007';
  end if;

  v_order := app_private.load_accessible_order(p_order_id, true);
  if v_order.version <> p_expected_version then
    raise exception 'order was changed by someone else' using errcode = 'HV004';
  end if;
  if v_order.pipeline_status is null then
    raise exception 'order is not in the pipeline' using errcode = 'HV005';
  end if;

  v_transition := public.transition_order(v_order.pipeline_status, v_order.unanswered_attempt_count, 'cancel', p_reason);
  if not v_transition.ok then
    raise exception 'transition rejected: %', v_transition.error using errcode = 'HV006';
  end if;

  update public.orders as o
  set pipeline_status = v_transition.next_status,
      cancel_reason = v_transition.cancel_reason,
      cancelled_at = now(),
      version = o.version + 1
  where o.id = v_order.id
  returning o.version into v_new_version;

  insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
  values (v_order.id, auth.uid(), 'cancelled', v_order.pipeline_status, v_transition.next_status,
          jsonb_build_object('version', v_new_version, 'reason', v_transition.cancel_reason));

  return (v_order.id, v_transition.next_status, v_new_version,
          v_order.unanswered_attempt_count, v_transition.cancel_reason, false)::public.order_mutation;
end;
$$;

-- Admin only. Agents can never assign orders, including to themselves.
create function public.assign_order(p_order_id uuid, p_agent_id uuid, p_expected_version integer)
returns public.order_mutation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_new_version integer;
begin
  if not public.is_admin() then
    raise exception 'only an admin can assign orders' using errcode = 'HV002';
  end if;
  if p_agent_id is null or p_expected_version is null then
    raise exception 'invalid input' using errcode = 'HV007';
  end if;

  select * into v_order from public.orders as o where o.id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'HV003';
  end if;
  if v_order.version <> p_expected_version then
    raise exception 'order was changed by someone else' using errcode = 'HV004';
  end if;
  if v_order.pipeline_status is null then
    raise exception 'order is not in the pipeline' using errcode = 'HV005';
  end if;
  if v_order.pipeline_status in ('Confirmed', 'Cancelled') then
    raise exception 'a finished order cannot be reassigned' using errcode = 'HV006';
  end if;
  if v_order.assigned_agent_id is not distinct from p_agent_id then
    raise exception 'order is already assigned to this agent' using errcode = 'HV007';
  end if;
  if not exists (
    select 1 from public.profiles as p
    where p.id = p_agent_id and p.role = 'agent' and p.is_active
  ) then
    raise exception 'assignee must be an active agent' using errcode = 'HV008';
  end if;

  update public.orders as o
  set assigned_agent_id = p_agent_id,
      version = o.version + 1
  where o.id = v_order.id
  returning o.version into v_new_version;

  insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
  values (v_order.id, auth.uid(),
          case when v_order.assigned_agent_id is null then 'assigned' else 'reassigned' end,
          v_order.pipeline_status, v_order.pipeline_status,
          jsonb_build_object('version', v_new_version, 'agent_id', p_agent_id));

  return (v_order.id, v_order.pipeline_status, v_new_version,
          v_order.unanswered_attempt_count, v_order.cancel_reason, false)::public.order_mutation;
end;
$$;
