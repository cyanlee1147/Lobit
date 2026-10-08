-- 醫療紀錄升級：單據照片 + 常用醫院。在 Supabase SQL Editor 執行一次。
-- 1. 就診紀錄可存多張照片（存的是 Storage 內的路徑，不是公開網址）
alter table public.medical_records add column if not exists photos text[] not null default '{}';

-- 2. 常用醫院
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 150),
  phone text check (char_length(phone) <= 40),
  address text check (char_length(address) <= 300),
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);
alter table public.clinics enable row level security;
drop policy if exists "clinics own" on public.clinics;
create policy "clinics own" on public.clinics for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- 3. 私人照片空間：只能讀寫自己資料夾（<使用者 id>/...）的檔案
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medical-photos', 'medical-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "medical photos read own" on storage.objects;
drop policy if exists "medical photos insert own" on storage.objects;
drop policy if exists "medical photos delete own" on storage.objects;
create policy "medical photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'medical-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "medical photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'medical-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "medical photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'medical-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
