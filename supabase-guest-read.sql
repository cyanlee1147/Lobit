-- 訪客瀏覽：已經跑過 supabase-schema.sql 的專案，只要在 SQL Editor 執行這個檔案一次。
-- 讓未登入的訪客可以「讀」社群發文與回覆；發文、回覆、刪除仍限登入會員。
-- profiles（暱稱）、兔寶、照護、提醒、醫療資料維持只有登入者可讀。
drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts for select to anon, authenticated using (true);
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to anon, authenticated using (true);
