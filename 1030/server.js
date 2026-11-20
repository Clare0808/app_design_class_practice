const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createPrivateKey } = require("node:crypto");
const admin = require("firebase-admin");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
  }
}

const { LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_REDIRECT_URI, APP_ORIGIN, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
const origin = APP_ORIGIN && new URL(APP_ORIGIN).origin;
const redirectUri = LINE_REDIRECT_URI && new URL(LINE_REDIRECT_URI).href;
if (!LINE_CHANNEL_ID || !LINE_CHANNEL_SECRET || !redirectUri || !origin || !FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY || new URL(redirectUri).origin !== origin || /YOUR_/.test(LINE_CHANNEL_ID + LINE_CHANNEL_SECRET)) {
  throw new Error("請在 1030/.env 設定 LINE、APP_ORIGIN 與 Firebase Admin 憑證，且授權返回網址須與應用程式同網域。");
}
if (!FIREBASE_CLIENT_EMAIL.endsWith(`@${FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`)) {
  throw new Error("FIREBASE_CLIENT_EMAIL 不是此 Firebase 專案的服務帳戶 email；請使用同一份 Firebase 服務帳戶 JSON 的 client_email 與 project_id。");
}
try {
  createPrivateKey(FIREBASE_PRIVATE_KEY);
} catch {
  throw new Error("FIREBASE_PRIVATE_KEY 格式無效；請使用同一份 Firebase 服務帳戶 JSON 的 private_key，並以 \\n 保留換行。");
}

admin.initializeApp({ credential: admin.credential.cert({
  projectId: FIREBASE_PROJECT_ID, clientEmail: FIREBASE_CLIENT_EMAIL, privateKey: FIREBASE_PRIVATE_KEY
}) });

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}

async function lineLogin(req, res) {
  if (req.headers.origin !== origin || req.headers["content-type"]?.split(";")[0] !== "application/json") {
    return json(res, 403, { error: "無效的登入請求。" });
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) return json(res, 413, { error: "登入請求過大。" });
    }
    const { code, nonce, redirectUri: returnedUri } = JSON.parse(body);
    if (typeof code !== "string" || !code || typeof nonce !== "string" || !nonce || returnedUri !== redirectUri) {
      return json(res, 400, { error: "LINE 登入參數無效。" });
    }
    let tokenResponse;
    try {
      tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: LINE_CHANNEL_ID, client_secret: LINE_CHANNEL_SECRET }),
      signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      console.error("LINE token request failed:", error.code || error.cause?.code || error.name);
      return json(res, 503, { error: "連線 LINE 授權服務失敗。請檢查伺服器網路連線後重新登入。" });
    }
    if (!tokenResponse.ok) return json(res, 401, { error: "LINE 授權碼兌換失敗。請確認 Channel Secret 與 LINE Developers Callback URL 正確，並重新登入。" });
    const tokens = await tokenResponse.json();
    if (!tokens.id_token) return json(res, 401, { error: "LINE 未回傳身分資訊。" });
    let verifyResponse;
    try {
      verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: tokens.id_token, client_id: LINE_CHANNEL_ID, nonce }),
      signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      console.error("LINE identity request failed:", error.code || error.cause?.code || error.name);
      return json(res, 503, { error: "連線 LINE 身分驗證服務失敗。請檢查伺服器網路連線後重新登入。" });
    }
    if (!verifyResponse.ok) return json(res, 401, { error: "LINE 身分驗證失敗，請重新登入。" });
    const identity = await verifyResponse.json();
    if (identity.iss !== "https://access.line.me" || identity.aud !== LINE_CHANNEL_ID || identity.nonce !== nonce || typeof identity.sub !== "string" || !identity.sub) {
      return json(res, 401, { error: "LINE 身分驗證失敗，請重新登入。" });
    }
    const uid = `line:${identity.sub}`;
    try {
      const user = await admin.auth().getUser(uid).catch(error => {
        if (error.code !== "auth/user-not-found") throw error;
        return admin.auth().createUser({ uid, displayName: identity.name || undefined, photoURL: identity.picture || undefined });
      });
      const customToken = await admin.auth().createCustomToken(user.uid);
      return json(res, 200, { customToken });
    } catch (error) {
      console.error("Firebase Admin login failed:", error.code || error.name);
      return json(res, 503, { error: "LINE 已授權，但 Firebase 服務帳戶驗證失敗。請確認 .env 的 project_id、client_email 與 private_key 都來自同一份服務帳戶 JSON。" });
    }
  } catch (error) {
    console.error("LINE login failed:", error);
    return json(res, 500, { error: "LINE 登入服務暫時無法使用，請稍後重試。" });
  }
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, origin).pathname;
  if (pathname === "/api/auth/line/config" && req.method === "GET") return json(res, 200, { channelId: LINE_CHANNEL_ID, redirectUri });
  if (pathname === "/api/auth/line" && req.method === "POST") return void lineLogin(req, res);
  if (pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  }
  json(res, 404, { error: "找不到頁面。" });
});

if (require.main === module) {
  const port = Number(new URL(origin).port || (origin.startsWith("https:") ? 443 : 80));
  server.listen(port, () => console.log(`Daymark is listening on ${origin}`));
}
module.exports = server;