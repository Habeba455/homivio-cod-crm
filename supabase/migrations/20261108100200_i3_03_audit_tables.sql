-- I-3 migration 3: call attempts, order notes, order events, and append-only guards.
-- Architecture: docs/architecture.md §8.3, §10.5 and §10.6.

create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  agent_id uuid not null references public.profiles (id) on delete restrict,
  outcome public.call_outcome not null,
  idempotency_key uuid not null unique,
  unanswered_attempt_count_after integer not null check (unanswered_attempt_count_after >= 0),
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index call_attempts_order_created_idx on public.call_attempts (order_id, created_at);

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index order_notes_order_created_idx on public.order_notes (order_id, created_at);

-- Event types are fixed here so that no client can invent an audit category.
-- Payloads hold identifiers, statuses, counts and reasons only, never customer data.
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete restrict,
  event_type text not null check (event_type in (
    'imported', 'call_answered', 'call_no_answer', 'confirmed',
    'cancelled', 'auto_cancelled', 'assigned', 'reassigned'
  )),
  from_status public.pipeline_status,
  to_status public.pipeline_status,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint order_events_actor_required check (actor_id is not null or event_type = 'imported')
);

create index order_events_order_created_idx on public.order_events (order_id, created_at);

-- Append-only: no UPDATE, DELETE or TRUNCATE for any role, including the owner and service role.
create trigger call_attempts_append_only
  before update or delete on public.call_attempts
  for each row execute function app_private.forbid_change();
create trigger call_attempts_no_truncate
  before truncate on public.call_attempts
  for each statement execute function app_private.forbid_change();

create trigger order_notes_append_only
  before update or delete on public.order_notes
  for each row execute function app_private.forbid_change();
create trigger order_notes_no_truncate
  before truncate on public.order_notes
  for each statement execute function app_private.forbid_change();

create trigger order_events_append_only
  before update or delete on public.order_events
  for each row execute function app_private.forbid_change();
create trigger order_events_no_truncate
  before truncate on public.order_events
  for each statement execute function app_private.forbid_change();

create trigger import_batches_append_only
  before update or delete on public.import_batches
  for each row execute function app_private.forbid_change();
create trigger import_batches_no_truncate
  before truncate on public.import_batches
  for each statement execute function app_private.forbid_change();

create trigger source_records_append_only
  before update or delete on public.source_records
  for each row execute function app_private.forbid_change();
create trigger source_records_no_truncate
  before truncate on public.source_records
  for each statement execute function app_private.forbid_change();
