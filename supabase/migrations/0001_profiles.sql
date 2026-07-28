-- ============================================================================
-- Fizzle — 0001_profiles
--
-- Supabase owns credentials in `auth.users`; this table owns everything the
-- product needs about a person. One row per account, created by the NestJS
-- auth service immediately after sign-up.
--
-- Run in Supabase Studio -> SQL Editor, or via `supabase db push`.
-- ============================================================================

create type public.presence_status as enum ('online', 'idle', 'dnd', 'offline');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  username text not null,
  display_name text not null,

  avatar_url text,
  banner_url text,
  status_message text,

  presence public.presence_status not null default 'offline',
  birthdate date,

  accepts_marketing_email boolean not null default false,
  two_factor_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Handles are matched exactly, so store them already-normalized rather than
  -- lower()-ing on every lookup.
  constraint profiles_username_lowercase check (username = lower(username)),
  constraint profiles_username_format check (username ~ '^[a-z0-9._]{2,32}$'),
  constraint profiles_display_name_length check (
    char_length(display_name) between 1 and 32
  )
);

create unique index profiles_username_key on public.profiles (username);

-- Friend search hits this constantly once the dashboard lands.
create index profiles_display_name_idx on public.profiles (display_name);

-- --- updated_at -------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- --- Row Level Security -----------------------------------------------------
-- The API uses the service-role key, which bypasses RLS. These policies exist
-- so that a leaked anon key still cannot be used to read or rewrite the table
-- beyond what a signed-in user is entitled to.

alter table public.profiles enable row level security;

-- Profiles are public within the app: member lists, message authors and friend
-- search all need to resolve other people. Nothing sensitive lives here —
-- email stays in auth.users.
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);
