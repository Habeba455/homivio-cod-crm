-- I-3 migration 1: enumerations, profiles, and role helpers.
-- Architecture: docs/architecture.md §7.2 and §8.3.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.user_role as enum ('admin', 'agent');
create type public.pipeline_status as enum ('New', 'No Answer', 'Called', 'Confirmed', 'Cancelled');
create type public.call_outcome as enum ('answered', 'no_answer');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  role public.user_role not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Returns the caller's role, or NULL when the caller has no active profile.
-- Security definer so policies can read profiles without recursing into profiles' own RLS.
create function public.current_app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid()
    and p.is_active
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blocks UPDATE, DELETE and TRUNCATE on append-only tables, for every role including the owner.
create function app_private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = 'HV010';
end;
$$;

-- Blocks DELETE on tables where rows are closed by state, never removed.
create function app_private.forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'rows in % cannot be deleted', tg_table_name using errcode = 'HV011';
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app_private.touch_updated_at();
