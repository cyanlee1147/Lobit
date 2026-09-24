-- Run in Supabase SQL Editor. User records are private; community posts are public.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40),
  created_at timestamptz not null default now()
);
create table if not exists public.rabbits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  breed text,
  birthday date,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create table if not exists public.care_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  rabbit_id uuid not null,
  kind text not null check (kind in ('water','poop','food','medication','energy','other')),
  occurred_at timestamptz not null,
  amount numeric,
  unit text,
  detail text,
  created_at timestamptz not null default now(),
  foreign key (rabbit_id, owner_id) references public.rabbits(id, owner_id) on delete cascade
);
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  rabbit_id uuid not null,
  title text not null,
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (rabbit_id, owner_id) references public.rabbits(id, owner_id) on delete cascade
);
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  rabbit_id uuid not null,
  visited_at date not null,
  clinic text,
  reason text not null,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (rabbit_id, owner_id) references public.rabbits(id, owner_id) on delete cascade
);
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  content text not null check (char_length(content) between 1 and 3000),
  created_at timestamptz not null default now()
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists care_entries_rabbit_time on public.care_entries (rabbit_id, occurred_at desc);
create index if not exists reminders_owner_due on public.reminders (owner_id, due_at);
create index if not exists medical_records_rabbit_date on public.medical_records (rabbit_id, visited_at desc);
create index if not exists posts_created on public.posts (created_at desc);
create index if not exists comments_post on public.comments (post_id, created_at);

alter table public.profiles enable row level security;
alter table public.rabbits enable row level security;
alter table public.care_entries enable row level security;
alter table public.reminders enable row level security;
alter table public.medical_records enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;

create policy "profiles read signed in" on public.profiles for select to authenticated using (true);
create policy "profiles insert self" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles update self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "rabbits own" on public.rabbits for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "care own" on public.care_entries for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "reminders own" on public.reminders for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "medical own" on public.medical_records for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "posts read" on public.posts for select to authenticated using (true);
create policy "posts insert self" on public.posts for insert to authenticated with check (author_id = (select auth.uid()));
create policy "posts delete self" on public.posts for delete to authenticated using (author_id = (select auth.uid()));
create policy "comments read" on public.comments for select to authenticated using (true);
create policy "comments insert self" on public.comments for insert to authenticated with check (author_id = (select auth.uid()));
create policy "comments delete self" on public.comments for delete to authenticated using (author_id = (select auth.uid()));
