-- I-3 database checks.
-- Run ONLY against a local Supabase database (for example after `supabase start`), never against production.
-- Needs the Supabase auth schema and the roles anon, authenticated and service_role.
-- The whole script runs in one transaction and ends with ROLLBACK, so it leaves no data behind.
-- Each check raises an exception on failure and prints NOTICE 'PASS' on success.

begin;

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers (temporary, rolled back with the transaction)
-- ---------------------------------------------------------------------------

-- Runs p_sql and requires it to fail with SQLSTATE p_code.
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

-- ---------------------------------------------------------------------------
-- 1. SQL state function agrees with the TypeScript fixture (transitions.ts)
-- ---------------------------------------------------------------------------
do $$
declare
  -- BEGIN transition-cases
  v_cases jsonb := '{"cases":[{"name":"historical order rejects call_answered","status":null,"unanswered":0,"event":"call_answered","reason":null,"expect":{"ok":false,"error":"not_in_pipeline"}},{"name":"historical order rejects call_no_answer","status":null,"unanswered":0,"event":"call_no_answer","reason":null,"expect":{"ok":false,"error":"not_in_pipeline"}},{"name":"historical order rejects confirm","status":null,"unanswered":0,"event":"confirm","reason":null,"expect":{"ok":false,"error":"not_in_pipeline"}},{"name":"historical order rejects cancel","status":null,"unanswered":0,"event":"cancel","reason":"refused","expect":{"ok":false,"error":"not_in_pipeline"}},{"name":"New: call answered moves to Called","status":"New","unanswered":0,"event":"call_answered","reason":null,"expect":{"ok":true,"nextStatus":"Called","unansweredAttemptCount":0,"cancelReason":null,"autoCancelled":false}},{"name":"New: first no answer moves to No Answer","status":"New","unanswered":0,"event":"call_no_answer","reason":null,"expect":{"ok":true,"nextStatus":"No Answer","unansweredAttemptCount":1,"cancelReason":null,"autoCancelled":false}},{"name":"New: confirm is rejected","status":"New","unanswered":0,"event":"confirm","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"New: cancel with refused","status":"New","unanswered":0,"event":"cancel","reason":"refused","expect":{"ok":true,"nextStatus":"Cancelled","unansweredAttemptCount":0,"cancelReason":"refused","autoCancelled":false}},{"name":"No Answer (1): call answered moves to Called","status":"No Answer","unanswered":1,"event":"call_answered","reason":null,"expect":{"ok":true,"nextStatus":"Called","unansweredAttemptCount":1,"cancelReason":null,"autoCancelled":false}},{"name":"No Answer (1): second no answer keeps No Answer","status":"No Answer","unanswered":1,"event":"call_no_answer","reason":null,"expect":{"ok":true,"nextStatus":"No Answer","unansweredAttemptCount":2,"cancelReason":null,"autoCancelled":false}},{"name":"No Answer (1): confirm is rejected","status":"No Answer","unanswered":1,"event":"confirm","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"No Answer (1): cancel with requested_by_customer","status":"No Answer","unanswered":1,"event":"cancel","reason":"requested_by_customer","expect":{"ok":true,"nextStatus":"Cancelled","unansweredAttemptCount":1,"cancelReason":"requested_by_customer","autoCancelled":false}},{"name":"No Answer (2): third unanswered attempt auto-cancels","status":"No Answer","unanswered":2,"event":"call_no_answer","reason":null,"expect":{"ok":true,"nextStatus":"Cancelled","unansweredAttemptCount":3,"cancelReason":"three_unanswered_attempts","autoCancelled":true}},{"name":"Called (0): call answered keeps Called","status":"Called","unanswered":0,"event":"call_answered","reason":null,"expect":{"ok":true,"nextStatus":"Called","unansweredAttemptCount":0,"cancelReason":null,"autoCancelled":false}},{"name":"Called (0): no answer logged, stays Called","status":"Called","unanswered":0,"event":"call_no_answer","reason":null,"expect":{"ok":true,"nextStatus":"Called","unansweredAttemptCount":1,"cancelReason":null,"autoCancelled":false}},{"name":"Called (0): confirm","status":"Called","unanswered":0,"event":"confirm","reason":null,"expect":{"ok":true,"nextStatus":"Confirmed","unansweredAttemptCount":0,"cancelReason":null,"autoCancelled":false}},{"name":"Called (0): cancel with other","status":"Called","unanswered":0,"event":"cancel","reason":"other","expect":{"ok":true,"nextStatus":"Cancelled","unansweredAttemptCount":0,"cancelReason":"other","autoCancelled":false}},{"name":"Called (2): third unanswered attempt auto-cancels even when Called","status":"Called","unanswered":2,"event":"call_no_answer","reason":null,"expect":{"ok":true,"nextStatus":"Cancelled","unansweredAttemptCount":3,"cancelReason":"three_unanswered_attempts","autoCancelled":true}},{"name":"Confirmed: call_answered rejected","status":"Confirmed","unanswered":0,"event":"call_answered","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"Confirmed: call_no_answer rejected","status":"Confirmed","unanswered":0,"event":"call_no_answer","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"Confirmed: confirm rejected","status":"Confirmed","unanswered":0,"event":"confirm","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"Confirmed: cancel rejected","status":"Confirmed","unanswered":0,"event":"cancel","reason":"other","expect":{"ok":false,"error":"invalid_transition"}},{"name":"Cancelled (3): call_answered rejected","status":"Cancelled","unanswered":3,"event":"call_answered","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"Cancelled (3): call_no_answer rejected","status":"Cancelled","unanswered":3,"event":"call_no_answer","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"Cancelled (3): confirm rejected","status":"Cancelled","unanswered":3,"event":"confirm","reason":null,"expect":{"ok":false,"error":"invalid_transition"}},{"name":"Cancelled (3): cancel rejected","status":"Cancelled","unanswered":3,"event":"cancel","reason":"other","expect":{"ok":false,"error":"invalid_transition"}}]}'::jsonb;
  -- END transition-cases
  c jsonb;
  v_result public.transition_outcome;
  v_expect jsonb;
  v_status text;
  v_checked integer := 0;
