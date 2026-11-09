-- I-7 Rescue Center database checks: public.rescue_repeat_counts(uuid[]).
-- Run ONLY against a local Supabase database (for example after `supabase start`), never against production.
-- Needs migrations up to i3 plus 20261109100000_i7_01_rescue_repeat_counts.sql, and the roles anon, authenticated, service_role.
-- The whole script runs in one transaction and ends with ROLLBACK, so it leaves no data behind.
-- Each check raises an exception on failure and prints NOTICE 'PASS' on success.
--
-- NOT RUN in the development environment (no PostgreSQL there). Run it before approving migration i7_01.

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

create function test_helpers.rescue_order(p_id text, p_phone text, p_created text, p_status text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p_id,
    'created_at', p_created,
    'customer', jsonb_build_object('name', 'Rescue test ' || p_id, 'phone', p_phone),
    'shipping_address', jsonb_build_object('city', 'Rabat', 'district', 'Test district', 'address1', '1 test street'),
    'line_items', jsonb_build_array(jsonb_build_object('sku', 'BRX-001', 'title', 'Produit test', 'quantity', 1, 'unit_price', 100)),
    'subtotal', 100, 'shipping_fee', 30, 'total', 130, 'currency', 'MAD', 'payment_method', 'COD', 'status', p_status
  )
$$;

-- Fails unless the Rescue function returns exactly one row for the order, with the expected counts.
-- Runs as the current role, so the caller's visibility is what is tested.
create function test_helpers.assert_counts(p_source text, p_refused integer, p_cancelled integer) returns void
language plpgsql as $$
declare
  v_id uuid := test_helpers.order_id(p_source);
  v_rows integer;
  v_refused integer;
  v_cancelled integer;
begin
  select count(*) into v_rows from public.rescue_repeat_counts(array[v_id]);
  if v_rows <> 1 then
    raise exception 'FAIL: % expected one row, got %', p_source, v_rows;
  end if;
  select prior_refused_count, prior_cancelled_count into v_refused, v_cancelled
  from public.rescue_repeat_counts(array[v_id]);
  if v_refused <> p_refused or v_cancelled <> p_cancelled then
    raise exception 'FAIL: % expected (%, %) got (%, %)', p_source, p_refused, p_cancelled, v_refused, v_cancelled;
  end if;
end;
$$;

-- Fails unless the Rescue counts equal repeat_customer_summary for the same order.
-- Must be called as a role that can read the order through both functions.
create function test_helpers.assert_matches_summary(p_source text) returns void
language plpgsql as $$
declare
  v_id uuid := test_helpers.order_id(p_source);
  v_rescue_refused integer;
  v_rescue_cancelled integer;
  v_summary_refused integer;
  v_summary_cancelled integer;
begin
  select prior_refused_count, prior_cancelled_count into v_rescue_refused, v_rescue_cancelled
  from public.rescue_repeat_counts(array[v_id]);
  select prior_refused_count, prior_cancelled_count into v_summary_refused, v_summary_cancelled
  from public.repeat_customer_summary(v_id);
  if v_rescue_refused is distinct from v_summary_refused or v_rescue_cancelled is distinct from v_summary_cancelled then
    raise exception 'FAIL: % rescue (%, %) differs from repeat_customer_summary (%, %)',
      p_source, v_rescue_refused, v_rescue_cancelled, v_summary_refused, v_summary_cancelled;
  end if;
end;
$$;

-- Fingerprint of order state and audit row counts, used to prove the read-only function changes nothing.
create function test_helpers.state_fingerprint() returns text
language sql stable as $$
  select md5(
    coalesce((select string_agg(o.id::text || ':' || o.version || ':' || coalesce(o.pipeline_status::text, '-') || ':'
                  || coalesce(o.assigned_agent_id::text, '-'), ',' order by o.id) from public.orders as o), '')
    || '|' || (select count(*) from public.order_events)::text
    || '|' || (select count(*) from public.customers)::text
    || '|' || (select count(*) from public.call_attempts)::text
  )
$$;

