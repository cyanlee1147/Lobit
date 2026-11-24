# 樂兔本機免登入版

直接使用兔寶、照護、提醒、醫療照片與常用醫院功能。使用 IndexedDB 儲存，不連線至 Supabase，不提供 AI 或公開發文。舊雲端資料未搬移或刪除。

## 發布

將本資料夾內的 index.html、app.js、local-db.js、sw.js、privacy.html、manifest.json 及兩個 icon PNG 放到原 GitHub Pages 發布目錄並提交。第一次開啟請連線，等待 service worker 完成快取；若仍看到舊版，關閉舊分頁後重新整理。若舊 service worker 持續控制頁面，可在瀏覽器開發工具 Application → Service Workers 更新或解除註冊；不要清除 IndexedDB，以免刪除本機資料。

## 本機預覽

使用 HTTP 靜態伺服器（例如 `python -m http.server 8765`）開啟，避免直接雙擊 HTML。HTTPS 或 localhost 才支援 service worker。

## 資料管理

定期匯出 JSON 備份，包含照片。匯入會取代目前全部紀錄並需確認；先匯出舊備份。換瀏覽器、網址或裝置需手動匯入。備份未加密；同一瀏覽器的其他使用者能讀取本機資料。

離線可記錄及查看已存照片；外部社群、地圖及行事曆網頁需要網路。網站內到期狀態不等同背景推播。

## 技術說明

local-db.js 提供原 UI 使用的資料介面，所有寫入透過 IndexedDB transaction 持久保存；照片刪除與醫療紀錄刪除在同一交易完成。醫療紀錄成功建立後，後續操作失敗不會再刪除照片。未修改原 Supabase SQL 或權限政策。

## 已執行的驗證

已透過本機瀏覽器測試免登入新增兔寶、照護紀錄重新載入、提醒完成、就診保存、照片重新讀取、備份 UI 匯出與匯入；停止本機伺服器後仍可重新載入及新增紀錄。另 9 項資料層檢查通過，包括並行寫入、負數拒絕、兔寶關聯、提醒狀態、醫院去重、無效備份拒絕、資料及照片還原、紀錄照片同步刪除。

尚未執行 iPhone Safari 與 Android 實機測試；正式網站仍需發布這些檔案後確認。