begin
  if jsonb_typeof(v_cases -> 'cases') is distinct from 'array' then
    raise exception 'FAIL: transition fixture must have a cases array';
  end if;
  for c in select value from jsonb_array_elements(v_cases -> 'cases') as t(value) loop
    v_status := c ->> 'status';
    v_expect := c -> 'expect';
    v_result := public.transition_order(
      v_status::public.pipeline_status,
      (c ->> 'unanswered')::integer,
      c ->> 'event',
      c ->> 'reason'
    );

    if (v_expect ->> 'ok')::boolean then
      if not (
        v_result.ok
        and v_result.next_status::text is not distinct from v_expect ->> 'nextStatus'
        and v_result.next_unanswered_count = (v_expect ->> 'unansweredAttemptCount')::integer
        and v_result.cancel_reason is not distinct from v_expect ->> 'cancelReason'
        and v_result.auto_cancelled = (v_expect ->> 'autoCancelled')::boolean
      ) then
        raise exception 'FAIL: SQL transition mismatch: %', c ->> 'name';
      end if;
    else
      if v_result.ok or v_result.error is distinct from v_expect ->> 'error' then
        raise exception 'FAIL: SQL transition should reject: %', c ->> 'name';
      end if;
    end if;
    v_checked := v_checked + 1;
  end loop;
  if v_checked = 0 then
    raise exception 'FAIL: no transition cases were checked';
  end if;
  raise notice 'PASS: SQL state function matches % transition cases', v_checked;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Setup as the owner: three users. Synthetic data only, no real customers.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@test.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'agent1@test.invalid'),
  ('00000000-0000-4000-8000-000000000003', 'agent2@test.invalid');

insert into public.profiles (id, role, display_name) values
  ('00000000-0000-4000-8000-000000000001', 'admin', 'Test Admin'),
  ('00000000-0000-4000-8000-000000000002', 'agent', 'Test Agent 1'),
  ('00000000-0000-4000-8000-000000000003', 'agent', 'Test Agent 2');

-- Lookups that bypass RLS, used only by the test script. Tests read versions instead of hardcoding them.
create function test_helpers.version_of(p_source text) returns integer
language sql security definer set search_path = '' as $$
  select o.version from public.orders as o where o.source_order_id = p_source
