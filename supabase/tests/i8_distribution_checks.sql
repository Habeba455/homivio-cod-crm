-- I-8 Distribution Center database checks.
-- Run ONLY against a local Supabase database (for example after `supabase start`), never against production.
-- Needs migrations up to i3 plus 20261109110000_i8_01_bulk_distribution.sql, and the roles anon, authenticated, service_role.
-- The whole script runs in one transaction and ends with ROLLBACK, so it leaves no data behind.
-- Each check raises an exception on failure and prints NOTICE 'PASS' on success.
--
-- NOT RUN in the development environment (no PostgreSQL there). Run it before approving migration i8_01.
-- Two-session concurrency checks are in docs/distribution-center.md, because one script cannot hold two sessions.

begin;

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;

create function test_helpers.expect_error(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: expected SQLSTATE % but statement succeeded: %', p_code, p_sql;
exception when others then
  if sqlstate is distinct from p_code then
    raise exception 'FAIL: expected SQLSTATE % but got % (%) for: %', p_code, sqlstate, sqlerrm, p_sql;
  end if;
end;
$$;

create function test_helpers.note(p_message text) returns void
language plpgsql as $$
begin
  raise notice '%', p_message;
end;
$$;

create function test_helpers.act_as(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
end;
$$;

create function test_helpers.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;

create function test_helpers.act_as_owner() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

create function test_helpers.order_id(p_source text) returns uuid
language sql security definer set search_path = '' as $$
  select o.id from public.orders as o where o.source_order_id = p_source
$$;

create function test_helpers.synthetic_order(p_id text, p_phone text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p_id,
    'created_at', '2026-11-05T10:00:00+01:00',
    'customer', jsonb_build_object('name', 'Distribution test ' || p_id, 'phone', p_phone),
    'shipping_address', jsonb_build_object('city', 'Rabat', 'district', 'Test district', 'address1', '1 test street'),
    'line_items', jsonb_build_array(jsonb_build_object('sku', 'BRX-001', 'title', 'Produit test', 'quantity', 1, 'unit_price', 100)),
    'subtotal', 100, 'shipping_fee', 30, 'total', 130, 'currency', 'MAD', 'payment_method', 'COD', 'status', 'new'
  )
$$;

-- Fixed plan used by most checks. Five orders are in the state named below, plus one unknown id.
--   BRX-9101, BRX-9102  new, unassigned, version 1           -> assigned to agent two
--   BRX-9103            already assigned to agent one        -> skipped: already_assigned
--   BRX-9104            new, unassigned, version now 1       -> plan says version 99 -> skipped: changed
--   BRX-9105            new, unassigned, plan uses inactive  -> skipped: agent_unavailable
--   unknown uuid                                             -> failed: not_found
create function test_helpers.standard_plan() returns jsonb
language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('order_id', test_helpers.order_id('BRX-9101'), 'agent_id', '00000000-0000-4000-8000-000000000003'::uuid, 'expected_version', 1),
    jsonb_build_object('order_id', test_helpers.order_id('BRX-9102'), 'agent_id', '00000000-0000-4000-8000-000000000003'::uuid, 'expected_version', 1),
    jsonb_build_object('order_id', test_helpers.order_id('BRX-9103'), 'agent_id', '00000000-0000-4000-8000-000000000002'::uuid, 'expected_version', 1),
    jsonb_build_object('order_id', test_helpers.order_id('BRX-9104'), 'agent_id', '00000000-0000-4000-8000-000000000002'::uuid, 'expected_version', 99),
    jsonb_build_object('order_id', test_helpers.order_id('BRX-9105'), 'agent_id', '00000000-0000-4000-8000-000000000004'::uuid, 'expected_version', 1),
    jsonb_build_object('order_id', '00000000-0000-4000-8000-0000000000ff'::uuid, 'agent_id', '00000000-0000-4000-8000-000000000003'::uuid, 'expected_version', 1)
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: users (one inactive agent), five new orders, and one pre-assignment made by an admin
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@test.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'agent1@test.invalid'),
  ('00000000-0000-4000-8000-000000000003', 'agent2@test.invalid'),
  ('00000000-0000-4000-8000-000000000004', 'inactive@test.invalid');

insert into public.profiles (id, role, display_name, is_active) values
  ('00000000-0000-4000-8000-000000000001', 'admin', 'Test Admin', true),
  ('00000000-0000-4000-8000-000000000002', 'agent', 'Agent One', true),
  ('00000000-0000-4000-8000-000000000003', 'agent', 'Agent Two', true),
  ('00000000-0000-4000-8000-000000000004', 'agent', 'Inactive Agent', false);

select test_helpers.act_as_service();
do $$
declare r jsonb;
begin
  r := public.import_source_orders('i8-distribution.json', repeat('8', 64), jsonb_build_array(
    test_helpers.synthetic_order('BRX-9101', '+212600900001'),
    test_helpers.synthetic_order('BRX-9102', '+212600900002'),
    test_helpers.synthetic_order('BRX-9103', '+212600900003'),
    test_helpers.synthetic_order('BRX-9104', '+212600900004'),
    test_helpers.synthetic_order('BRX-9105', '+212600900005')
  ));
  if r ->> 'status' <> 'imported' or (r ->> 'orders_created')::integer <> 5 then
    raise exception 'FAIL: fixture import %', r;
  end if;
end;
$$;

select test_helpers.act_as(
  '00000000-0000-4000-8000-000000000001'
);
select public.assign_order(test_helpers.order_id('BRX-9103'), '00000000-0000-4000-8000-000000000002', 1);
select test_helpers.act_as_owner();

-- ---------------------------------------------------------------------------
-- 2. Authorization: admin only, enforced in the database
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-0000000000a1', test_helpers.standard_plan())
$q$, 'HV002');
select test_helpers.act_as_owner();
select test_helpers.note('PASS: an agent cannot distribute orders (HV002)');

