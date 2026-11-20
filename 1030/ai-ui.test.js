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
    textContent: "", value: "", disabled: false, hidden: true, children: [], scrollTop: 0, scrollHeight: 100,
    classList: { add(name) { this.names ??= new Set(); this.names.add(name); }, toggle() {} },
    setAttribute() {}, focus() {},
    addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; }
  });
  const document = {
    body: { classList: { contains(name) { return name === "authenticated"; }, remove() {}, add() {} } },
    createElement() { return makeElement(); },
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }
  };
  const auth = { currentUser: { uid: "user-1" } };
  let calls = 0;
  const pending = [];
  const prompts = [];
  let onAuthChange;
  const context = {
    initializeApp() { return {}; }, getAuth() { return auth; }, getFirestore() { return {}; },
    getAI() { return {}; }, GoogleAIBackend: class {},
    getGenerativeModel() { return { generateContent(prompt) { calls++; prompts.push(prompt); return new Promise((resolve, reject) => { pending.push({ resolve, reject }); }); } }; },
    GoogleAuthProvider: class { setCustomParameters() {} },
    onAuthStateChanged(value, listener) { onAuthChange = listener; }, getRedirectResult() { return Promise.resolve(null); },
    document, window: { daymarkData: { clear() {}, current() { return { tasks: [{ name: "不應傳送的待辦" }] }; } } },
    navigator: { userAgent: "test" }, location: { origin: "http://localhost:5500", pathname: "/", search: "" },
    URLSearchParams, sessionStorage: { getItem() { return null; } },
    console: { ...console, error() {} }
  };
  vm.runInNewContext(moduleCode, context);
  const form = elements.get("aiQuestionForm");
  form.requestSubmit = () => form.listeners.submit({ preventDefault() {} });
  return {
    elements, auth, getCalls() { return calls; }, getPrompts() { return prompts; },
    onAuthChange(user) { return onAuthChange(user); },
    submit(text) { elements.get("aiQuestion").value = text; return form.requestSubmit(); },
    complete(text) { pending.shift().resolve({ response: { text() { return text; } } }); },
    fail(error) { pending.shift().reject(error); },
    messages() { return elements.get("aiMessages").children.filter(child => child.className?.startsWith("ai-message")); }
  };
}

test("chat displays user and assistant messages without automatically sending tasks", async () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  assert.equal(app.elements.get("aiPanel").hidden, false);
  assert.equal(app.getCalls(), 0);
  const first = app.submit("  如何安排讀書時間？  ");
  assert.equal(app.getCalls(), 1);
  assert.match(app.getPrompts()[0], /如何安排讀書時間/);
  assert.doesNotMatch(app.getPrompts()[0], /不應傳送的待辦/);
  assert.equal(app.elements.get("aiQuestion").value, "");
  assert.equal(app.elements.get("aiAskBtn").disabled, true);
  assert.equal(app.messages()[0].children[1].textContent, "如何安排讀書時間？");
  assert.equal(app.messages()[1].children[1].textContent, "正在回覆…");
  app.submit("重複送出");
  assert.equal(app.getCalls(), 1);
  app.complete("每讀 25 分鐘休息一下");
  await first;
  assert.equal(app.messages()[1].children[1].textContent, "每讀 25 分鐘休息一下");
  assert.equal(app.elements.get("aiAskBtn").disabled, false);
});

test("follow-up messages include only recent successful chat, not task data", async () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  for (let i = 1; i <= 4; i++) {
    const request = app.submit(`第${i}題`);
    app.complete(`第${i}答`);
    await request;
  }
  const fifth = app.submit("第五題");
  const prompt = app.getPrompts()[4];
  assert.doesNotMatch(prompt, /第1題|第1答|不應傳送的待辦/);
  assert.match(prompt, /第2題|第4答|第五題/);
  app.complete("第五答");
  await fifth;
  assert.equal(app.messages().length, 10);
});

test("Enter submits; Shift+Enter and IME composition do not", async () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  const input = app.elements.get("aiQuestion");
  input.value = "你好";
  let prevented = false;
  input.listeners.keydown({ key: "Enter", shiftKey: true, preventDefault() { prevented = true; } });
  input.listeners.keydown({ key: "Enter", isComposing: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(app.getCalls(), 0);
  input.listeners.keydown({ key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.getCalls(), 1);
  app.complete("你好！");
  await Promise.resolve();
});

test("invalid, hidden, or signed-out submissions never request AI", () => {
  const app = setup();
  app.submit("還沒開啟");
  app.elements.get("aiFab").listeners.click();
  app.submit("   ");
  app.submit("問".repeat(501));
  app.auth.currentUser = null;
  app.submit("這週如何安排？");
  assert.equal(app.getCalls(), 0);
});

test("failed replies show an error but do not enter the next prompt's history", async () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  const first = app.submit("失敗的問題");
  app.fail(new Error("offline"));
  await first;
  assert.match(app.messages()[1].children[1].textContent, /無法產生回答/);
  const second = app.submit("新的問題");
  assert.doesNotMatch(app.getPrompts()[1], /失敗的問題/);
  app.complete("可以繼續聊");
  await second;
  assert.equal(app.messages().length, 4);
});

test("switching accounts clears chat and ignores an in-flight response", async () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  const first = app.submit("私人的問題");
  app.auth.currentUser = null;
  app.onAuthChange(null);
  assert.equal(app.elements.get("aiQuestion").value, "");
  assert.equal(app.messages().length, 0);
  assert.equal(app.elements.get("aiPanel").hidden, true);
  app.complete("舊帳號回答");
  await first;
  assert.equal(app.messages().length, 0);
});

test("closing the panel keeps the conversation without sending a request", () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  app.elements.get("aiCloseBtn").listeners.click();
  assert.equal(app.elements.get("aiPanel").hidden, true);
  assert.equal(app.getCalls(), 0);
});

test("closing and reopening keeps the chat; user text is rendered as text", async () => {
  const app = setup();
  app.elements.get("aiFab").listeners.click();
  const request = app.submit("<script>alert(1)</script>");
  app.complete("<b>回答</b>");
  await request;
  app.elements.get("aiCloseBtn").listeners.click();
  app.elements.get("aiFab").listeners.click();
  assert.equal(app.messages()[0].children[1].textContent, "<script>alert(1)</script>");
  assert.equal(app.messages()[1].children[1].textContent, "<b>回答</b>");
  assert.equal(app.getCalls(), 1);
});

test("chat HTML has no task suggestion button and has accessible conversation controls", () => {
  assert.doesNotMatch(html, /aiSuggestBtn|產生待辦建議/);
  assert.match(html, /id="aiMessages" role="log"/);
  assert.match(html, /id="aiQuestion" maxlength="500"/);
});