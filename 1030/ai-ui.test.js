const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const moduleCode = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import .*;\r?\n/gm, "");

function setup() {
  const elements = new Map();
  const makeElement = () => ({
    textContent: "", disabled: false, hidden: true,
    classList: { add() {}, remove() {}, toggle() {}, contains(name) { return name === "authenticated"; } },
    setAttribute() {}, focus() {}, addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; }
  });
  const document = {
    body: { classList: { add() {}, remove() {}, toggle() {}, contains(name) { return name === "authenticated"; } } },
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }
  };
  const auth = { currentUser: { uid: "user-1" } };
  let tasks = [];
  let calls = 0;
  let complete;
  const context = {
    initializeApp() { return {}; }, getAuth() { return auth; }, getFirestore() { return {}; },
    getAI() { return {}; }, GoogleAIBackend: class {},
    getGenerativeModel() { return { generateContent() { calls++; return new Promise(resolve => { complete = resolve; }); } }; },
    GoogleAuthProvider: class { setCustomParameters() {} },
    onAuthStateChanged() {}, getRedirectResult() { return Promise.resolve(null); },
    document, window: { daymarkData: { current() { return { tasks }; }, clear() {} } },
    navigator: { userAgent: "test" }, location: { origin: "http://localhost:5500", pathname: "/", search: "" },
    URLSearchParams, sessionStorage: { getItem() { return null; } },
    console: { ...console, error() {} }
  };
  vm.runInNewContext(moduleCode, context);
  return {
    elements, auth, setTasks(value) { tasks = value; }, getCalls() { return calls; },
    complete(text) { complete({ response: { text() { return text; } } }); }
  };
}

test("AI advice only sends eligible tasks once and shows result without saving", async () => {
  const app = setup();
  const button = app.elements.get("aiSuggestBtn"), result = app.elements.get("aiResult");
  const click = () => button.listeners.click();
  app.elements.get("aiFab").listeners.click();
  assert.equal(app.elements.get("aiPanel").hidden, false);
  assert.equal(app.getCalls(), 0);
  await click();
  assert.equal(app.getCalls(), 0);
  assert.match(result.textContent, /沒有未完成/);
  app.setTasks([{ name: "報告", date: "2026-11-21", time: "17:00", done: false }, { name: "完成", date: "2026-11-21", time: "17:00", done: true }]);
  const first = click();
  assert.equal(button.disabled, true);
  assert.equal(app.getCalls(), 1);
  await click();
  assert.equal(app.getCalls(), 1);
  app.complete("先完成報告");
  await first;
  assert.equal(result.textContent, "先完成報告");
  assert.equal(button.disabled, false);
});

test("AI does not run for signed-out users", async () => {
  const app = setup();
  app.setTasks([{ name: "報告", date: "2026-11-21", time: "17:00", done: false }]);
  app.elements.get("aiFab").listeners.click();
  app.auth.currentUser = null;
  await app.elements.get("aiSuggestBtn").listeners.click();
  assert.equal(app.getCalls(), 0);
});

test("closing the AI panel never sends a request", () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  app.elements.get("aiCloseBtn").listeners.click();
  assert.equal(app.elements.get("aiPanel").hidden, true);
  assert.equal(app.getCalls(), 0);
});