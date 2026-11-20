const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function setup() {
  const elements = new Map();
  const makeElement = id => ({
    id, textContent: "", disabled: false, value: "", dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener(type, fn) { this.listeners ??= {}; this.listeners[type] = fn; },
    querySelector(selector) { return selector === "[type=submit]" ? document.getElementById(id === "taskForm" ? "saveTaskBtn" : "saveProjectBtn") : document.getElementById(id === "taskForm" ? "taskSaveStatus" : "projectSaveStatus"); },
    querySelectorAll() { return [this.querySelector("[type=submit]"), document.getElementById(id === "taskForm" ? "cancelBtn" : "cancelProjectBtn")]; },
    appendChild(child) { this.children.push(child); },
    set innerHTML(value) { this.children = []; this.html = value; },
    get innerHTML() { return this.html || ""; }
  });
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); },
    createElement() { return makeElement(""); }, addEventListener() {}
  };
  const context = {
    document, window: { addEventListener() {} }, localStorage: { getItem() { return null; }, removeItem() {} },
    crypto: { randomUUID() { return "new-task"; } }, Intl, Date, Math, String, Number, JSON,
    setTimeout() {}, clearTimeout() {}, console: { ...console, error() {} },
    confirm() { return true; }
  };
  vm.runInNewContext(script, context);
  return { elements, document, dataView: context.window.daymarkData };
}

test("slow task save shows progress, blocks duplicate submit and recovers from failure", async () => {
  const { elements, document, dataView } = setup();
  let rejectSave;
  let calls = 0;
  dataView.setStore({ save() { calls++; return new Promise((resolve, reject) => { rejectSave = reject; }); } });
  document.getElementById("taskName").value = "測試行程";
  document.getElementById("taskDate").value = "2026-11-20";
  document.getElementById("taskTime").value = "17:00";
  const form = elements.get("taskForm");
  document.getElementById("saveTaskBtn").textContent = "儲存待辦";
  const submit = () => form.listeners.submit({ preventDefault() {} });
  const first = submit();
  assert.equal(elements.get("saveTaskBtn").disabled, true);
  assert.equal(elements.get("saveTaskBtn").textContent, "儲存中…");
  assert.match(elements.get("taskSaveStatus").textContent, /正在儲存/);
  await submit();
  assert.equal(calls, 1);
  rejectSave(new Error("offline"));
  await first;
  assert.equal(elements.get("saveTaskBtn").disabled, false);
  assert.equal(elements.get("cancelBtn").disabled, false);
  assert.equal(elements.get("saveTaskBtn").textContent, "儲存待辦");
  assert.equal(elements.get("taskSaveStatus").textContent, "");
  const retry = submit();
  assert.equal(calls, 2);
  rejectSave(new Error("offline"));
  await retry;
});

test("slow project save blocks duplicate submit and restores controls after failure", async () => {
  const { document, dataView } = setup();
  let rejectSave;
  let calls = 0;
  dataView.setStore({ save() { calls++; return new Promise((resolve, reject) => { rejectSave = reject; }); } });
  document.getElementById("projectName").value = "測試專案";
  document.getElementById("projectStart").value = "2026-11-20";
  document.getElementById("projectEnd").value = "2026-12-20";
  document.getElementById("projectProgress").value = "0";
  document.getElementById("saveProjectBtn").textContent = "新增專案";
  const submit = () => document.getElementById("projectForm").listeners.submit({ preventDefault() {} });
  const first = submit();
  assert.equal(document.getElementById("saveProjectBtn").disabled, true);
  assert.equal(document.getElementById("saveProjectBtn").textContent, "儲存中…");
  assert.match(document.getElementById("projectSaveStatus").textContent, /正在儲存/);
  await submit();
  assert.equal(calls, 1);
  rejectSave(new Error("offline"));
  await first;
  assert.equal(document.getElementById("saveProjectBtn").disabled, false);
  assert.equal(document.getElementById("saveProjectBtn").textContent, "新增專案");
  const retry = submit();
  assert.equal(calls, 2);
  rejectSave(new Error("offline"));
  await retry;
});