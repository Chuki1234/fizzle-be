-- ============================================================================
-- Fizzle — 0002_chat_and_servers
--
-- Tables for Servers, Channels, Server Members, Channel Messages,
-- Direct Messages, and Friendships in Supabase.
-- ============================================================================

-- 1. Servers Table
create table if not exists public.servers (
  id text primary key,
  name text not null,
  icon text not null default '🔥',
  creator_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Channels Table
create table if not exists public.channels (
  id text primary key,
  server_id text not null references public.servers (id) on delete cascade,
  name text not null,
  type text not null default 'text' check (type in ('text', 'voice')),
  created_at timestamptz not null default now()
);

-- 3. Server Members Table
create table if not exists public.server_members (
  server_id text not null references public.servers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

-- 4. Channel Messages Table
create table if not exists public.channel_messages (
  id text primary key,
  channel_id text not null references public.channels (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  sender_name text not null,
  text text not null,
  created_at timestamptz not null default now()
);

-- 5. Direct Messages Table
create table if not exists public.direct_messages (
  id text primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  sender_name text not null,
  text text not null,
  created_at timestamptz not null default now()
);

-- 6. Friendships Table
create table if not exists public.friendships (
  id text primary key,
  user_a_id uuid not null references auth.users (id) on delete cascade,
  user_b_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'friend', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for blazing fast lookups
create index if not exists idx_channels_server_id on public.channels (server_id);
create index if not exists idx_server_members_user_id on public.server_members (user_id);
create index if not exists idx_channel_messages_channel_id on public.channel_messages (channel_id);
create index if not exists idx_direct_messages_participants on public.direct_messages (sender_id, recipient_id);
create index if not exists idx_friendships_users on public.friendships (user_a_id, user_b_id);

-- Enable Row Level Security (RLS)
alter table public.servers enable row level security;
alter table public.channels enable row level security;
alter table public.server_members enable row level security;
alter table public.channel_messages enable row level security;
alter table public.direct_messages enable row level security;
alter table public.friendships enable row level security;

-- Public authenticated read/write policies (Service Role bypasses RLS)
create policy servers_authenticated on public.servers for all to authenticated using (true) with check (true);
create policy channels_authenticated on public.channels for all to authenticated using (true) with check (true);
create policy server_members_authenticated on public.server_members for all to authenticated using (true) with check (true);
create policy channel_messages_authenticated on public.channel_messages for all to authenticated using (true) with check (true);
create policy direct_messages_authenticated on public.direct_messages for all to authenticated using (true) with check (true);
create policy friendships_authenticated on public.friendships for all to authenticated using (true) with check (true);
