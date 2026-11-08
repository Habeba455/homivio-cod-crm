-- I-3 migration 2: customers, import batches, orders, line items, and admin-only source records.
-- Architecture: docs/architecture.md §8.2 and §8.3.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+212[5-7][0-9]{8}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null check (char_length(source_file_name) between 1 and 200),
  source_file_sha256 text not null unique check (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  record_count integer not null check (record_count > 0),
  imported_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  source_order_id text not null unique check (source_order_id ~ '^BRX-[0-9]{4}$'),
  customer_id uuid not null references public.customers (id) on delete restrict,

  -- Source status is the exact value from the file. Pipeline status belongs to the CRM only.
  source_status text not null check (source_status in ('new', 'delivered', 'refused', 'cancelled')),
  pipeline_status public.pipeline_status,
  assigned_agent_id uuid references public.profiles (id) on delete restrict,

  shipping_city text not null check (char_length(btrim(shipping_city)) > 0),
  shipping_district text not null,
  shipping_address1 text not null check (char_length(btrim(shipping_address1)) > 0),

  currency text not null default 'MAD' check (currency = 'MAD'),
  payment_method text not null default 'COD' check (payment_method = 'COD'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_fee numeric(12,2) not null check (shipping_fee >= 0),
  total numeric(12,2) not null,

  source_created_at timestamptz not null,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  import_batch_id uuid not null references public.import_batches (id) on delete restrict,

  version integer not null default 1 check (version >= 1),
  unanswered_attempt_count integer not null default 0 check (unanswered_attempt_count >= 0),
  cancel_reason text check (cancel_reason in ('refused', 'requested_by_customer', 'other', 'three_unanswered_attempts')),
  confirmed_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_total_matches check (total = subtotal + shipping_fee),
  constraint orders_pipeline_iff_new check ((source_status = 'new') = (pipeline_status is not null)),
  constraint orders_agent_only_in_pipeline check (assigned_agent_id is null or source_status = 'new'),
  constraint orders_confirmed_consistent check ((confirmed_at is null) = (pipeline_status is distinct from 'Confirmed')),
  constraint orders_cancelled_consistent check ((cancelled_at is null) = (pipeline_status is distinct from 'Cancelled')),
  constraint orders_cancel_reason_needs_cancelled check (cancel_reason is null or pipeline_status is not distinct from 'Cancelled'),
  constraint orders_cancelled_has_reason check (pipeline_status is distinct from 'Cancelled' or cancel_reason is not null)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  line_no integer not null check (line_no > 0),
  sku text not null check (sku ~ '^BRX-[0-9]{3}$'),
  title text not null check (char_length(btrim(title)) > 0),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  constraint order_items_line_unique unique (order_id, line_no)
);

-- Raw source object, including customer name and address. Readable by admins only (see RLS migration).
create table public.source_records (
  order_id uuid primary key references public.orders (id) on delete restrict,
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz not null default now()
);

create index orders_assigned_pipeline_idx on public.orders (assigned_agent_id, pipeline_status);
create index orders_customer_created_idx on public.orders (customer_id, source_created_at);
create index orders_pipeline_created_idx on public.orders (pipeline_status, source_created_at);

-- An order can only be assigned to an active agent. Defense in depth behind the assign_order RPC.
create function app_private.check_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_agent_id is not null and not exists (
    select 1
    from public.profiles as p
    where p.id = new.assigned_agent_id
      and p.role = 'agent'
      and p.is_active
  ) then
    raise exception 'assignee must be an active agent' using errcode = 'HV008';
  end if;
  return new;
end;
$$;

create trigger orders_check_assignee
  before insert or update of assigned_agent_id on public.orders
  for each row execute function app_private.check_assignee();

create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function app_private.touch_updated_at();

create trigger orders_forbid_delete
  before delete on public.orders
  for each row execute function app_private.forbid_delete();

create trigger customers_forbid_delete
  before delete on public.customers
  for each row execute function app_private.forbid_delete();

create trigger order_items_forbid_delete
  before delete on public.order_items
  for each row execute function app_private.forbid_delete();