-- ---------------------------------------------------------------------------
-- 0. Fixtures
--   Customer C (+212600910001): history BRX-9201 refused, BRX-9202 cancelled, BRX-9205 refused via
--   Cancelled/refused, BRX-9206 cancelled via requested_by_customer, BRX-9210 delivered (not counted).
--   Customer D (+212600910002): BRX-9208 refused (history for BRX-9207 only).
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
  r := public.import_source_orders('i7-rescue.json', repeat('7', 64), jsonb_build_array(
    test_helpers.rescue_order('BRX-9201', '+212600910001', '2026-10-01T10:00:00+02:00', 'refused'),
    test_helpers.rescue_order('BRX-9202', '+212600910001', '2026-10-02T10:00:00+02:00', 'cancelled'),
    test_helpers.rescue_order('BRX-9203', '+212600910001', '2026-10-03T10:00:00+02:00', 'new'),
    test_helpers.rescue_order('BRX-9204', '+212600910001', '2026-11-01T10:00:00+02:00', 'new'),
    test_helpers.rescue_order('BRX-9205', '+212600910001', '2026-10-04T10:00:00+02:00', 'new'),
    test_helpers.rescue_order('BRX-9206', '+212600910001', '2026-10-05T10:00:00+02:00', 'new'),
    test_helpers.rescue_order('BRX-9207', '+212600910002', '2026-11-01T10:00:00+02:00', 'new'),
    test_helpers.rescue_order('BRX-9208', '+212600910002', '2026-10-01T10:00:00+02:00', 'refused'),
    test_helpers.rescue_order('BRX-9209', '+212600910001', '2026-11-02T10:00:00+02:00', 'new'),
    test_helpers.rescue_order('BRX-9210', '+212600910001', '2026-10-06T10:00:00+02:00', 'delivered')
  ));
  if r ->> 'status' <> 'imported' or (r ->> 'orders_created')::integer <> 10 then
    raise exception 'FAIL: rescue fixture import %', r;
  end if;
end;
$$;

-- Admin assigns: agent one gets BRX-9204 and BRX-9209; agent two gets BRX-9207. BRX-9203 stays unassigned.
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
select public.assign_order(test_helpers.order_id('BRX-9204'), '00000000-0000-4000-8000-000000000002', 1);
select public.assign_order(test_helpers.order_id('BRX-9209'), '00000000-0000-4000-8000-000000000002', 1);
select public.assign_order(test_helpers.order_id('BRX-9207'), '00000000-0000-4000-8000-000000000003', 1);

-- Pipeline cancellations that become history for customer C.
select public.cancel_order(test_helpers.order_id('BRX-9205'), 'refused', 1);
select public.cancel_order(test_helpers.order_id('BRX-9206'), 'requested_by_customer', 1);
select test_helpers.act_as_owner();
select test_helpers.note('PASS: fixtures imported and assigned');

-- ---------------------------------------------------------------------------
-- 1. Admin can retrieve authorised history counts (including unassigned orders)
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
select test_helpers.assert_counts('BRX-9204', 2, 2);  -- prior: 0001 refused, 0002 cancelled, 0005 refused, 0006 cancelled
select test_helpers.assert_counts('BRX-9209', 2, 2);  -- same prior history; BRX-9204 is still New, so not counted
select test_helpers.assert_counts('BRX-9203', 1, 1);  -- prior: 0001 refused, 0002 cancelled
select test_helpers.assert_counts('BRX-9207', 1, 0);  -- prior: 0008 refused
select test_helpers.assert_counts('BRX-9208', 0, 0);  -- no prior orders
select test_helpers.note('PASS: admin receives the correct counts for every order, assigned or not');

-- ---------------------------------------------------------------------------
-- 2. Agent one can retrieve counts for their own assigned orders
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
select test_helpers.assert_counts('BRX-9204', 2, 2);
select test_helpers.assert_counts('BRX-9209', 2, 2);
select test_helpers.note('PASS: agent one receives counts for their assigned orders');

