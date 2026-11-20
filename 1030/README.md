# 日序 Daymark 登入

Google 登入直接使用 Firebase Web SDK。LINE 登入必須透過 `server.js` 將 LINE 授權碼換成經驗證的 LINE 身分，並由 Firebase Admin SDK 核發 Custom Token；只有 Firebase 驗證成功後才會顯示主功能。

## AI 行程建議（Firebase AI Logic）

登入後，使用者可按「產生建議」；只有點擊後才會將**最多 20 筆未完成待辦的名稱、截止日期和時間**送至 Firebase AI Logic 的 Gemini Developer API（模型 `gemini-3.5-flash-lite`）。回覆僅顯示在頁面上，不會寫入 Firestore、修改行程或傳送帳號 email。每次點擊會產生一次模型請求，可能收費；請勿在待辦名稱輸入不希望送給 Gemini 的敏感資訊。

正式使用前，請到 Firebase Console → **AI Logic**，為 `event-magagement` 專案啟用 **Gemini Developer API**，依介面完成所需 API 和 **Blaze／帳單連結**設定；在 Google Cloud 設定預算提醒及 Gemini API 支出上限。強烈建議先為 Web App 設定並啟用 **Firebase App Check**（例如 reCAPTCHA Enterprise），在測試驗證成功後於 Firebase AI Logic 啟用強制執行以防止未授權請求造成費用。現有專案尚未包含 App Check 網站金鑰，**尚未自動啟用強制執行**；上線前請完成此步驟。Web Firebase 設定中的 `apiKey` 不是服務帳戶私鑰，也不需把 Gemini API key 放入網頁或 `.env`。若模型無法使用，請至 Firebase AI Logic 的支援模型文件檢查當下可用的模型名稱與地區。此功能不是 Firebase Console 的「Gemini in Firebase」開發輔助聊天功能。參考：https://firebase.google.com/docs/ai-logic/get-started?platform=web 、https://firebase.google.com/docs/ai-logic/pricing 。

行程資料使用 Cloud Firestore：`users/{uid}` 儲存登入使用者的公開顯示資料與最近登入時間；`users/{uid}/data/tasks` 和 `users/{uid}/data/projects` 儲存該帳號的待辦、長期專案。密碼、LINE 授權碼及服務帳戶私鑰**不會**寫進 Firestore；登入狀態由 Firebase Authentication 管理。不同 Google／LINE 帳號使用不同的 UID，資料不共用。

首次使用請在 Firebase Console → Build → **Firestore Database** 建立 `(default)` 資料庫（選正式模式及合適地區）。**Cloud Firestore 不是 Firebase Storage**，這個專案不需要啟用 Storage。建立後到 Firestore「規則」貼上同目錄 `firestore.rules` 的內容並**發布**；或者安裝 Firebase CLI、登入後在本目錄執行 `firebase deploy --only firestore:rules --project event-magagement`（`.firebaserc`、`firebase.json` 已提供）。規則僅允許登入者讀寫自己的 `users/{uid}` 文件。若尚未建立資料庫或未發布規則，登入後會顯示載入失敗，不會退回未隔離的本機資料。舊版瀏覽器資料只會在使用者明確確認屬於目前帳號後匯入；取消不會刪除，示範待辦不會匯入。每種清單最多 500 筆、單個文件仍受 Firestore 1 MiB 大小限制；多裝置操作採交易合併修改，但須重新整理才能看到其他裝置的最新資料。

1. 在 `1030` 目錄執行 `npm install`。
2. 複製 `.env.example` 為 `.env`，填入 LINE Login Channel ID、Channel Secret 和 **與網頁 Firebase 專案相同**的 Firebase 服務帳戶憑證（私鑰中的換行可使用 `\\n`）。不要提交 `.env`。
3. 將 `LINE_REDIRECT_URI` 設為應用程式頁面網址，例如 `http://localhost:5500/`；在 LINE Developers 的 LINE Login channel 登記**完全相同**的 Callback URL。`APP_ORIGIN` 設為 `http://localhost:5500`，`index.html` 內的 `lineConfig.channelId` 要與環境變數一致。LINE Login channel 需允許 Web app 使用 LINE Login。如本機原有 `.env` 指向其他路徑（例如 `/1030/index.html`），請同步修改兩個網址與回呼網址再啟動。
4. 執行 `npm start`，開啟 `APP_ORIGIN`（預設示例為 `http://localhost:5500/`）。請勿以 `file://` 或 Live Server 開啟，否則 `/api/auth/line` 不存在。

**若 LINE 授權後返回頁面出錯：**請先重啟 `npm start` 以讀取更新後的 `.env`。在 Firebase Console → 專案設定 → 服務帳戶 →「產生新的私密金鑰」下載 JSON，確認 `.env` 的 `FIREBASE_PROJECT_ID`、`FIREBASE_CLIENT_EMAIL`、`FIREBASE_PRIVATE_KEY` **三項都複製自同一份 JSON**（分別對應 `project_id`、`client_email`、`private_key`）。`FIREBASE_CLIENT_EMAIL` 應以 `.iam.gserviceaccount.com` 結尾；私鑰應以 `-----BEGIN PRIVATE KEY-----` 開頭、以 `-----END PRIVATE KEY-----` 結尾，並將 JSON 內的 `\n` 原樣留在 `.env` 單一行。不要公開 JSON、私鑰、LINE Channel Secret，亦不要分享回呼網址中的 `code` 或 `state`。若服務啟動正常但授權碼兌換失敗，請檢查 LINE Developers 的 Channel Secret 與 Callback URL 是否和 `.env` 完全相符。

GitHub Pages 僅支援靜態網站，**無法執行 `server.js`**；在 `https://clare0808.github.io/app_design_class_practice/1030/index.html` 上只能使用 Google 登入，LINE 按鈕會停用。Google 登入前請在 Firebase Console → Authentication → Sign-in method 啟用 **Google**，並在 Authentication → Settings → Authorized domains 加入 `clare0808.github.io`（只填網域，不含 `https://` 或路徑）；也請依上方步驟建立 Firestore 並發布規則。這些 Firebase Console 設定無法由網頁自動完成。若 Google 登入時顯示網域未授權、登入後顯示 Firestore 權限不足，請依訊息確認對應設定。

若要在線上使用 LINE 登入，需將此 Node 服務部署到可執行 Node.js 的主機，以 HTTPS 設定 `APP_ORIGIN` 與 `LINE_REDIRECT_URI`，並更新 LINE Developers Callback URL。**僅部署後端到其他網域無法讓目前 GitHub Pages 頁面直接使用 LINE**：目前頁面呼叫同網域的 `/api/auth/line`，伺服器也要求請求 Origin 與回呼網址同網域；請改用該 Node 主機提供的頁面，或另行實作安全的跨網域部署方案。部署前亦須在 Firebase Authentication 的授權網域設定允許該站網域。Firestore 不需 LINE 後端即可由已登入的 Google 使用者使用，但 LINE 登入必須由後端安全驗證。