do $$
begin
  if has_function_privilege('anon', 'public.distribute_orders(uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'FAIL: anon must not execute distribute_orders';
  end if;
  if not has_function_privilege('authenticated', 'public.distribute_orders(uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must execute distribute_orders (the function checks admin itself)';
  end if;
  raise notice 'PASS: execute granted to authenticated only';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Batch: skip reasons, assignment, versions and audit events
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare r jsonb;
begin
  r := public.distribute_orders('00000000-0000-4000-9000-000000000001', test_helpers.standard_plan());
  if (r ->> 'requested')::integer <> 6 or (r ->> 'assigned')::integer <> 2
     or (r ->> 'skipped')::integer <> 3 or (r ->> 'failed')::integer <> 1 or (r ->> 'replayed')::boolean then
    raise exception 'FAIL: batch counts %', r;
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'items') as i
                 where i ->> 'outcome' = 'skipped' and i ->> 'reason' = 'already_assigned') then
    raise exception 'FAIL: pre-assigned order should be skipped as already_assigned';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'items') as i
                 where i ->> 'outcome' = 'skipped' and i ->> 'reason' = 'changed') then
    raise exception 'FAIL: stale version should be skipped as changed';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'items') as i
                 where i ->> 'outcome' = 'skipped' and i ->> 'reason' = 'agent_unavailable') then
    raise exception 'FAIL: inactive agent should be skipped as agent_unavailable';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'items') as i
                 where i ->> 'outcome' = 'failed' and i ->> 'reason' = 'not_found') then
    raise exception 'FAIL: unknown order should be failed as not_found';
  end if;
end;
$$;
select test_helpers.act_as_owner();

do $$
begin
  if (select assigned_agent_id from public.orders where source_order_id = 'BRX-9101')
     is distinct from '00000000-0000-4000-8000-000000000003' then raise exception 'FAIL: BRX-9101 not assigned'; end if;
  if (select version from public.orders where source_order_id = 'BRX-9101') <> 2 then raise exception 'FAIL: version not bumped'; end if;
  if (select assigned_agent_id from public.orders where source_order_id = 'BRX-9103')
     is distinct from '00000000-0000-4000-8000-000000000002' then raise exception 'FAIL: pre-assigned order was overwritten'; end if;
  if (select assigned_agent_id from public.orders where source_order_id = 'BRX-9104') is not null then raise exception 'FAIL: stale order was assigned'; end if;
  if (select assigned_agent_id from public.orders where source_order_id = 'BRX-9105') is not null then raise exception 'FAIL: inactive-agent order was assigned'; end if;
  raise notice 'PASS: assigned orders changed, skipped orders untouched';