-- ---------------------------------------------------------------------------
-- 3. Agent one cannot retrieve anything for other orders, even when given their UUIDs
-- ---------------------------------------------------------------------------
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.rescue_repeat_counts(array[test_helpers.order_id('BRX-9207')]);
  if v_count <> 0 then raise exception 'FAIL: agent one saw agent two''s order'; end if;

  select count(*) into v_count
  from public.rescue_repeat_counts(array[test_helpers.order_id('BRX-9203')]);
  if v_count <> 0 then raise exception 'FAIL: agent one saw an unassigned order'; end if;

  select count(*) into v_count
  from public.rescue_repeat_counts(array[test_helpers.order_id('BRX-9208')]);
  if v_count <> 0 then raise exception 'FAIL: agent one saw a historical order of another customer'; end if;

  -- Mixed list: only the visible order comes back, and the other UUIDs produce nothing.
  select count(*) into v_count
  from public.rescue_repeat_counts(array[
    test_helpers.order_id('BRX-9204'), test_helpers.order_id('BRX-9207'), test_helpers.order_id('BRX-9203')
  ]);
  if v_count <> 1 then raise exception 'FAIL: mixed list should return exactly one visible row, got %', v_count; end if;

  if not exists (
    select 1 from public.rescue_repeat_counts(array[
      test_helpers.order_id('BRX-9204'), test_helpers.order_id('BRX-9207'), test_helpers.order_id('BRX-9203')
    ]) as r where r.order_id = test_helpers.order_id('BRX-9204')
  ) then
    raise exception 'FAIL: mixed list dropped the visible order';
  end if;
end;
$$;
select test_helpers.act_as('00000000-0000-4000-8000-000000000003');
select test_helpers.assert_counts('BRX-9207', 1, 0);  -- positive control: agent two sees their own order
select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
select test_helpers.note('PASS: agent one gets no rows for other agents'' orders, unassigned orders, or other customers, even by UUID');

-- ---------------------------------------------------------------------------
-- 6. Refused and cancelled counts match repeat_customer_summary, as admin and as the assigned agent
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
select test_helpers.assert_matches_summary('BRX-9203');
select test_helpers.assert_matches_summary('BRX-9204');
select test_helpers.assert_matches_summary('BRX-9207');
select test_helpers.assert_matches_summary('BRX-9208');
select test_helpers.assert_matches_summary('BRX-9209');
select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
select test_helpers.assert_matches_summary('BRX-9204');
select test_helpers.assert_matches_summary('BRX-9209');
select test_helpers.note('PASS: rescue counts equal repeat_customer_summary, including refused-via-cancel and delivered orders');

-- ---------------------------------------------------------------------------
-- 7. Empty arrays, nulls, duplicates, and the 500-id limit
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare
  v_count integer;
  v_cust uuid := test_helpers.order_id('BRX-9204');
begin
  select count(*) into v_count from public.rescue_repeat_counts('{}'::uuid[]);
  if v_count <> 0 then raise exception 'FAIL: empty array should return no rows, got %', v_count; end if;

  select count(*) into v_count from public.rescue_repeat_counts(null::uuid[]);
  if v_count <> 0 then raise exception 'FAIL: null array should return no rows, got %', v_count; end if;

  select count(*) into v_count from public.rescue_repeat_counts(array[null, v_cust, null]::uuid[]);
  if v_count <> 1 then raise exception 'FAIL: nulls inside the array should be ignored, got % rows', v_count; end if;

  select count(*) into v_count from public.rescue_repeat_counts(array[v_cust, v_cust, v_cust]::uuid[]);
  if v_count <> 1 then raise exception 'FAIL: duplicate ids should return one row, got % rows', v_count; end if;

  -- Exactly 500 distinct ids is allowed. 499 unknown ids plus one real one returns only the real one.
  select count(*) into v_count
  from public.rescue_repeat_counts(
    (select array_agg(g) from (select gen_random_uuid() as g from generate_series(1, 499)) as s) || array[v_cust]
  );
  if v_count <> 1 then raise exception 'FAIL: 500 ids should be accepted and return one visible row, got %', v_count; end if;
end;
$$;
select test_helpers.expect_error($q$
  select * from public.rescue_repeat_counts(
    (select array_agg(g) from (select gen_random_uuid() as g from generate_series(1, 501)) as s))
$q$, 'HV007');
select test_helpers.note('PASS: empty, null, nulls inside, duplicate ids, 500 ids accepted; 501 ids rejected with HV007');

-- ---------------------------------------------------------------------------
-- 8. No customer identity, no unrelated order ids, and no data changes
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_secdef boolean;
  v_config text[];
