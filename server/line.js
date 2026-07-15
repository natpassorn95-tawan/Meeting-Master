// ── LINE Messaging API integration ────────────────────────────────────
// "Meeting Notice" (會議通知) — the Before-the-meeting step of Meeting Master.
// The system pushes a meeting reminder to the LINE Official Account, including
// the meeting name, time, location, and an agenda link.
//
// The channel access token lives in .env (LINE_CHANNEL_ACCESS_TOKEN) and is
// loaded by server/index.js. The UI defaults to "preview" so the OA's limited
// monthly message quota isn't burned by accident.

import { createHmac } from "node:crypto";

const LINE_API = "https://api.line.me";

// Validate the X-Line-Signature header on inbound webhook calls.
// Requires LINE_CHANNEL_SECRET; if unset we can't verify (returns null = skip).
export function verifySignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return null; // not configured — caller decides
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return digest === signature;
}

function token() {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set (see .env)");
  return t;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
  };
}

// Brand accent used across the app (purple).
const ACCENT = "#534AB7";
// Green used for the "join online meeting" call-to-action.
const ONLINE_GREEN = "#0F6E56";

// ── Online-meeting helpers ─────────────────────────────────────────────
// Meetings may be in-person, online, or hybrid. `onlineUrl` is an optional
// video-call link; when present we surface a prominent "Join online" button so
// recipients can tap straight into the call from the LINE notice.
function sanitizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
// A green "Join online" Flex button for the meeting's link, or null if none.
function joinOnlineButton(onlineUrl) {
  const uri = sanitizeUrl(onlineUrl);
  if (!uri) return null;
  return {
    type: "button", style: "primary", color: ONLINE_GREEN, height: "sm",
    action: { type: "uri", label: "🔗 加入線上會議 Join online", uri },
  };
}

