-- 兔兔小幫手：每日使用次數紀錄。在 Supabase SQL Editor 執行一次。
-- 開啟 RLS 但不建立任何 policy：前端讀寫不到，只有 Edge Function 的 service role 能存取。
create table if not exists public.bot_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  created_at timestamptz not null default now()
);
create index if not exists bot_usage_user_time on public.bot_usage (user_id, created_at desc);
alter table public.bot_usage enable row level security;
