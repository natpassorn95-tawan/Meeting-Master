// ── "My Aiai Board Tasks" — LINE rich-menu postback (action=aiai_tasks) ──────
// Flow: LINE userId → email (central identity service) → open work items
// (Aiai Board tasks endpoint) → zh-TW Flex reply. All user-facing copy is
// Traditional Chinese, matching the rest of the Meeting Master OA.
//
// Config (all via env; nothing hard-coded):
//   IDENTITY_SERVICE_URL / IDENTITY_SERVICE_KEY  → resolve LINE userId → email
//   AIAI_BOARD_TASKS_URL / AIAI_BOARD_API_KEY    → fetch that email's tasks
// The feature is inert (soft message) until these are configured.

import { replyMessage, buildRegistrationMessage } from "./line.js";

const ACCENT = "#534AB7";
const OVERDUE_RED = "#D64545";
const MAX_BUBBLES = 10; // show at most 10 task cards (+1 "more" card if truncated)

const IDENTITY_URL = (process.env.IDENTITY_SERVICE_URL || "").replace(/\/+$/, "");
const IDENTITY_KEY = process.env.IDENTITY_SERVICE_KEY || "";
const TASKS_URL = (process.env.AIAI_BOARD_TASKS_URL || "").replace(/\/+$/, "");
const TASKS_KEY = process.env.AIAI_BOARD_API_KEY || "";

export function aiaiTasksConfigured() {
  return !!(IDENTITY_URL && IDENTITY_KEY && TASKS_URL && TASKS_KEY);
}

// Resolve a LINE userId to an email via the central identity service.
// Returns the email string, or null if there's no mapping (or on error).
export async function resolveEmailByLine(userId) {
  const res = await fetch(`${IDENTITY_URL}/v1/identities/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${IDENTITY_KEY}` },
    body: JSON.stringify({ provider: "line", external_id: userId }),
    signal: AbortSignal.timeout(4000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`identity resolve HTTP ${res.status}`);
  const body = await res.json();
  return body?.identity?.email || null;
}

// Fetch a person's open Aiai Board work items by email.
// Returns { matched: boolean, tasks: [...] }.
export async function fetchAiaiTasks(email) {
  const url = `${TASKS_URL}/api/v1/tasks?assignee_email=${encodeURIComponent(email)}&status=open`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${TASKS_KEY}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`aiai tasks HTTP ${res.status}`);
  const body = await res.json();
  return { matched: body?.matched !== false, tasks: Array.isArray(body?.tasks) ? body.tasks : [] };
}

// ── Flex builders ────────────────────────────────────────────────────────────

const STATUS_ZH = { New: "待處理", Active: "進行中", Resolved: "待結案", Closed: "已結案" };
const TYPE_ZH = { Epic: "史詩", Feature: "功能", UserStory: "使用者故事", Bug: "缺陷", Task: "任務" };

// Format an ISO date as YYYY/MM/DD (local-ish; date only).
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function row(label, value, valueColor) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#999999", size: "sm", flex: 2 },
      { type: "text", text: value || "—", color: valueColor || "#111111", size: "sm", flex: 5, wrap: true },
    ],
  };
}

// One task → one Flex bubble.
export function buildTaskBubble(task) {
  const title = (task.title && String(task.title).trim()) || "（未命名工作項目）";
  const status = STATUS_ZH[task.status] || task.status || "—";
  const typeLabel = TYPE_ZH[task.type] || task.type || "";
  const due = fmtDate(task.dueDate);
  const bodyRows = [
    row("看板", task.boardName || "—"),
    row("狀態", typeLabel ? `${status}・${typeLabel}` : status),
  ];
  if (due) {
    bodyRows.push(row("到期", task.overdue ? `${due}（已逾期）` : due, task.overdue ? OVERDUE_RED : "#111111"));
  }
  if (task.isBlocked) bodyRows.push(row("狀況", "🚧 已封鎖", OVERDUE_RED));

  const bubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: task.overdue ? OVERDUE_RED : ACCENT,
      paddingAll: "12px",
      contents: [
        { type: "text", text: "🗂 我的任務", color: "#FFFFFF", size: "xs" },
        { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "md", wrap: true, margin: "sm", maxLines: 3 },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: bodyRows },
  };
  // Only attach the open button when we have a real URL (LINE requires a valid uri).
  if (task.url && /^https?:\/\//.test(task.url)) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        { type: "button", style: "primary", color: ACCENT, height: "sm",
          action: { type: "uri", label: "開啟工作項目", uri: task.url } },
      ],
    };
  }
  return bubble;
}

