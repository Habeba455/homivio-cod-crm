-- I-8 Smart Bulk Auto-Assignment (Distribution Center).
--
-- NOT APPLIED to the remote database. Local file only. Apply only after explicit approval.
--
-- One transaction assigns many orders. Each order keeps the same guarantees as assign_order:
-- admin only, row lock, version check, active agent check, and one append-only 'assigned' event.
-- Orders that are no longer eligible are skipped with a reason. They are never overwritten.
-- Each batch is recorded once in assignment_batches, keyed by an idempotency key.
-- p_mode (manual, random or balanced) records how the admin chose the mapping. The mapping executed is exactly p_plan.

create table public.assignment_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  mode text not null check (mode in ('manual', 'random', 'balanced')),
  plan_fingerprint text not null check (plan_fingerprint ~ '^[0-9a-f]{32}$'),
  requested_count integer not null check (requested_count >= 0),
  assigned_count integer not null check (assigned_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  failed_count integer not null check (failed_count >= 0),
  -- Per-order outcome: order id, outcome and reason code. Never customer data.
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  constraint assignment_batches_counts_add_up
    check (assigned_count + skipped_count + failed_count = requested_count)
);

create index assignment_batches_actor_created_idx on public.assignment_batches (actor_id, created_at);

alter table public.assignment_batches enable row level security;

create policy assignment_batches_select_admin on public.assignment_batches
  for select to authenticated
  using ((select public.is_admin()));

-- Append-only, like the other audit tables.
create trigger assignment_batches_append_only
  before update or delete on public.assignment_batches
  for each row execute function app_private.forbid_change();

create trigger assignment_batches_no_truncate
  before truncate on public.assignment_batches
  for each statement execute function app_private.forbid_change();

revoke all on public.assignment_batches from anon, authenticated;
grant select on public.assignment_batches to authenticated;

create function public.distribute_orders(p_batch_key uuid, p_plan jsonb, p_mode text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_fingerprint text;
  v_existing public.assignment_batches;
  v_active uuid[];
  v_requested integer;
  v_item record;
  v_order public.orders;
  v_items jsonb := '[]'::jsonb;
  v_reason text;
  v_assigned integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if not public.is_admin() then
    raise exception 'only an admin can distribute orders' using errcode = 'HV002';
  end if;
  if p_batch_key is null or p_plan is null or jsonb_typeof(p_plan) <> 'array' then
    raise exception 'invalid input' using errcode = 'HV007';
  end if;
  if p_mode is null or p_mode not in ('manual', 'random', 'balanced') then
    raise exception 'invalid assignment mode' using errcode = 'HV007';
  end if;
  v_requested := jsonb_array_length(p_plan);
  if v_requested < 1 or v_requested > 2000 then
    raise exception 'a batch must contain between 1 and 2000 orders' using errcode = 'HV007';
  end if;

  -- A retry or double submit with the same key waits here, then replays the stored result without writing.
  perform pg_advisory_xact_lock(hashtextextended('distribute_orders:' || p_batch_key::text, 0));
  v_fingerprint := md5(p_mode || ':' || p_plan::text);

  select * into v_existing from public.assignment_batches as b where b.idempotency_key = p_batch_key;
  if found then
    if v_existing.plan_fingerprint <> v_fingerprint then
      raise exception 'idempotency key already used for another plan' using errcode = 'HV007';
    end if;
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'mode', v_existing.mode,
      'replayed', true,
      'requested', v_existing.requested_count,
      'assigned', v_existing.assigned_count,
      'skipped', v_existing.skipped_count,
      'failed', v_existing.failed_count,
      'items', v_existing.items
    );
  end if;

  -- Shape check: every item needs all three fields, and an order may appear only once.
  if exists (
    select 1
    from jsonb_to_recordset(p_plan) as i(order_id uuid, agent_id uuid, expected_version integer)
    where i.order_id is null or i.agent_id is null or i.expected_version is null
  ) then
    raise exception 'each plan item needs order_id, agent_id and expected_version' using errcode = 'HV007';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_plan) as i(order_id uuid, agent_id uuid, expected_version integer)
    group by i.order_id
    having count(*) > 1
  ) then
    raise exception 'an order appears more than once in the batch' using errcode = 'HV007';
  end if;

  v_active := array(select p.id from public.profiles as p where p.role = 'agent' and p.is_active);

  -- Rows are locked in id order, so two overlapping batches cannot deadlock.
  for v_item in
    select i.order_id, i.agent_id, i.expected_version
    from jsonb_to_recordset(p_plan) as i(order_id uuid, agent_id uuid, expected_version integer)
    order by i.order_id
  loop
    select * into v_order from public.orders as o where o.id = v_item.order_id for update;

    v_reason := null;
    if not found then
      v_reason := 'not_found';
    elsif v_order.assigned_agent_id is not null then
      -- Never overwrite an existing assignment, even one made by another admin.
      v_reason := 'already_assigned';
    elsif v_order.version <> v_item.expected_version then
      v_reason := 'changed';
    elsif v_order.pipeline_status is null then
      v_reason := 'not_in_pipeline';
    elsif v_order.pipeline_status in ('Confirmed', 'Cancelled') then
      v_reason := 'finished';
    elsif v_order.pipeline_status <> 'New' then
      v_reason := 'not_new';
    -- coalesce: when there are no active agents, "= any" yields NULL, and NOT NULL would skip this guard.
    elsif not coalesce(v_item.agent_id = any (v_active), false) then
      v_reason := 'agent_unavailable';
    end if;

    if v_reason is null then
      update public.orders as o
      set assigned_agent_id = v_item.agent_id,
          version = o.version + 1
      where o.id = v_order.id;

      insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
      values (
        v_order.id, v_actor, 'assigned', v_order.pipeline_status, v_order.pipeline_status,
        jsonb_build_object('version', v_order.version + 1, 'agent_id', v_item.agent_id, 'batch_id', v_batch_id, 'mode', p_mode)
      );

      v_assigned := v_assigned + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'order_id', v_item.order_id, 'outcome', 'assigned', 'reason', null));
    elsif v_reason = 'not_found' then
      v_failed := v_failed + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'order_id', v_item.order_id, 'outcome', 'failed', 'reason', v_reason));
    else
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'order_id', v_item.order_id, 'outcome', 'skipped', 'reason', v_reason));
    end if;
  end loop;

  insert into public.assignment_batches (
    id, idempotency_key, actor_id, mode, plan_fingerprint,
    requested_count, assigned_count, skipped_count, failed_count, items
  ) values (
    v_batch_id, p_batch_key, v_actor, p_mode, v_fingerprint,
    v_requested, v_assigned, v_skipped, v_failed, v_items
  );

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'mode', p_mode,
    'replayed', false,
    'requested', v_requested,
    'assigned', v_assigned,
    'skipped', v_skipped,
    'failed', v_failed,
    'items', v_items
  );
end;
$$;

revoke execute on function public.distribute_orders(uuid, jsonb, text) from public, anon;
grant execute on function public.distribute_orders(uuid, jsonb, text) to authenticated;
