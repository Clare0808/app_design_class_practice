const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");

process.env.LINE_CHANNEL_ID = "2012416679";
process.env.LINE_CHANNEL_SECRET = "test-secret";
process.env.LINE_REDIRECT_URI = "http://127.0.0.1:5500/";
process.env.APP_ORIGIN = "http://127.0.0.1:5500";
process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });

const server = require("./server");

test("LINE endpoints reject invalid login without leaking secrets", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const configResponse = await fetch(`${base}/api/auth/line/config`);
    assert.equal(configResponse.status, 200);
    assert.deepEqual(await configResponse.json(), { channelId: "2012416679", redirectUri: "http://127.0.0.1:5500/" });
    const wrongOrigin = await fetch(`${base}/api/auth/line`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ code: "test", nonce: "test", redirectUri: "http://127.0.0.1:5500/" })
    });
    assert.equal(wrongOrigin.status, 403);
    const invalidUri = await fetch(`${base}/api/auth/line`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5500" },
      body: JSON.stringify({ code: "test", nonce: "test", redirectUri: "https://example.com/" })
    });
    assert.equal(invalidUri.status, 400);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /signInWithCustomToken/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("LINE connection errors identify the failed step without exposing the authorization code", async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).startsWith("https://api.line.me/")) throw Object.assign(new Error("connection failed"), { code: "ECONNRESET" });
    return originalFetch(url);
  };
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/auth/line`, {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5500", "Content-Type": "application/json" },
      body: JSON.stringify({ code: "secret-test-code", nonce: "nonce", redirectUri: "http://127.0.0.1:5500/" })
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /連線 LINE 授權服務失敗/);
    assert.doesNotMatch(body, /secret-test-code/);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
  }
});