begin
  select pg_get_function_result(p.oid), p.prosecdef, p.proconfig
    into v_def, v_secdef, v_config
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rescue_repeat_counts';

  -- Exactly three columns, all counts or ids: no name, phone, address or other customer data.
  if v_def !~ '^TABLE\(order_id uuid, prior_refused_count integer, prior_cancelled_count integer\)$' then
    raise exception 'FAIL: unexpected return shape: %', v_def;
  end if;
  if v_def ~* '(phone|name|address|customer|city|district|email)' then
    raise exception 'FAIL: return shape exposes customer fields: %', v_def;
  end if;
  if not v_secdef then raise exception 'FAIL: function must be security definer'; end if;
  if not exists (select 1 from unnest(v_config) as c where c = 'search_path=""') then
    raise exception 'FAIL: function must pin search_path to an empty string';
  end if;
end;
$$;

select test_helpers.act_as_owner();
select set_config('rescue_test.fingerprint_before', test_helpers.state_fingerprint(), false);

-- Admin asks only about customer C's order: no row may name any other order.
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare
  v_requested uuid[] := array[test_helpers.order_id('BRX-9204')];
  v_stray integer;
  v_total integer;
begin
  select count(*) into v_stray from public.rescue_repeat_counts(v_requested) as r where r.order_id <> all (v_requested);
  if v_stray <> 0 then raise exception 'FAIL: result contains order ids that were not requested'; end if;
  select count(*) into v_total from public.rescue_repeat_counts(v_requested);
  if v_total <> 1 then raise exception 'FAIL: expected one row, got %', v_total; end if;
end;
$$;

-- Agent one asks about own orders plus other customers' orders: the response only names visible orders.
select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
do $$
declare v_stray integer;
begin
  select count(*) into v_stray
  from public.rescue_repeat_counts(array[
    test_helpers.order_id('BRX-9204'), test_helpers.order_id('BRX-9207'), test_helpers.order_id('BRX-9208')
  ]) as r
  where r.order_id in (test_helpers.order_id('BRX-9207'), test_helpers.order_id('BRX-9208'));
  if v_stray <> 0 then raise exception 'FAIL: agent one saw order ids belonging to other agents or customers'; end if;
end;
$$;

select test_helpers.act_as_owner();
select test_helpers.note(
  case when test_helpers.state_fingerprint() = current_setting('rescue_test.fingerprint_before')
       then 'PASS: rescue reads changed no orders, events, customers or call attempts'
       else 'FAIL: state changed during rescue reads' end
);
do $$
begin
  if test_helpers.state_fingerprint() <> current_setting('rescue_test.fingerprint_before') then
    raise exception 'FAIL: rescue reads changed data';
  end if;
end;
$$;
select test_helpers.note('PASS: response shape exposes only order ids and counts, and the function is read-only');

-- ---------------------------------------------------------------------------
-- 4. Inactive agents receive no results (deactivate agent one, then ask as agent one)
-- ---------------------------------------------------------------------------
select test_helpers.act_as_owner();
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-000000000002';
select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.rescue_repeat_counts(array[test_helpers.order_id('BRX-9204'), test_helpers.order_id('BRX-9209')]);
  if v_count <> 0 then raise exception 'FAIL: an inactive agent received % rows', v_count; end if;
end;
$$;
select test_helpers.act_as('00000000-0000-4000-8000-000000000004');
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.rescue_repeat_counts(array[test_helpers.order_id('BRX-9204'), test_helpers.order_id('BRX-9207')]);
  if v_count <> 0 then raise exception 'FAIL: the inactive agent received % rows', v_count; end if;
end;
$$;
select test_helpers.note('PASS: inactive agents receive no rows, even for orders they were assigned');

-- ---------------------------------------------------------------------------
-- 5. Anonymous users cannot execute the function; the privilege grants are as designed
-- ---------------------------------------------------------------------------
select test_helpers.act_as_owner();
do $$
begin
  if has_function_privilege('anon', 'public.rescue_repeat_counts(uuid[])', 'EXECUTE') then
    raise exception 'FAIL: anon must not have EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.rescue_repeat_counts(uuid[])', 'EXECUTE') then
    raise exception 'FAIL: authenticated must have EXECUTE';
  end if;
end;
$$;
do $$
begin
  execute 'set local role anon';
  perform test_helpers.expect_error(
    $q$ select * from public.rescue_repeat_counts(array[gen_random_uuid()]) $q$, '42501');
end;
$$;
select test_helpers.act_as_owner();
select test_helpers.note('PASS: anon has no EXECUTE and gets insufficient_privilege; authenticated has EXECUTE');

rollback;