end;
$$;

do $$
begin
  if (select count(*) from public.order_events e
      where e.event_type = 'assigned'
        and e.actor_id = '00000000-0000-4000-8000-000000000001'
        and e.payload ->> 'batch_id' is not null) <> 2 then
    raise exception 'FAIL: expected exactly two batch assignment events with the admin as actor';
  end if;
  raise notice 'PASS: one append-only assigned event per assigned order, with actor and batch id';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Retries and duplicate submissions
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare r jsonb;
begin
  r := public.distribute_orders('00000000-0000-4000-9000-000000000001', test_helpers.standard_plan());
  if not (r ->> 'replayed')::boolean or (r ->> 'assigned')::integer <> 2 then
    raise exception 'FAIL: same key and plan must replay the stored result, got %', r;
  end if;
end;
$$;
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-000000000001', '[]'::jsonb)
$q$, 'HV007');
select test_helpers.act_as_owner();
select test_helpers.note('PASS: a replayed key returns the stored result; reusing a key with another plan is rejected (HV007)');

do $$
begin
  if (select count(*) from public.order_events e where e.event_type = 'assigned' and e.payload ->> 'batch_id' is not null) <> 2 then
    raise exception 'FAIL: replay must not write new events';
  end if;
  if (select count(*) from public.assignment_batches) <> 1 then
    raise exception 'FAIL: replay must not write a second batch record';
  end if;
  raise notice 'PASS: replay writes nothing';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Plan validation and size limit
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-000000000002', '{"not":"an array"}'::jsonb)
$q$, 'HV007');
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-000000000003', '[{"order_id":null,"agent_id":"00000000-0000-4000-8000-000000000003","expected_version":1}]'::jsonb)
$q$, 'HV007');
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-000000000004', jsonb_build_array(
    jsonb_build_object('order_id', '00000000-0000-4000-8000-0000000000ee', 'agent_id', '00000000-0000-4000-8000-000000000003', 'expected_version', 1),
    jsonb_build_object('order_id', '00000000-0000-4000-8000-0000000000ee', 'agent_id', '00000000-0000-4000-8000-000000000003', 'expected_version', 1)))
$q$, 'HV007');
do $$
begin
  perform public.distribute_orders('00000000-0000-4000-9000-000000000005', (
    select jsonb_agg(jsonb_build_object('order_id', gen_random_uuid(), 'agent_id', '00000000-0000-4000-8000-000000000003', 'expected_version', 1))
    from generate_series(1, 2001)
  ));
  raise exception 'FAIL: 2001 orders must be rejected';
exception when others then
  if sqlstate <> 'HV007' then raise exception 'FAIL: expected HV007 for an oversized batch, got % (%)', sqlstate, sqlerrm; end if;
end;
$$;
select test_helpers.act_as_owner();
select test_helpers.note('PASS: malformed plans, duplicate orders and oversized batches are rejected (HV007)');

-- ---------------------------------------------------------------------------
-- 6. Batch records: append-only, admin-only read, no client writes
-- ---------------------------------------------------------------------------
select test_helpers.expect_error($q$ update public.assignment_batches set assigned_count = 0 $q$, 'HV010');
select test_helpers.expect_error($q$ delete from public.assignment_batches $q$, 'HV010');
select test_helpers.expect_error($q$ truncate public.assignment_batches $q$, 'HV010');
select test_helpers.note('PASS: batch records reject UPDATE, DELETE and TRUNCATE, even for the owner');

select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
do $$
begin
  if (select count(*) from public.assignment_batches) <> 0 then
    raise exception 'FAIL: an agent must not see batch records';
  end if;
end;
$$;
select test_helpers.act_as_owner();
select test_helpers.note('PASS: agents cannot read batch records');