// Build a deep link the LINE buttons point at.
// • If LIFF_ID is set → a liff.line.me URL, so the page opens *inside LINE*
//   (layered over the chat) and LIFF can identify the user automatically.
// • Else if a public https base is set → that URL (opens in LINE's in-app browser).
// • Else (plain-http localhost preview) → a safe fallback to the OA.
export function deepLink(baseUrl, params) {
  const qs = new URLSearchParams(params).toString();
  const liffId = process.env.LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}?${qs}`;
  const base = (baseUrl || "").replace(/\/$/, "");
  return /^https:\/\//.test(base) ? `${base}/?${qs}` : "https://line.me/R/ti/p/@399jcmvj";
}

function intentUri(base, meetingId, intent) {
  return deepLink(base, { view: "invite", m: meetingId, intent });
}

// Build the Flex "bubble" for a meeting notice. `meeting` is the stored meeting
// (or the compose form) — { id, title, datetime, location, host, agendaUrl }.
// `baseUrl` is the public origin participant links point at.
export function buildNoticeFlex(meeting, baseUrl = "") {
  const title = meeting.title || "（未命名會議）";
  const datetime = meeting.datetime || "—";
  const onlineUrl = sanitizeUrl(meeting.onlineUrl);
  // Online-only meetings often have no physical venue — show "Online" instead of "—".
  const location = meeting.location || (onlineUrl ? "🔗 線上會議 Online" : "—");
  const host = meeting.host || "—";
  const base = (baseUrl || "").replace(/\/$/, "");
  const mid = meeting.id || "preview";

  const row = (label, value) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#999999", size: "sm", flex: 2 },
      { type: "text", text: value, color: "#111111", size: "sm", flex: 5, wrap: true },
    ],
  });

  const joinBtn = joinOnlineButton(onlineUrl);
  const footerButtons = [
    // Online / hybrid meetings: a tap-to-join button sits at the top of the notice.
    ...(joinBtn ? [joinBtn] : []),
    {
      type: "button",
      style: "primary",
      color: ACCENT,
      height: "sm",
      action: { type: "uri", label: "📄 查看議程", uri: intentUri(base, mid, "agenda") },
    },
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "uri", label: "✅ 確認出席", uri: intentUri(base, mid, "confirm") },
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "uri", label: "📝 請假申請", uri: intentUri(base, mid, "leave") },
        },
      ],
    },
  ];

  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: ACCENT,
      paddingAll: "16px",
      contents: [
        { type: "text", text: "📅 會議通知", color: "#FFFFFF", weight: "bold", size: "sm" },
        { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true, margin: "sm" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "16px",
      contents: [row("時間", datetime), row("地點", location), row("主持", host)],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: footerButtons,
    },
  };
}

// Keyword cheat-sheet as a Flex card — clearer than a wall of text. Each entry
// shows an icon + plain-language title, a short description, and the exact words
// to type (in a highlighted pill).
export function buildKeywordGuideMessage() {
  const entry = (icon, title, desc, keys) => ({
    type: "box", layout: "vertical", spacing: "xs", margin: "lg",
    contents: [
      { type: "text", text: `${icon}  ${title}`, weight: "bold", size: "sm", color: "#1B1A2B" },
      { type: "text", text: desc, size: "xs", color: "#8A8896", wrap: true },
      { type: "box", layout: "vertical", backgroundColor: "#ECEAF7", cornerRadius: "8px",
        paddingAll: "8px", margin: "sm",
        contents: [
          { type: "text", text: "輸入 Type", size: "xxs", color: "#908DA6" },
          { type: "text", text: keys, size: "sm", color: ACCENT, weight: "bold", wrap: true, margin: "xs" },
        ] },
    ],
  });
  const sep = { type: "separator", margin: "lg", color: "#EDEBF2" };
  return {
    type: "flex",
    altText: "會議大師 常用關鍵字：我的會議 / register / 關鍵字 / admin",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: ACCENT, paddingAll: "16px",
        contents: [
          { type: "text", text: "📖 常用關鍵字", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "在對話框輸入下列文字即可開啟功能", color: "#DAD7F2", size: "xs", margin: "sm", wrap: true },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px", spacing: "none",
        contents: [
          entry("🗓", "我的會議 My Meetings", "查看會議、確認出席 / 請假、個人統計",
                "我的會議 · mymeetings · 請假 · leave · rsvp · 改期 · 更新"),
          sep,
          entry("📝", "修改個人資料 Update profile", "重新填寫 姓名 / 部門 / 職位",
                "register · new · 註冊 · 改名"),
          sep,
          entry("❓", "使用說明 Help", "再次顯示這份關鍵字說明",
                "關鍵字 · 說明 · help · keyword · 指令 · 功能 · 使用說明"),
          sep,
          entry("🛠", "管理者後台 Admin（僅限管理者）", "取得後台連結與通行碼",
                "admin · 管理 · 後台 · 管理者 · 主持人後台"),
        ],
      },
    },
  };
}

// Wrap a Flex bubble as a LINE "flex" message with alt text (shown in the
// chat list / on devices that can't render Flex).
export function buildNoticeMessage(meeting, baseUrl = "") {
  const altText = `【會議通知】${meeting.title || "會議"}｜${meeting.datetime || ""}`.trim();
  return {
    type: "flex",
    altText: altText.slice(0, 400),
    contents: buildNoticeFlex(meeting, baseUrl),
  };
}

// A lighter-weight "you haven't read the agenda yet" reminder (sent ~1h before
// the meeting to participants who haven't opened the agenda).
export function buildReminderMessage(meeting, baseUrl = "") {
  const uri = deepLink(baseUrl, { view: "invite", m: meeting.id || "preview", intent: "agenda" });
  return {
    type: "text",
    text: `⏰ 會議提醒\n${meeting.title}\n${meeting.datetime}\n\n您尚未確認議程，請於會議前點開查看：\n${uri}`,
  };
}

// Cancellation notice — sent to attendees when the host cancels a meeting.
// Flex card sent when a meeting is cancelled (crimson) or deleted (grey).
function buildRemovalMessage(meeting, { deleted } = {}) {
  const title = meeting.title || "（未命名會議）";
  const datetime = meeting.datetime || "—";
  const location = meeting.location || "";
  const host = meeting.host || "";
  const color = deleted ? "#6B6880" : "#993556";
  const heading = deleted ? "🗑 會議已取消" : "⚠️ 會議取消通知";
  const msg = deleted
    ? "此會議已取消（移除），您無需出席。"
    : "此會議已取消，您無需出席。造成不便，敬請見諒。";
  const row = (label, value) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#999999", size: "sm", flex: 2 },
      { type: "text", text: value, color: "#333333", size: "sm", flex: 5, wrap: true },
    ],
  });
  const rows = [row("時間 Time", datetime)];
  if (location) rows.push(row("地點 Venue", location));
  if (host) rows.push(row("主持 Host", host));
  rows.push({ type: "separator", margin: "lg", color: "#EEEEEE" });
  rows.push({ type: "text", text: msg, size: "sm", color, weight: "bold", wrap: true, margin: "lg" });
  return {
    type: "flex",
    altText: `${deleted ? "會議已取消" : "會議取消通知"}｜${title}｜${datetime}`.slice(0, 400),
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: color, paddingAll: "16px",
        contents: [
          { type: "text", text: heading, color: "#FFFFFF", weight: "bold", size: "sm" },
          { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true, margin: "sm", decoration: "line-through" },
        ],
      },
      body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", contents: rows },
    },
  };
}
// One consolidated notice for a batch of meetings (same title/time, many dates).
export function buildBatchNoticeMessage({ title, location, onlineUrl, startTime, endTime, dates = [] }) {
  const t = title || "（未命名會議）";
  const time = startTime ? (endTime ? `${startTime}–${endTime}` : startTime) : "";
  const dateRows = dates.map((d) => ({ type: "text", text: `・${d}${time ? `　${time}` : ""}`, size: "sm", color: "#333333", wrap: true }));
  const body = [];
  if (location) body.push({ type: "text", text: `📍 ${location}`, size: "sm", color: "#666666", wrap: true });
  const joinBtn = joinOnlineButton(onlineUrl);
  if (joinBtn) body.push({ type: "text", text: "🔗 線上會議 Online（見下方按鈕）", size: "sm", color: ONLINE_GREEN, wrap: true });
  body.push({ type: "text", text: `共 ${dates.length} 場 · Dates`, size: "xs", color: "#999999", margin: "md" });
  body.push(...dateRows);
  const bubble = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical", backgroundColor: ACCENT, paddingAll: "16px",
      contents: [
        { type: "text", text: `📅 會議通知（共 ${dates.length} 場）`, color: "#FFFFFF", weight: "bold", size: "sm" },
        { type: "text", text: t, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true, margin: "sm" },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: body },
  };
  if (joinBtn) bubble.footer = { type: "box", layout: "vertical", paddingAll: "16px", contents: [joinBtn] };
  return {
    type: "flex",
    altText: `【會議通知】${t}（共 ${dates.length} 場）`.slice(0, 400),
    contents: bubble,
  };
}
// Flex card sent when a meeting's details are updated.
export function buildUpdateMessage(meeting) {
  const title = meeting.title || "（未命名會議）";
  const datetime = meeting.datetime || "—";
  const location = meeting.location || "";
  const onlineUrl = sanitizeUrl(meeting.onlineUrl);
  const host = meeting.host || "";
  const AMBER = "#854F0B";
  const row = (label, value) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#999999", size: "sm", flex: 2 },
      { type: "text", text: value, color: "#333333", size: "sm", flex: 5, wrap: true },
    ],
  });
  const rows = [row("時間 Time", datetime)];
  if (location) rows.push(row("地點 Venue", location));
  if (onlineUrl) rows.push(row("線上 Online", "見下方按鈕 See button"));
  if (host) rows.push(row("主持 Host", host));
  rows.push({ type: "separator", margin: "lg", color: "#EEEEEE" });
  rows.push({ type: "text", text: "此會議已更新，請查看最新資訊。The meeting has been updated.", size: "sm", color: AMBER, weight: "bold", wrap: true, margin: "lg" });
  const bubble = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical", backgroundColor: AMBER, paddingAll: "16px",
      contents: [
        { type: "text", text: "🔄 會議已更新 Updated", color: "#FFFFFF", weight: "bold", size: "sm" },
        { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true, margin: "sm" },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", contents: rows },
  };
  const joinBtn = joinOnlineButton(onlineUrl);
  if (joinBtn) bubble.footer = { type: "box", layout: "vertical", paddingAll: "16px", contents: [joinBtn] };
  return {
    type: "flex",
    altText: `【會議已更新】${title}｜${datetime}`.slice(0, 400),
    contents: bubble,
  };
}
export function buildCancelMessage(meeting) { return buildRemovalMessage(meeting, { deleted: false }); }
export function buildDeleteMessage(meeting) { return buildRemovalMessage(meeting, { deleted: true }); }

// Welcome + registration prompt sent when someone first adds the OA.
// Links to the web form that collects Name / Employee ID / Email.
export function buildRegistrationMessage(userId, baseUrl = "") {
  const uri = deepLink(baseUrl, { view: "register", u: userId });
  return {
    type: "flex",
    altText: "歡迎加入會議大師，請完成成員註冊（姓名 / 員工編號 / Email）",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: ACCENT, paddingAll: "16px",
        contents: [
          { type: "text", text: "🦁 歡迎加入 會議大師", color: "#FFFFFF", weight: "bold", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: [
          { type: "text", text: "請完成或更新您的成員資料，以便接收會議通知與點名。", size: "sm", color: "#333333", wrap: true },
          { type: "text", text: "填寫：姓名、員工編號、Email", size: "sm", color: "#999999", wrap: true, margin: "md" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [
          { type: "button", style: "primary", color: ACCENT, height: "sm",
            action: { type: "uri", label: "✍️ 完成註冊", uri } },
        ],
      },
    },
  };
}

// "My meetings" prompt — links to the page where a participant reviews their
// upcoming meetings and confirms / takes leave per occurrence.
export function buildMyMeetingsMessage(baseUrl = "", userId = "") {
  const uri = deepLink(baseUrl, userId ? { view: "mymeetings", u: userId } : { view: "mymeetings" });
  return {
    type: "flex",
    altText: "管理您的會議出席（確認 / 請假）",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: ACCENT, paddingAll: "16px",
        contents: [{ type: "text", text: "🗓 我的會議", color: "#FFFFFF", weight: "bold", size: "md" }] },
      body: { type: "box", layout: "vertical", paddingAll: "16px",
        contents: [{ type: "text", text: "查看您的近期會議，並更新出席或請假（可指定不克出席的日期）。", size: "sm", color: "#333333", wrap: true }] },
      footer: { type: "box", layout: "vertical", paddingAll: "16px",
        contents: [{ type: "button", style: "primary", color: ACCENT, height: "sm",
          action: { type: "uri", label: "🗓 管理我的會議", uri } }] },
    },
  };
}

// Check-in prompt sent when a meeting starts. Personalised link (u=userId) so
// the check-in page knows who is checking in.
export function buildCheckinMessage(meeting, baseUrl = "", userId = "") {
  const params = { view: "checkin", m: meeting.id || "preview" };
  if (userId) params.u = userId;
  const uri = deepLink(baseUrl, params);
  return {
    type: "flex",
    altText: `【報到】${meeting.title || "會議"} 已開始，請點選報到`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: ACCENT, paddingAll: "16px",
        contents: [
          { type: "text", text: "🙋 會議報到", color: "#FFFFFF", weight: "bold", size: "sm" },
          { type: "text", text: meeting.title || "（未命名會議）", color: "#FFFFFF", weight: "bold", size: "lg", wrap: true, margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [{ type: "text", text: `會議已開始（${meeting.datetime || ""}），請點選下方按鈕完成報到。`, size: "sm", color: "#333333", wrap: true }],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: [
          { type: "button", style: "primary", color: ACCENT, height: "sm",
            action: { type: "uri", label: "🙋 立即報到", uri } },
          // Online / hybrid: let them jump into the call from the same card.
          ...(joinOnlineButton(meeting.onlineUrl) ? [joinOnlineButton(meeting.onlineUrl)] : []),
        ],
      },
    },
  };
}

async function lineFetch(path, init) {
  const res = await fetch(`${LINE_API}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.message || body?.raw || `LINE API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.details = body;
    throw err;
  }
  return body;
}

// GET the OA profile — used to confirm the channel is connected.
export async function getBotInfo() {
  return lineFetch("/v2/bot/info", { headers: authHeaders() });
}

// GET the monthly message quota + consumption.
export async function getQuota() {
  const [quota, consumption] = await Promise.all([
    lineFetch("/v2/bot/message/quota", { headers: authHeaders() }).catch(() => null),
    lineFetch("/v2/bot/message/quota/consumption", { headers: authHeaders() }).catch(() => null),
  ]);
  return { quota, consumption };
}

// Broadcast to every follower of the OA.
export async function broadcast(messages) {
  return lineFetch("/v2/bot/message/broadcast", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ messages }),
  });
}

// Push to a specific userId (cheaper than broadcast; needs a real follower id).
export async function pushTo(to, messages) {
  return lineFetch("/v2/bot/message/push", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ to, messages }),
  });
}

// Reply to an event using its replyToken (free; does not consume quota).
export async function replyMessage(replyToken, messages) {
  return lineFetch("/v2/bot/message/reply", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ replyToken, messages }),
  });
}

// Send to a selected set of userIds (up to 500) — the "broadcast to selected
// users" primitive. Each recipient counts against the monthly quota.
export async function multicast(to, messages) {
  return lineFetch("/v2/bot/message/multicast", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ to, messages }),
  });
}