$$;

create function test_helpers.order_id(p_source text) returns uuid
language sql security definer set search_path = '' as $$
  select o.id from public.orders as o where o.source_order_id = p_source
$$;

-- ---------------------------------------------------------------------------
-- 3. Import (service role). Seven synthetic orders covering the repeat-customer cases.
-- ---------------------------------------------------------------------------
select test_helpers.act_as_service();

do $$
declare r jsonb;
begin
  r := public.import_source_orders('test-batch.json', repeat('a', 64), '[{"id":"BRX-9001","created_at":"2026-09-01T10:00:00+01:00","customer":{"name":"Test Customer A","phone":"+212600111222"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"delivered"},{"id":"BRX-9002","created_at":"2026-09-02T10:00:00+01:00","customer":{"name":"Test Customer B","phone":"+212600333444"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"refused"},{"id":"BRX-9003","created_at":"2026-10-01T10:00:00+01:00","customer":{"name":"Test Customer A","phone":"+212600111222"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9004","created_at":"2026-10-02T10:00:00+01:00","customer":{"name":"Test Customer B","phone":"+212600333444"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9005","created_at":"2026-10-03T10:00:00+01:00","customer":{"name":"Test Customer C","phone":"+212600555666"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9006","created_at":"2026-09-03T10:00:00+01:00","customer":{"name":"Test Customer D","phone":"+212600777888"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"cancelled"},{"id":"BRX-9007","created_at":"2026-10-04T10:00:00+01:00","customer":{"name":"Test Customer D","phone":"+212600777888"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"}]'::jsonb);
  if r ->> 'status' <> 'imported' or (r ->> 'orders_created')::integer <> 7 then
    raise exception 'FAIL: import result %', r;
  end if;
  raise notice 'PASS: import created 7 orders';
end;
$$;

do $$
declare r jsonb;
begin
  r := public.import_source_orders('test-batch.json', repeat('a', 64), '[{"id":"BRX-9001","created_at":"2026-09-01T10:00:00+01:00","customer":{"name":"Test Customer A","phone":"+212600111222"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"delivered"},{"id":"BRX-9002","created_at":"2026-09-02T10:00:00+01:00","customer":{"name":"Test Customer B","phone":"+212600333444"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"refused"},{"id":"BRX-9003","created_at":"2026-10-01T10:00:00+01:00","customer":{"name":"Test Customer A","phone":"+212600111222"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9004","created_at":"2026-10-02T10:00:00+01:00","customer":{"name":"Test Customer B","phone":"+212600333444"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9005","created_at":"2026-10-03T10:00:00+01:00","customer":{"name":"Test Customer C","phone":"+212600555666"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9006","created_at":"2026-09-03T10:00:00+01:00","customer":{"name":"Test Customer D","phone":"+212600777888"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"cancelled"},{"id":"BRX-9007","created_at":"2026-10-04T10:00:00+01:00","customer":{"name":"Test Customer D","phone":"+212600777888"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"}]'::jsonb);
  if r ->> 'status' <> 'already_imported' then
    raise exception 'FAIL: repeat import with same checksum should be a no-op, got %', r;
  end if;
  raise notice 'PASS: repeat import with same file checksum is a no-op';
end;
$$;

select test_helpers.expect_error($q$
  select public.import_source_orders('changed.json', repeat('b', 64), '[{"id":"BRX-9001","created_at":"2026-09-01T10:00:00+01:00","customer":{"name":"Test Customer Z","phone":"+212600111222"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"delivered"},{"id":"BRX-9002","created_at":"2026-09-02T10:00:00+01:00","customer":{"name":"Test Customer B","phone":"+212600333444"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"refused"},{"id":"BRX-9003","created_at":"2026-10-01T10:00:00+01:00","customer":{"name":"Test Customer A","phone":"+212600111222"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9004","created_at":"2026-10-02T10:00:00+01:00","customer":{"name":"Test Customer B","phone":"+212600333444"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9005","created_at":"2026-10-03T10:00:00+01:00","customer":{"name":"Test Customer C","phone":"+212600555666"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"},{"id":"BRX-9006","created_at":"2026-09-03T10:00:00+01:00","customer":{"name":"Test Customer D","phone":"+212600777888"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"cancelled"},{"id":"BRX-9007","created_at":"2026-10-04T10:00:00+01:00","customer":{"name":"Test Customer D","phone":"+212600777888"},"shipping_address":{"city":"Rabat","district":"Test district","address1":"1 test street"},"line_items":[{"sku":"BRX-001","title":"Produit test","quantity":1,"unit_price":100}],"subtotal":100,"shipping_fee":30,"total":130,"currency":"MAD","payment_method":"COD","status":"new"}]'::jsonb)
$q$, 'HV009');
select test_helpers.act_as_owner();
select test_helpers.note('PASS: changed source data for an existing order aborts the import');

