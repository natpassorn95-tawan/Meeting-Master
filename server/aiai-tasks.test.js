// Unit tests for the Aiai Board tasks postback + Flex builders.
// Node's built-in runner (no new deps): `node --test server/aiai-tasks.test.js`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTaskBubble,
  buildTasksMessage,
  decideTasksReply,
} from "./aiai-tasks.js";

// ── A LINE Flex validator (subset of the real constraints we care about) ─────
// Walks a message and asserts: carousel ≤ 12 bubbles, every bubble is a
// 'bubble', every `text` field is a non-empty string, every button has a label
// and (for uri actions) an http(s) uri.
function assertValidFlex(msg) {
  assert.equal(msg.type, "flex");
  assert.ok(typeof msg.altText === "string" && msg.altText.length > 0, "altText non-empty");
  const c = msg.contents;
  assert.ok(c.type === "carousel" || c.type === "bubble", "flex root is carousel|bubble");
  const bubbles = c.type === "carousel" ? c.contents : [c];
  assert.ok(bubbles.length >= 1 && bubbles.length <= 12, `≤12 bubbles (got ${bubbles.length})`);
  for (const b of bubbles) assert.equal(b.type, "bubble", "each carousel child is a bubble");
  walk(c);

  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.type === "text") {
      assert.ok(typeof node.text === "string" && node.text.trim().length > 0, "text field non-empty");
    }
    if (node.type === "button") {
      assert.ok(node.action, "button has action");
      assert.ok(typeof node.action.label === "string" && node.action.label.length > 0, "button label non-empty");
      assert.ok(node.action.label.length <= 40, "button label ≤ 40 chars");
      if (node.action.type === "uri") assert.match(node.action.uri, /^https?:\/\//, "uri is http(s)");
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  }
}

const task = (over = {}) => ({
  id: "wi1", title: "修正登入錯誤", status: "Active", type: "Bug",
  priority: 1, isBlocked: false, dueDate: null, overdue: false,
  boardId: "b1", boardName: "IT 看板", url: "https://boards.example/board?item=wi1",
  ...over,
});

test("buildTaskBubble: renders and falls back for empty title", () => {
  const b = buildTaskBubble(task({ title: "" }));
  assert.equal(b.type, "bubble");
  assertValidFlex({ type: "flex", altText: "x", contents: b });
});

test("buildTaskBubble: overdue paints the header red and shows 已逾期", () => {
  const b = buildTaskBubble(task({ dueDate: "2020-01-01T00:00:00Z", overdue: true }));
  assert.equal(b.header.backgroundColor, "#D64545");
  const txt = JSON.stringify(b);
  assert.match(txt, /已逾期/);
});

test("buildTaskBubble: omits the open button when url is missing/invalid", () => {
  const b = buildTaskBubble(task({ url: "" }));
  assert.equal(b.footer, undefined, "no footer/button without a valid uri");
});

test("buildTasksMessage: carousel is valid and altText counts tasks", () => {
  const msg = buildTasksMessage([task(), task({ id: "wi2", title: "撰寫文件" })]);
  assertValidFlex(msg);
  assert.match(msg.altText, /2 項/);
  assert.equal(msg.contents.contents.length, 2);
});

test("buildTasksMessage: truncates to 10 + a 'more' card when > 10 (≤12 bubbles)", () => {
  const many = Array.from({ length: 15 }, (_, i) => task({ id: `wi${i}`, title: `任務 ${i}` }));
  const msg = buildTasksMessage(many);
  assertValidFlex(msg);
  const bubbles = msg.contents.contents;
  assert.equal(bubbles.length, 11, "10 task cards + 1 more card");
  assert.match(JSON.stringify(bubbles[10]), /另有 5 項/);
});

// ── Orchestration branches (fetch stubbed via injected deps) ─────────────────
const cfg = { forceConfigured: true };

test("decideTasksReply: no userId → identity error text", async () => {
  const msgs = await decideTasksReply({ userId: "" }, cfg);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /無法識別/);
});

test("decideTasksReply: no email mapping → registration prompt (2 messages)", async () => {
  const msgs = await decideTasksReply(
    { userId: "U1", baseUrl: "https://mm.example" },
    { ...cfg, resolveEmailByLine: async () => null }
  );
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].text, /Email 註冊/);
  assert.equal(msgs[1].type, "flex"); // buildRegistrationMessage is a flex
});

test("decideTasksReply: resolve throws → busy message", async () => {
  const msgs = await decideTasksReply(
    { userId: "U1" },
    { ...cfg, resolveEmailByLine: async () => { throw new Error("timeout"); } }
  );
  assert.match(msgs[0].text, /系統忙碌|稍後再試/);
});

test("decideTasksReply: no Aiai Board account (matched=false)", async () => {
  const msgs = await decideTasksReply(
    { userId: "U1" },
    { ...cfg, resolveEmailByLine: async () => "a@b.com", fetchAiaiTasks: async () => ({ matched: false, tasks: [] }) }
  );
  assert.match(msgs[0].text, /找不到對應的 Aiai Board 帳號/);
});

test("decideTasksReply: empty tasks → celebratory message", async () => {
  const msgs = await decideTasksReply(
    { userId: "U1" },
    { ...cfg, resolveEmailByLine: async () => "a@b.com", fetchAiaiTasks: async () => ({ matched: true, tasks: [] }) }
  );
  assert.match(msgs[0].text, /沒有待辦任務/);
});

test("decideTasksReply: tasks present → valid Flex carousel", async () => {
  const msgs = await decideTasksReply(
    { userId: "U1" },
    { ...cfg, resolveEmailByLine: async () => "a@b.com",
      fetchAiaiTasks: async () => ({ matched: true, tasks: [task(), task({ id: "wi2", overdue: true, dueDate: "2020-01-01T00:00:00Z" })] }) }
  );
  assert.equal(msgs.length, 1);
  assertValidFlex(msgs[0]);
});

test("decideTasksReply: fetch throws → error message (never throws out)", async () => {
  const msgs = await decideTasksReply(
    { userId: "U1" },
    { ...cfg, resolveEmailByLine: async () => "a@b.com", fetchAiaiTasks: async () => { throw new Error("500"); } }
  );
  assert.match(msgs[0].text, /無法取得任務|稍後再試/);
});

test("postback data parses to the aiai_tasks action", () => {
  assert.equal(new URLSearchParams("action=aiai_tasks").get("action"), "aiai_tasks");
  assert.notEqual(new URLSearchParams("action=other").get("action"), "aiai_tasks");
});
