const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const moduleCode = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import .*;\r?\n/gm, "");

function setup(hostname) {
  const elements = new Map();
  const document = {
    body: { classList: { add() {}, remove() {} } },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        disabled: false, title: "", textContent: "",
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
        addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; }
      });
      return elements.get(id);
    }
  };
  const context = {
    initializeApp() { return {}; }, getAuth() { return {}; }, getFirestore() { return {}; },
    GoogleAuthProvider: class { setCustomParameters() {} },
    onAuthStateChanged(auth, listener) { listener(null); },
    getRedirectResult() { return Promise.resolve(null); },
    document, window: { daymarkData: { clear() {} } },
    navigator: { userAgent: "test" },
    location: { hostname, origin: `https://${hostname}`, pathname: "/app_design_class_practice/1030/index.html", search: "" },
    URLSearchParams, console
  };
  vm.runInNewContext(moduleCode, context);
  return elements;
}

test("GitHub Pages disables LINE without disabling Google", async () => {
  const elements = setup("clare0808.github.io");
  assert.equal(elements.get("lineSignInBtn").disabled, true);
  assert.equal(elements.get("googleSignInBtn").disabled, false);
  assert.match(elements.get("authStatus").textContent, /GitHub Pages 不支援 LINE/);
  await elements.get("lineSignInBtn").listeners.click();
  assert.match(elements.get("authStatus").textContent, /請使用 Google/);
});

test("Node-hosted pages keep LINE login available", () => {
  const elements = setup("localhost");
  assert.equal(elements.get("lineSignInBtn").disabled, false);
  assert.equal(elements.get("authStatus").textContent, "請選擇登入方式。");
});