do $$
begin
  if (select count(*) from public.orders) <> 7 then
    raise exception 'FAIL: expected 7 orders after imports';
  end if;
  if (select count(*) from public.orders where source_status = 'new' and pipeline_status = 'New') <> 4 then
    raise exception 'FAIL: expected 4 active pipeline orders';
  end if;
  if (select count(*) from public.orders where source_status <> 'new' and pipeline_status is null) <> 3 then
    raise exception 'FAIL: expected 3 historical orders outside the pipeline';
  end if;
  if (select count(*) from public.order_events where event_type = 'imported') <> 4 then
    raise exception 'FAIL: expected one imported event per active order only';
  end if;
  raise notice 'PASS: 7 orders, 4 in pipeline, 3 historical, 4 imported events';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Database constraints (owner bypasses RLS, so these test the CHECK constraints directly)
-- ---------------------------------------------------------------------------
select test_helpers.expect_error($q$ update public.orders set pipeline_status = 'New' where source_order_id = 'BRX-9001' $q$, '23514');
select test_helpers.expect_error($q$ update public.orders set pipeline_status = null where source_order_id = 'BRX-9003' $q$, '23514');
select test_helpers.expect_error($q$ update public.orders set cancel_reason = 'refused' where source_order_id = 'BRX-9003' $q$, '23514');
select test_helpers.note('PASS: CHECK constraints reject a historical order with a pipeline status and an active order without one');

-- ---------------------------------------------------------------------------
-- 5. Assignment: admin only, active agents only, historical orders never assigned
-- ---------------------------------------------------------------------------
select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare r public.order_mutation;
begin
  -- Imported orders start at version 1. Each successful assignment advances the version by one.
  if test_helpers.version_of('BRX-9005') <> 1 or test_helpers.version_of('BRX-9007') <> 1 then
    raise exception 'FAIL: imported orders should start at version 1';
  end if;
  r := public.assign_order(test_helpers.order_id('BRX-9005'), '00000000-0000-4000-8000-000000000002', 1);
  if r.version <> 2 or test_helpers.version_of('BRX-9005') <> 2 then raise exception 'FAIL: BRX-9005 should be version 2 after assignment'; end if;
  r := public.assign_order(test_helpers.order_id('BRX-9007'), '00000000-0000-4000-8000-000000000003', 1);
  if r.version <> 2 or test_helpers.version_of('BRX-9007') <> 2 then raise exception 'FAIL: BRX-9007 should be version 2 after assignment'; end if;
end;
$$;
select test_helpers.expect_error($q$ select * from public.assign_order(test_helpers.order_id('BRX-9001'), '00000000-0000-4000-8000-000000000002', 1) $q$, 'HV005');
select test_helpers.expect_error($q$ select * from public.assign_order(test_helpers.order_id('BRX-9005'), '00000000-0000-4000-8000-000000000003', 1) $q$, 'HV004');
select test_helpers.note('PASS: admin assigns active orders; historical order rejected with HV005');

select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
select test_helpers.expect_error($q$ select * from public.assign_order(test_helpers.order_id('BRX-9005'), '00000000-0000-4000-8000-000000000002', test_helpers.version_of('BRX-9005')) $q$, 'HV002');
select test_helpers.expect_error($q$ select * from public.assign_order(test_helpers.order_id('BRX-9005'), '00000000-0000-4000-8000-000000000003', test_helpers.version_of('BRX-9005')) $q$, 'HV002');
select test_helpers.note('PASS: agent cannot assign, including to themselves (HV002)');