// A trailing "還有 N 項" card shown when the list was truncated.
function buildMoreBubble(remaining, boardUrl) {
  const contents = [
    { type: "text", text: "還有更多任務", weight: "bold", size: "md", wrap: true },
    { type: "text", text: `另有 ${remaining} 項未顯示`, size: "sm", color: "#999999", margin: "sm", wrap: true },
  ];
  const bubble = {
    type: "bubble",
    size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", justifyContent: "center", contents },
  };
  if (boardUrl && /^https?:\/\//.test(boardUrl)) {
    bubble.footer = {
      type: "box", layout: "vertical", paddingAll: "12px",
      contents: [{ type: "button", style: "secondary", height: "sm",
        action: { type: "uri", label: "開啟看板", uri: boardUrl } }],
    };
  }
  return bubble;
}

// Build the full Flex carousel message for a task list (assumed non-empty).
// Shows at most MAX_BUBBLES task cards + an optional "more" card (≤12 total,
// LINE's carousel limit). Returns a LINE flex message object.
export function buildTasksMessage(tasks) {
  const shown = tasks.slice(0, MAX_BUBBLES);
  const bubbles = shown.map(buildTaskBubble);
  const remaining = tasks.length - shown.length;
  if (remaining > 0) {
    // Derive a board URL from the first task's link (strip the ?item=… part).
    const first = shown.find((t) => t.url) || {};
    let boardUrl = "";
    try { const u = new URL(first.url); u.search = ""; boardUrl = u.toString(); } catch {}
    bubbles.push(buildMoreBubble(remaining, boardUrl));
  }
  const altText = `您有 ${tasks.length} 項待辦任務`;
  return { type: "flex", altText, contents: { type: "carousel", contents: bubbles } };
}

function textMsg(text) {
  return { type: "text", text };
}

// ── Orchestration ────────────────────────────────────────────────────────────
// Decide the reply message(s) for a "my tasks" tap — PURE of LINE sending, so
// it's unit-testable by stubbing global fetch. Never throws; every branch
// returns an array of LINE message objects. `deps` is injectable for tests.
export async function decideTasksReply({ userId, baseUrl = "" }, deps = {}) {
  const resolve = deps.resolveEmailByLine || resolveEmailByLine;
  const fetchTasks = deps.fetchAiaiTasks || fetchAiaiTasks;

  if (!aiaiTasksConfigured() && !deps.forceConfigured) {
    console.warn("[aiai-tasks] not configured (IDENTITY_SERVICE_* / AIAI_BOARD_* env)");
    return [textMsg("🗂 任務查詢功能尚未啟用，請稍後再試。")];
  }
  if (!userId) return [textMsg("無法識別您的身分，請重新操作。")];

  // 1. Resolve LINE userId → email.
  let email;
  try {
    email = await resolve(userId);
  } catch (e) {
    console.error("[aiai-tasks] resolve failed", e.message);
    return [textMsg("😥 系統忙碌中，請稍後再試一次。")];
  }
  if (!email) {
    // No identity mapping yet → point them at the existing registration flow.
    return [
      textMsg("請先完成 Email 註冊，才能查看您的任務。\n完成後再點一次「任務」即可。"),
      buildRegistrationMessage(userId, baseUrl),
    ];
  }

  // 2. Fetch this email's open tasks.
  let matched, tasks;
  try {
    ({ matched, tasks } = await fetchTasks(email));
  } catch (e) {
    console.error("[aiai-tasks] fetch failed", e.message);
    return [textMsg("😥 目前無法取得任務清單，請稍後再試。")];
  }

  // 3. Reply.
  if (!matched) return [textMsg("找不到對應的 Aiai Board 帳號。\n如需開通，請聯繫管理員。")];
  if (!tasks.length) return [textMsg("🎉 您目前沒有待辦任務，太棒了！")];
  return [buildTasksMessage(tasks)];
}

// Handle a tapped rich-menu "my tasks" postback. Always replies exactly once
// (LINE reply tokens are single-use and short-lived). Never throws.
export async function handleAiaiTasksPostback({ userId, replyToken, baseUrl = "" }) {
  if (!replyToken) return;
  const messages = await decideTasksReply({ userId, baseUrl });
  await replyMessage(replyToken, messages).catch((e) => console.error("[aiai-tasks] reply failed", e.message));
}
