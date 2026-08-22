-- ============================================================================
-- Fizzle — 0002_friendships
--
-- Table for user friendships and pending friend requests.
-- ============================================================================

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_unique_pair unique (user_a_id, user_b_id)
);

create index if not exists friendships_user_a_idx on public.friendships (user_a_id);
create index if not exists friendships_user_b_idx on public.friendships (user_b_id);

alter table public.friendships enable row level security;

create policy friendships_select_authenticated
  on public.friendships
  for select
  to authenticated
  using (true);

create policy friendships_insert_authenticated
  on public.friendships
  for insert
  to authenticated
  with check (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy friendships_update_authenticated
  on public.friendships
  for update
  to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy friendships_delete_authenticated
  on public.friendships
  for delete
  to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);