-- ---------------------------------------------------------------------------
-- 6. Direct writes and role changes are denied to agents
-- ---------------------------------------------------------------------------
select test_helpers.expect_error($q$ update public.orders set pipeline_status = 'Confirmed' where true $q$, '42501');
select test_helpers.expect_error($q$ update public.profiles set role = 'admin' where true $q$, '42501');
select test_helpers.expect_error($q$ insert into public.call_attempts (order_id, agent_id, outcome, idempotency_key, unanswered_attempt_count_after) values (test_helpers.order_id('BRX-9005'), '00000000-0000-4000-8000-000000000002', 'answered', gen_random_uuid(), 0) $q$, '42501');
select test_helpers.note('PASS: direct UPDATE on orders, UPDATE on profiles and direct INSERT on call_attempts are denied');

do $$
begin
  if (select count(*) from public.orders) <> 1 then raise exception 'FAIL: agent 1 should see only its 1 order'; end if;
  if (select count(*) from public.customers) <> 1 then raise exception 'FAIL: agent 1 should see only 1 customer'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: agent 1 should see only its own profile'; end if;
  if (select count(*) from public.source_records) <> 0 then raise exception 'FAIL: agent 1 must not read source payloads'; end if;
  if (select count(*) from public.import_batches) <> 0 then raise exception 'FAIL: agent 1 must not read import history'; end if;
  raise notice 'PASS: agent 1 sees only its own order, customer and profile; no payloads or import history';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Call flow for the agent: attempts, version conflict, idempotent replay, auto-cancel
-- ---------------------------------------------------------------------------
do $$
declare r public.order_mutation;
begin
  r := public.log_call_attempt(test_helpers.order_id('BRX-9005'), 'no_answer', test_helpers.version_of('BRX-9005'), '11111111-1111-4111-8111-111111111111');
  if r.status <> 'No Answer' or r.unanswered_attempt_count <> 1 or r.version <> 3 or r.replayed then
    raise exception 'FAIL: first no-answer result %', r;
  end if;
  raise notice 'PASS: first unanswered call moves New to No Answer';
end;
$$;

-- Stale on purpose: version 2 was current before the first call, which moved the order to version 3.
select test_helpers.expect_error($q$ select * from public.log_call_attempt(test_helpers.order_id('BRX-9005'), 'no_answer', 2, '22222222-2222-4222-8222-222222222222') $q$, 'HV004');
select test_helpers.note('PASS: stale version is rejected with HV004');

do $$
declare r public.order_mutation;
begin
  r := public.log_call_attempt(test_helpers.order_id('BRX-9005'), 'no_answer', test_helpers.version_of('BRX-9005'), '11111111-1111-4111-8111-111111111111');
  if not r.replayed or r.version <> 3 or r.unanswered_attempt_count <> 1 then
    raise exception 'FAIL: replay should return stored state without writing: %', r;
  end if;
  raise notice 'PASS: same idempotency key replays the stored result';
end;
$$;

select test_helpers.act_as('00000000-0000-4000-8000-000000000003');
select test_helpers.expect_error($q$ select * from public.log_call_attempt(test_helpers.order_id('BRX-9005'), 'no_answer', test_helpers.version_of('BRX-9005'), '99999999-9999-4999-8999-999999999999') $q$, 'HV003');
select test_helpers.expect_error($q$ select * from public.add_order_note(test_helpers.order_id('BRX-9005'), 'not mine') $q$, 'HV003');
select test_helpers.note('PASS: agent 2 cannot act on or note agent 1 order (HV003, no existence leak)');

select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
do $$
declare r public.order_mutation;
begin
  r := public.log_call_attempt(test_helpers.order_id('BRX-9005'), 'no_answer', test_helpers.version_of('BRX-9005'), '22222222-2222-4222-8222-222222222222');
  if r.status <> 'No Answer' or r.unanswered_attempt_count <> 2 or r.version <> 4 then
    raise exception 'FAIL: second no-answer %', r;
  end if;
  r := public.log_call_attempt(test_helpers.order_id('BRX-9005'), 'no_answer', test_helpers.version_of('BRX-9005'), '33333333-3333-4333-8333-333333333333');
  if r.status <> 'Cancelled' or r.cancel_reason <> 'three_unanswered_attempts' or r.unanswered_attempt_count <> 3 or r.version <> 5 then
    raise exception 'FAIL: third no-answer should auto-cancel: %', r;
  end if;
  raise notice 'PASS: third unanswered attempt auto-cancels with reason three_unanswered_attempts';
