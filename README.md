# 兔巢 Lobit

GitHub Pages 上的兔友社群和照護紀錄。四個區塊：社群、紀錄、提醒、醫療。

## 啟用

1. 在 Supabase 建立專案，在 SQL Editor 執行 `supabase-schema.sql`。
2. 啟用 Google 登入：
   - Google Cloud Console → API 和服務 → 憑證 → 建立「OAuth 用戶端 ID」（網頁應用程式）。
   - 「已授權的重新導向 URI」填 `https://<你的專案>.supabase.co/auth/v1/callback`。
   - 把用戶端 ID 和密鑰貼到 Supabase → Authentication → Providers → Google 並啟用。
   - Email provider 可保留，讓舊的信箱帳號繼續登入。
3. 在 Authentication → URL Configuration 設定 Site URL `https://cyanlee1147.github.io/Lobit/`，Redirect URLs 加入相同網址及 `https://cyanlee1147.github.io/Lobit/index.html`。
4. 把 Project URL 和 **publishable key**（舊版稱 anon key）填到 `config.js`。這兩項可放在前端；絕不能放 secret key 或 service_role key。
5. 將程式推到 GitHub Pages 的發布分支，重新整理網站註冊測試。

GitHub Pages 不提供瀏覽器設定 URL 時，應在 Supabase 控制台手動填寫上述正式網址。Email 確認連結會回到此站。若使用本機預覽，可另外將其實際 URL 加入 Redirect URLs。

提醒目前僅在使用者開啟網站時顯示到期狀態，不會在背景寄信或推播。訪客不用登入就能瀏覽社群發文和回覆（作者暱稱顯示為「兔友」）；發文、回覆需要登入。照護、提醒和醫療資料依 RLS 僅對建立者可見。醫療欄位用於記錄獸醫指示，不提供診斷。

目前舊版頁面的 `window.storage` 資料沒有同步至新資料庫。遷移需要先匯出舊資料並確認帳號對應，勿直接覆蓋或宣稱已搬移。

## 訪客模式

已部署過的專案，請在 SQL Editor 執行 `supabase-guest-read.sql` 一次，開放訪客讀取社群內容。