-- ---------------------------------------------------------------------------
-- 7. Assignment mode: validated, recorded on the batch, returned to the caller
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-0000000000b1', test_helpers.standard_plan(), 'bogus')
$q$, 'HV007');
select test_helpers.expect_error($q$
  select public.distribute_orders('00000000-0000-4000-9000-0000000000b2', test_helpers.standard_plan(), null)
$q$, 'HV007');
select test_helpers.note('PASS: unknown or null assignment modes are rejected (HV007)');

do $$
declare
  r jsonb;
  v_mode text;
begin
  r := public.distribute_orders(
    '00000000-0000-4000-9000-0000000000b3',
    jsonb_build_array(jsonb_build_object(
      'order_id', '00000000-0000-4000-a000-00000000ffff',
      'agent_id', '00000000-0000-4000-8000-000000000001',
      'expected_version', 1)),
    'random');
  if r->>'mode' <> 'random' then
    raise exception 'FAIL: result must echo the mode';
  end if;
  select mode into v_mode from public.assignment_batches where id = (r->>'batch_id')::uuid;
  if v_mode is distinct from 'random' then
    raise exception 'FAIL: batch must record the mode the admin chose';
  end if;
end;
$$;
select test_helpers.note('PASS: the chosen mode is returned and stored on the batch record');


-- ---------------------------------------------------------------------------
-- 8. Audit: every batch-written assigned event carries its batch's own mode
-- ---------------------------------------------------------------------------
select test_helpers.act_as_service();
do $$
declare r jsonb;
begin
  r := public.import_source_orders('i8-distribution-mode.json', repeat('9', 64), jsonb_build_array(
    test_helpers.synthetic_order('BRX-9106', '+212600900006')
  ));
  if r ->> 'status' <> 'imported' or (r ->> 'orders_created')::integer <> 1 then
    raise exception 'FAIL: mode fixture import %', r;
  end if;
end;
$$;

select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare
  r jsonb;
  v_order uuid := test_helpers.order_id('BRX-9106');
  v_bad integer;
  v_events integer;
  v_assigned integer;
  v_mode text;
begin
  r := public.distribute_orders(
    '00000000-0000-4000-9000-0000000000b4',
    jsonb_build_array(jsonb_build_object(
      'order_id', v_order,
      'agent_id', '00000000-0000-4000-8000-000000000003',
      'expected_version', 1)),
    'balanced');
  if r ->> 'mode' <> 'balanced' or (r ->> 'assigned')::integer <> 1 then
    raise exception 'FAIL: balanced batch should assign the fresh order, got %', r;
  end if;

  select mode into v_mode from public.assignment_batches where id = (r ->> 'batch_id')::uuid;
  if v_mode is distinct from 'balanced' then
    raise exception 'FAIL: batch must store balanced';
  end if;

  -- The event for the fresh order names the same batch and the same mode.
  if not exists (
    select 1 from public.order_events as e
    where e.order_id = v_order
      and e.event_type = 'assigned'
      and e.payload ->> 'mode' = 'balanced'
      and e.payload ->> 'batch_id' = r ->> 'batch_id'
  ) then
    raise exception 'FAIL: assigned event must carry batch id and balanced mode';
  end if;

  -- Every batch-written assigned event must match its batch's stored mode.
  select count(*) into v_bad
  from public.order_events as e
  where e.event_type = 'assigned'
    and e.payload ? 'batch_id'
    and not exists (
      select 1 from public.assignment_batches as b
      where b.id = (e.payload ->> 'batch_id')::uuid
        and b.mode = e.payload ->> 'mode'
    );
  if v_bad <> 0 then
    raise exception 'FAIL: % assigned events disagree with their batch mode', v_bad;
  end if;

  -- Each assignment a batch reports has exactly one event: no silent writes, no phantom events.
  select count(*) into v_events
  from public.order_events as e
  where e.event_type = 'assigned' and e.payload ? 'batch_id';
  select coalesce(sum(b.assigned_count), 0) into v_assigned from public.assignment_batches as b;
  if v_events <> v_assigned then
    raise exception 'FAIL: % batch events but % assignments counted', v_events, v_assigned;
  end if;
end;
$$;
select test_helpers.note('PASS: every batch-written assigned event carries its batch mode, and event counts match assigned counts');


rollback;