end;
$$;

select test_helpers.expect_error($q$ select * from public.confirm_order(test_helpers.order_id('BRX-9005'), test_helpers.version_of('BRX-9005')) $q$, 'HV006');
select test_helpers.note('PASS: confirm after cancellation is rejected with HV006');

-- ---------------------------------------------------------------------------
-- 8. Notes and the repeat-customer summary
-- ---------------------------------------------------------------------------
do $$
begin
  if (select id from public.orders where source_order_id = 'BRX-9005') is null then raise exception 'FAIL: setup'; end if;
  perform public.add_order_note(test_helpers.order_id('BRX-9005'), 'Customer asked to call back');
  raise notice 'PASS: assigned agent can add a note';
end;
$$;

select test_helpers.act_as('00000000-0000-4000-8000-000000000001');
do $$
declare s record;
begin
  select * into s from public.repeat_customer_summary(test_helpers.order_id('BRX-9004'));
  if s.prior_refused_count <> 1 or s.prior_cancelled_count <> 0 then raise exception 'FAIL: 9004 should warn on refused history, got %/%', s.prior_refused_count, s.prior_cancelled_count; end if;
  select * into s from public.repeat_customer_summary(test_helpers.order_id('BRX-9003'));
  if s.prior_refused_count <> 0 or s.prior_cancelled_count <> 0 then raise exception 'FAIL: 9003 has delivered-only history and must not warn'; end if;
  select * into s from public.repeat_customer_summary(test_helpers.order_id('BRX-9007'));
  if s.prior_refused_count <> 0 or s.prior_cancelled_count <> 1 then raise exception 'FAIL: 9007 should warn on cancelled history'; end if;
  raise notice 'PASS: repeat summary warns on refused and cancelled history, not on delivered-only';
end;
$$;

select test_helpers.act_as('00000000-0000-4000-8000-000000000002');
select test_helpers.expect_error($q$ select * from public.repeat_customer_summary(test_helpers.order_id('BRX-9004')) $q$, 'HV003');
select test_helpers.note('PASS: agent cannot query repeat summary for an unrelated order');

-- ---------------------------------------------------------------------------
-- 9. Append-only guards, audit completeness, privileges and RLS coverage (owner)
-- ---------------------------------------------------------------------------
select test_helpers.act_as_owner();
select test_helpers.expect_error($q$ update public.call_attempts set outcome = 'answered' $q$, 'HV010');
select test_helpers.expect_error($q$ delete from public.order_events $q$, 'HV010');
select test_helpers.expect_error($q$ update public.source_records set created_at = now() $q$, 'HV010');
-- TRUNCATE has two separate protections, tested separately.
-- (a) PostgreSQL itself refuses TRUNCATE on a table that another table references (SQLSTATE 0A000).
--     This runs before any trigger, so import_batches (referenced by orders) hits this first.
select test_helpers.expect_error($q$ truncate public.import_batches $q$, '0A000');
select test_helpers.expect_error($q$ truncate public.orders $q$, '0A000');

-- (b) Our own TRUNCATE triggers. Use tables that nothing references, so the trigger is what fires.
select test_helpers.expect_error($q$ truncate public.order_notes $q$, 'HV010');
select test_helpers.expect_error($q$ truncate public.order_events $q$, 'HV010');
select test_helpers.expect_error($q$ truncate public.call_attempts $q$, 'HV010');
select test_helpers.expect_error($q$ truncate public.source_records $q$, 'HV010');
select test_helpers.expect_error($q$ truncate public.order_items $q$, 'HV012');

-- (c) CASCADE reaches the referencing tables. Some guarded table must stop it, and nothing may succeed silently.
do $$
begin
  begin
    truncate public.orders cascade;
    raise exception 'FAIL: TRUNCATE orders CASCADE succeeded';
  exception when others then
    if sqlstate not in ('HV010', 'HV012') then
      raise exception 'FAIL: TRUNCATE orders CASCADE failed with unexpected % (%)', sqlstate, sqlerrm;
    end if;
  end;
