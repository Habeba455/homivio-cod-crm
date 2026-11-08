-- I-3 migration 8: idempotent import of the source file. Callable only with the service-role key.
-- Architecture: docs/architecture.md §5.3 and §8.2.
-- The operator script (I-5) validates the whole file with Zod first. This function is the transactional write.
-- Any error aborts the whole import, because the function is one transaction.

create function public.import_source_orders(p_file_name text, p_file_sha256 text, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_elem jsonb;
  v_customer uuid;
  v_order uuid;
  v_status text;
  v_hash text;
  v_existing_hash text;
  v_subtotal numeric(12,2);
  v_items_sum numeric(12,2);
  v_created integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'import is restricted to the service role' using errcode = 'HV002';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'orders must be a non-empty JSON array' using errcode = 'HV007';
  end if;

  -- Same file checksum already imported: nothing is written.
  if exists (select 1 from public.import_batches as b where b.source_file_sha256 = p_file_sha256) then
    return jsonb_build_object('status', 'already_imported');
  end if;

  insert into public.import_batches (source_file_name, source_file_sha256, record_count)
  values (p_file_name, p_file_sha256, jsonb_array_length(p_orders))
  returning id into v_batch;

  for v_elem in select t.value from jsonb_array_elements(p_orders) as t(value) loop
    v_status := v_elem ->> 'status';
    -- Hash of the untouched source object. Detects a changed re-export of the same order ID.
    v_hash := encode(sha256(convert_to(v_elem::text, 'UTF8')), 'hex');
    v_subtotal := (v_elem ->> 'subtotal')::numeric(12,2);

    -- Money check: the line items must add up to the stated subtotal.
    select coalesce(sum((li.item ->> 'quantity')::integer * (li.item ->> 'unit_price')::numeric(12,2)), 0)
      into v_items_sum
      from jsonb_array_elements(v_elem -> 'line_items') as li(item);
    if v_items_sum <> v_subtotal then
      raise exception 'line items do not sum to the subtotal for %', v_elem ->> 'id' using errcode = 'HV007';
    end if;

    -- Customer is keyed by normalised phone. The first name seen is kept and never overwritten.
    insert into public.customers (phone_e164, display_name)
    values (v_elem #>> '{customer,phone}', v_elem #>> '{customer,name}')
    on conflict (phone_e164) do nothing;

    select c.id into strict v_customer
    from public.customers as c
    where c.phone_e164 = v_elem #>> '{customer,phone}';

    insert into public.orders (
      source_order_id, customer_id, source_status, pipeline_status,
      shipping_city, shipping_district, shipping_address1,
      currency, payment_method, subtotal, shipping_fee, total,
      source_created_at, source_payload_sha256, import_batch_id
    )
    values (
      v_elem ->> 'id',
      v_customer,
      v_status,
      case when v_status = 'new' then 'New'::public.pipeline_status else null end,
      v_elem #>> '{shipping_address,city}',
      v_elem #>> '{shipping_address,district}',
      v_elem #>> '{shipping_address,address1}',
      v_elem ->> 'currency',
      v_elem ->> 'payment_method',
      v_subtotal,
      (v_elem ->> 'shipping_fee')::numeric(12,2),
      (v_elem ->> 'total')::numeric(12,2),
      (v_elem ->> 'created_at')::timestamptz,
      v_hash,
      v_batch
    )
    on conflict (source_order_id) do nothing
    returning id into v_order;

    if v_order is null then
      -- Already present. Identical source data is skipped. Changed source data is an error, never an update.
      select o.source_payload_sha256 into v_existing_hash
      from public.orders as o
      where o.source_order_id = v_elem ->> 'id';

      if v_existing_hash is distinct from v_hash then
        raise exception 'source data changed for %; import aborted', v_elem ->> 'id' using errcode = 'HV009';
      end if;
      continue;
    end if;

    insert into public.order_items (order_id, line_no, sku, title, quantity, unit_price)
    select
      v_order,
      li.ord,
      li.item ->> 'sku',
      li.item ->> 'title',
      (li.item ->> 'quantity')::integer,
      (li.item ->> 'unit_price')::numeric(12,2)
    from jsonb_array_elements(v_elem -> 'line_items') with ordinality as li(item, ord);

    insert into public.source_records (order_id, source_payload)
    values (v_order, v_elem);

    -- Only pipeline orders get an audit event. Historical orders have no workflow history.
    if v_status = 'new' then
      insert into public.order_events (order_id, actor_id, event_type, from_status, to_status, payload)
      values (v_order, null, 'imported', null, 'New'::public.pipeline_status,
              jsonb_build_object('import_batch_id', v_batch));
    end if;

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('status', 'imported', 'batch_id', v_batch, 'orders_created', v_created);
end;
$$;