end;
$$;

-- (d) Structure: every table has a BEFORE TRUNCATE trigger (tgtype bit 32 = TRUNCATE, bit 2 = BEFORE).
do $$
declare n integer;
begin
  select count(distinct c.relname) into n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and not t.tgisinternal
    and (t.tgtype::integer & 32) <> 0
    and (t.tgtype::integer & 2) <> 0
    and c.relname in ('profiles', 'customers', 'import_batches', 'orders', 'order_items',
                      'source_records', 'call_attempts', 'order_notes', 'order_events');
  if n <> 9 then
    raise exception 'FAIL: % of 9 tables have a BEFORE TRUNCATE trigger', n;
  end if;
end;
$$;

-- (e) Structure: append-only tables have BEFORE UPDATE and BEFORE DELETE triggers (bits 16 and 8).
do $$
declare n integer;
begin
  select count(distinct c.relname) into n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and not t.tgisinternal
    and (t.tgtype::integer & 16) <> 0
    and (t.tgtype::integer & 8) <> 0
    and (t.tgtype::integer & 2) <> 0
    and c.relname in ('call_attempts', 'order_notes', 'order_events', 'import_batches', 'source_records');
  if n <> 5 then
    raise exception 'FAIL: % of 5 append-only tables have BEFORE UPDATE/DELETE triggers', n;
  end if;
end;
$$;

-- (f) Direct UPDATE and DELETE on the append-only tables not yet covered.
select test_helpers.expect_error($q$ update public.import_batches set record_count = record_count $q$, 'HV010');
select test_helpers.expect_error($q$ delete from public.import_batches $q$, 'HV010');
select test_helpers.expect_error($q$ update public.order_notes set body = 'changed' $q$, 'HV010');
select test_helpers.expect_error($q$ delete from public.order_notes $q$, 'HV010');
select test_helpers.expect_error($q$ delete from public.call_attempts $q$, 'HV010');
select test_helpers.expect_error($q$ delete from public.orders $q$, 'HV011');
select test_helpers.note('PASS: append-only tables and orders reject UPDATE, DELETE and TRUNCATE for the owner');

do $$
begin
  if (select count(*) from public.call_attempts a join public.orders o on o.id = a.order_id where o.source_order_id = 'BRX-9005') <> 3 then
    raise exception 'FAIL: expected 3 call attempts for BRX-9005 (replay and stale calls must not add rows)';
  end if;
  if (select count(*) from public.order_events e join public.orders o on o.id = e.order_id where o.source_order_id = 'BRX-9005') <> 6 then
    raise exception 'FAIL: expected 6 events for BRX-9005: imported, assigned, 3 call_no_answer, auto_cancelled';
  end if;
  raise notice 'PASS: audit rows match the workflow for BRX-9005';
end;
$$;

do $$
begin
  if not has_function_privilege('authenticated', 'public.log_call_attempt(uuid,text,integer,uuid)', 'EXECUTE') then raise exception 'FAIL: authenticated must execute log_call_attempt'; end if;
  if has_function_privilege('anon', 'public.log_call_attempt(uuid,text,integer,uuid)', 'EXECUTE') then raise exception 'FAIL: anon must not execute log_call_attempt'; end if;
  if has_function_privilege('authenticated', 'public.import_source_orders(text,text,jsonb)', 'EXECUTE') then raise exception 'FAIL: authenticated must not import'; end if;
  if not has_function_privilege('service_role', 'public.import_source_orders(text,text,jsonb)', 'EXECUTE') then raise exception 'FAIL: service_role must import'; end if;
  if has_table_privilege('authenticated', 'public.orders', 'UPDATE') then raise exception 'FAIL: authenticated must not have UPDATE on orders'; end if;
  if has_table_privilege('anon', 'public.orders', 'SELECT') then raise exception 'FAIL: anon must not read orders'; end if;
  raise notice 'PASS: function and table privileges match the least-privilege design';
end;
$$;

do $$
declare n integer;
begin
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  if n <> 0 then raise exception 'FAIL: % public tables have RLS disabled', n; end if;
  raise notice 'PASS: RLS enabled on every public table';
end;
$$;

rollback;
