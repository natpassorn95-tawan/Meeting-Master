import express from "express";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNoticeMessage,
  buildReminderMessage,
  buildRegistrationMessage,
  buildMyMeetingsMessage,
  buildCheckinMessage,
  buildCancelMessage,
  buildDeleteMessage,
  buildUpdateMessage,
  buildBatchNoticeMessage,
  buildKeywordGuideMessage,
  getBotInfo,
  getQuota,
  broadcast,
  pushTo,
  multicast,
  replyMessage,
  verifySignature,
} from "./line.js";
import * as db from "./store.js";
import { linkMemberIdentity, startIdentitySync } from "./identity-link.js";
import { handleAiaiTasksPostback } from "./aiai-tasks.js";

// Load .env (LINE_CHANNEL_ACCESS_TOKEN etc.) — Node 22 built-in, no dependency.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // .env is optional; LINE endpoints will report "not configured" without it.
}

const PORT = process.env.PORT || 8899;
const LINE_CONFIGURED = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
// Public origin participant deep-links point at. For LAN demos set this to
// http://<your-LAN-IP>:5273; for real LINE delivery it must be https.
const BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:5273";
// Typing one of these in the OA chat re-opens registration (to change name etc).
const REGISTER_KEYWORDS = ["new", "改名", "註冊", "register"];
// …and these open "My Meetings" to confirm / take leave per occurrence.
const MEETING_KEYWORDS = ["請假", "leave", "rsvp", "我的會議", "改期", "更新", "mymeetings"];
// …and these reply with the CURRENT admin console link (the public URL can
// change when the tunnel restarts, so this always returns the live one).
const ADMIN_KEYWORDS = ["admin", "管理", "後台", "管理者", "主持人後台"];
// …and these re-send the keyword cheat-sheet (also pushed right after register).
const HELP_KEYWORDS = ["關鍵字", "說明", "help", "keyword", "指令", "功能", "使用說明"];
// Rich-menu buttons (message actions — reply for free; no push quota):
const CHECKIN_KEYWORDS = ["報到", "checkin", "check-in", "簽到"]; // → My Meetings (check-in shows during the meeting)
const AGENDA_KEYWORDS = ["議程", "agenda"];                       // → My Meetings (agenda per meeting)
const TASK_KEYWORDS = ["任務", "tasks", "任務看板"];              // → coming soon (no tasks feature yet)
const CREATE_KEYWORDS = ["建立會議", "create", "建立"];           // → admin console link

db.loadStore(); // restore persisted data (members, schedules, meetings…)
db.seed();      // seeds the empty meeting only if nothing was loaded

const app = express();
// Request log (helps trace what the LINE in-app browser actually hits).
app.use((req, _res, next) => { console.log(`${req.method} ${req.url}`); next(); });
// Keep the raw body so we can verify the LINE webhook signature. Large limit so
// base64-encoded agenda attachments (images/PDF/Office) fit.
app.use(express.json({ limit: "30mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Persist to disk after any successful mutating request (debounced).
app.use((req, res, next) => {
  res.on("finish", () => { if (req.method !== "GET" && res.statusCode < 400) db.persist(); });
  next();
});

// Serve the built web app from this same origin (no separate dev/preview
// server, no proxy hop) — one bundle, reliable through the tunnel.
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
app.use(express.static(DIST));

// Uploaded agenda attachments live on disk and are served statically.
const UPLOADS = fileURLToPath(new URL("../uploads", import.meta.url));
fs.mkdirSync(UPLOADS, { recursive: true });
app.use("/uploads", express.static(UPLOADS));

// Accept a base64 data URL and store it as a file; returns its public URL.
app.post("/api/uploads", (req, res) => {
  const { name, dataUrl, type } = req.body || {};
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return res.status(400).json({ error: "valid dataUrl required" });
  const buf = Buffer.from(m[2], "base64");
  const safe = (name || "file").replace(/[^\w.\-]+/g, "_").slice(-60);
  const fname = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  fs.writeFileSync(path.join(UPLOADS, fname), buf);
  res.json({ url: `/uploads/${fname}`, name: name || fname, type: type || m[1], size: buf.length });
});

// ── Which build is this? ───────────────────────────────────────────────
// "The fix isn't working" and "the fix isn't deployed" look identical from
// the outside, and answering that used to mean shelling into the host. This
// makes it a URL: open /api/version on any instance and compare the commit
// with `git log -1` locally. MM_COMMIT lets a Docker build stamp it in, since
// the image carries no .git directory.
const BUILD = (() => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let version = "unknown";
  try { version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version; } catch { /* keep unknown */ }
  let commit = (process.env.MM_COMMIT || "").trim();
  if (!commit) {
    try {
      const head = fs.readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
      const ref = head.startsWith("ref: ") ? head.slice(5) : null;
      commit = (ref ? fs.readFileSync(path.join(root, ".git", ref), "utf8") : head).trim().slice(0, 7);
    } catch { commit = "unknown"; }
  }
  return { version, commit, startedAt: new Date().toISOString() };
})();

app.get("/api/version", (_req, res) => res.json(BUILD));

// ── LINE connection ────────────────────────────────────────────────────
app.get("/api/line/status", async (_req, res) => {
  if (!LINE_CONFIGURED) {
    return res.json({ connected: false, reason: "LINE_CHANNEL_ACCESS_TOKEN not set" });
  }
  try {
    const [info, q] = await Promise.all([getBotInfo(), getQuota()]);
    res.json({
      connected: true,
      displayName: info.displayName,
      basicId: info.basicId,
      pictureUrl: info.pictureUrl,
      quota: q.quota,
      consumption: q.consumption,
    });
  } catch (e) {
    res.status(502).json({ connected: false, reason: e.message });
  }
});

// ── Access control (per-user visibility) ────────────────────────────────
// The console user identifies via the `x-mm-user` header (their LINE userId,
// chosen from the member list). Public meetings are visible to everyone;
// private ones only to the creator + invited recipients. NOTE: the header is
// client-supplied — this scopes access for an internal tool, it is not
// cryptographic authentication.
function currentUser(req) { return String(req.get("x-mm-user") || "").trim(); }
function invitedIds(obj) {
  const ids = new Set();
  if (Array.isArray(obj?.recipientIds)) obj.recipientIds.forEach((x) => ids.add(x));
  (obj?.roster || []).forEach((p) => { if (p.lineUserId) ids.add(p.lineUserId); });
  // A materialised occurrence (id "schedule__date") inherits its schedule's
  // current invited recipients, so inviting someone later takes effect.
  const sid = obj?.id && obj.id.includes("__") ? obj.id.slice(0, obj.id.indexOf("__")) : null;
  if (sid) { const s = db.getSchedule(sid); if (s && Array.isArray(s.recipientIds)) s.recipientIds.forEach((x) => ids.add(x)); }
  return [...ids];
}
function canSee(obj, uid) {
  if (!obj) return false;
  if (obj.visibility !== "private") return true;              // public / legacy → everyone
  if (obj.creatorId && obj.creatorId === uid) return true;    // the creator
  return invitedIds(obj).includes(uid);                        // an invited recipient
}
function canEdit(obj, uid) {
  if (!obj) return false;
  if (!obj.creatorId) return true;          // legacy (no creator) → anyone can manage
  return obj.creatorId === uid;             // otherwise only the creator
}
// Inviting is collaborative: several admins share meeting admin here, and the
// console identity is per-browser, so tying invite to the exact creator left
// meetings that nobody present could staff — the creator themselves gets locked
// out after picking a different name on another device. Any registered member
// may add attendees. Destructive actions (edit / cancel / delete) stay
// creator-only, so this widens who can staff a meeting, not who can break one.
function canInvite(obj, uid) {
  if (!obj) return false;
  if (canEdit(obj, uid)) return true;
  const member = uid ? db.getMember(uid) : null;
  return !!member && member.status === "registered" && member.active !== false;
}

// ── Meetings ─────────────────────────────────────────────────────────
app.get("/api/meetings", (req, res) => res.json(db.listMeetings().filter((m) => canSee(m, currentUser(req)))));

app.post("/api/meetings", (req, res) => {
  const { title } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "title is required" });
  res.status(201).json(db.createMeeting({ ...req.body, creatorId: currentUser(req) || req.body?.creatorId || null }));
});

// ── Deleted folder (Schedules page) + Cancelled folder (Host page) ──────
// "deleted"/"cancelled" GET routes are registered before "/:id" so they
// aren't matched as a meeting id.
// Deleted: schedules the admin deleted (their occurrences land here).
app.get("/api/meetings/deleted", (req, res) => res.json(db.listDeleted().filter((m) => canSee(m, currentUser(req)))));
// Cancelled: meetings the host cancelled from the dashboard.
app.get("/api/meetings/cancelled", (req, res) => res.json(db.listCancelled().filter((m) => canSee(m, currentUser(req)))));

// Scheduling-conflict check: given proposed date(s) + time + attendee names,
// return which attendees are already booked in an overlapping meeting. Used by
// the create/edit form to warn the creator (soft, non-blocking).
app.post("/api/meetings/check-conflicts", (req, res) => {
  const { dates, startTime, endTime, names, excludeMeetingId } = req.body || {};
  res.json(db.findConflicts({ dates, startTime, endTime, names, excludeMeetingId }));
});

app.post("/api/meetings/:id/trash", (req, res) => {
  const existing = db.getMeeting(req.params.id);
  if (existing && !canEdit(existing, currentUser(req))) return res.status(403).json({ error: "only the creator can delete this meeting", code: "not_owner" });
  // Delete is silent cleanup — no LINE notice to attendees (unlike Cancel).
  const m = db.trashMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  res.json(m);
});

app.post("/api/meetings/:id/restore", (req, res) => {
  const bucketed = db.listDeleted().find((x) => x.id === req.params.id);
  if (bucketed && !canEdit(bucketed, currentUser(req))) return res.status(403).json({ error: "only the creator can restore this meeting", code: "not_owner" });
  const m = db.restoreMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "not in trash" });
  res.json(m);
});
app.post("/api/meetings/:id/restore-cancelled", (req, res) => {
  const bucketed = db.listCancelled().find((x) => x.id === req.params.id);
  if (bucketed && !canEdit(bucketed, currentUser(req))) return res.status(403).json({ error: "only the creator can restore this meeting", code: "not_owner" });
  const m = db.restoreCancelled(req.params.id);
  if (!m) return res.status(404).json({ error: "not in cancelled" });
  res.json(m);
});

// Permanent delete (purge from the deleted or cancelled folder).
app.delete("/api/meetings/:id", (req, res) => {
  const bucketed = db.listDeleted().find((x) => x.id === req.params.id);
  if (bucketed && !canEdit(bucketed, currentUser(req))) return res.status(403).json({ error: "only the creator can delete this meeting", code: "not_owner" });
  if (!db.purgeMeeting(req.params.id)) return res.status(404).json({ error: "not in trash" });
  res.status(204).end();
});
app.delete("/api/meetings/:id/cancelled", (req, res) => {
  const bucketed = db.listCancelled().find((x) => x.id === req.params.id);
  if (bucketed && !canEdit(bucketed, currentUser(req))) return res.status(403).json({ error: "only the creator can delete this meeting", code: "not_owner" });
  if (!db.purgeCancelled(req.params.id)) return res.status(404).json({ error: "not in cancelled" });
  res.status(204).end();
});

app.get("/api/meetings/:id", (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  const uid = currentUser(req);
  if (uid && !canSee(m, uid)) return res.status(403).json({ error: "not visible to you", code: "not_visible" });
  res.json(db.withScheduleAttachments(m));
});

// Admin maintenance: edit meeting basics / agenda / roster (responses kept).
// Creator-only.
app.patch("/api/meetings/:id/meta", (req, res) => {
  const existing = db.getMeeting(req.params.id);
  if (!existing) return res.status(404).json({ error: "meeting not found" });
  if (!canEdit(existing, currentUser(req))) return res.status(403).json({ error: "only the creator can edit this meeting", code: "not_owner" });
  res.json(db.updateMeetingMeta(req.params.id, req.body || {}));
});
app.put("/api/meetings/:id/topics", (req, res) => {
  const existing = db.getMeeting(req.params.id);
  if (!existing) return res.status(404).json({ error: "meeting not found" });
  if (!canEdit(existing, currentUser(req))) return res.status(403).json({ error: "only the creator can edit this meeting", code: "not_owner" });
  res.json(db.setTopics(req.params.id, req.body?.topics));
});
app.put("/api/meetings/:id/roster", (req, res) => {
  const existing = db.getMeeting(req.params.id);
  if (!existing) return res.status(404).json({ error: "meeting not found" });
  if (!canEdit(existing, currentUser(req))) return res.status(403).json({ error: "only the creator can edit this meeting", code: "not_owner" });
  res.json(db.setRoster(req.params.id, req.body?.roster));
});

// Invite attendees to an existing meeting (creator-only). Adds them to the
// roster (so they get notices + can see a private meeting) and to the parent
// schedule's invite list, then pushes them the meeting notice.
app.post("/api/meetings/:id/invite", async (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  if (!canInvite(m, currentUser(req))) {
    // Say which of the two problems it is; "only the creator can invite" sent
    // people hunting for a permission bug when they were simply signed out.
    return res.status(403).json(currentUser(req)
      ? { error: "your console sign-in is not a registered member — pick your name again", code: "not_registered" }
      : { error: "sign in to the console (pick your name) before inviting", code: "not_signed_in" });
  }
  const members = Array.isArray(req.body?.members) ? req.body.members : [];
  const sid = db.scheduleIdOf(m.id);
  let added = 0;
  const toNotify = [];
  for (const mem of members) {
    const name = String(mem?.name || "").trim();
    if (!name) continue;
    const p = db.addParticipant(m.id, { name, dept: mem.dept, lineUserId: mem.lineUserId });
    if (!p) continue;
    added++;
    if (sid) db.addScheduleInvitee(sid, { name, dept: mem.dept, lineUserId: mem.lineUserId });
    if (/^U[0-9a-f]{32}$/.test(mem.lineUserId || "")) toNotify.push(mem.lineUserId);
  }
  let pushed = 0;
  if (LINE_CONFIGURED && toNotify.length) {
    const msg = [buildNoticeMessage(m, BASE_URL)];
    for (const uid of toNotify) { try { await pushTo(uid, msg); pushed++; } catch { /* keep going */ } }
  }
  res.json({ ok: true, added, pushed });
});

// Auto-enroll a (registered) participant into a meeting so the LINE buttons can
// resolve them without a name picker. Idempotent (matched by name).
app.post("/api/meetings/:id/enroll", (req, res) => {
  const p = db.addParticipant(req.params.id, req.body || {});
  if (!p) return res.status(400).json({ error: "name required or meeting not found" });
  res.json(p);
});

// Roster + every participant's response — powers the host dashboard.
app.get("/api/meetings/:id/responses", (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  const uid = currentUser(req);
  if (uid && !canSee(m, uid)) return res.status(403).json({ error: "not visible to you", code: "not_visible" });
  res.json({
    meeting: { id: m.id, title: m.title, datetime: m.datetime, location: m.location, onlineUrl: m.onlineUrl, host: m.host },
    topics: m.topics,
    // The host needs to see what participants were sent — the dashboard used
    // to omit attachments entirely, so a file the creator attached was
    // invisible on the very screen they manage the meeting from. Same
    // schedule fallback as the participant views.
    attachments: db.withScheduleAttachments(m).attachments || [],
    roster: m.roster,
    responses: m.roster.map((p) => m.responses[p.id]),
  });
});

// Build the notice payload without sending — for the in-app preview.
app.post("/api/line/notice/preview", (req, res) => {
  res.json({ message: buildNoticeMessage(req.body || {}, BASE_URL) });
});

// Send the notice for a meeting to LINE.
// body: { mode: "broadcast" | "push", to? }
app.post("/api/meetings/:id/notify", async (req, res) => {
  if (!LINE_CONFIGURED) return res.status(409).json({ error: "LINE not configured" });
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  const { mode = "broadcast", to } = req.body || {};
  const messages = [buildNoticeMessage(m, BASE_URL)];
  try {
    if (mode === "push") {
      const target = String(to || process.env.LINE_TEST_USER_ID || "").trim();
      if (!target) return res.status(400).json({ error: "push mode needs a userId (to)" });
      const result = await pushTo(target, messages);
      return res.json({ ok: true, mode: "push", to: target, result });
    }
    const result = await broadcast(messages);
    res.json({ ok: true, mode: "broadcast", result });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message, details: e.details });
  }
});

// Remind participants who haven't opened the agenda (push to those with a
// known LINE userId; always reports who is still unread for the demo).
app.post("/api/meetings/:id/remind-unread", async (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  const unread = m.roster
    .map((p) => m.responses[p.id])
    .filter((r) => !r.agendaReadAt && r.rsvp !== "leave");
  let pushed = 0;
  if (LINE_CONFIGURED) {
    const msg = [buildReminderMessage(m, BASE_URL)];
    for (const r of unread) {
      if (r.lineUserId) {
        try { await pushTo(r.lineUserId, msg); pushed++; } catch { /* keep going */ }
      }
    }
  }
  res.json({ ok: true, unread: unread.map((r) => ({ name: r.name, dept: r.dept })), pushed });
});

// Notify attendees that a meeting's details were updated (creator-only).
app.post("/api/meetings/:id/notify-update", async (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  if (!canEdit(m, currentUser(req))) return res.status(403).json({ error: "only the creator can update this meeting", code: "not_owner" });
  let pushed = 0, recipients = 0;
  if (LINE_CONFIGURED) {
    const msg = [buildUpdateMessage(m)];
    for (const p of m.roster) {
      if (!/^U[0-9a-f]{32}$/.test(p.lineUserId || "")) continue;
      recipients++;
      try { await pushTo(p.lineUserId, msg); pushed++; } catch { /* keep going */ }
    }
  }
  res.json({ ok: true, pushed, recipients });
});

// Cancel a meeting: notify every attendee (with a real LINE userId) that it is
// cancelled, then move it to the Host "Cancelled meetings" folder (restorable).
app.post("/api/meetings/:id/cancel", async (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  if (!canEdit(m, currentUser(req))) return res.status(403).json({ error: "only the creator can cancel this meeting", code: "not_owner" });
  let pushed = 0, recipients = 0;
  if (LINE_CONFIGURED) {
    const msg = [buildCancelMessage(m)];
    for (const p of m.roster) {
      if (!/^U[0-9a-f]{32}$/.test(p.lineUserId || "")) continue;
      recipients++;
      try { await pushTo(p.lineUserId, msg); pushed++; } catch { /* keep going */ }
    }
  }
  db.cancelMeeting(m.id);
  res.json({ ok: true, pushed, recipients });
});

// ── Participant responses (the "Receive" + agenda-preview surface) ─────
app.get("/api/meetings/:id/participant/:pid", (req, res) => {
  const m = db.getMeeting(req.params.id);
  const r = db.getResponse(req.params.id, req.params.pid);
  if (!m || !r) return res.status(404).json({ error: "not found" });
  res.json({
    meeting: { id: m.id, title: m.title, datetime: m.datetime, location: m.location, onlineUrl: m.onlineUrl, host: m.host },
    topics: m.topics,
    response: r,
  });
});

app.post("/api/meetings/:id/participant/:pid/rsvp", (req, res) => {
  const { value, leaveReason } = req.body || {};
  if (!["yes", "leave"].includes(value)) return res.status(400).json({ error: "value must be yes|leave" });
  const mm = db.getMeeting(req.params.id);
  if (mm && meetingEnded(mm)) return res.status(409).json({ error: "meeting has ended; attendance is locked", code: "meeting_locked" });
  const r = db.setRsvp(req.params.id, req.params.pid, value, leaveReason);
  if (!r) return res.status(404).json({ error: "not found" });
  // Confirming a recurring occurrence sets the standing default for the schedule.
  if (value === "yes") { const sid = db.scheduleIdOf(req.params.id); if (sid) db.setStanding(sid, r.name, "yes"); }
  res.json(r);
});

app.post("/api/meetings/:id/participant/:pid/agenda-read", (req, res) => {
  const r = db.markAgendaRead(req.params.id, req.params.pid);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

app.post("/api/meetings/:id/participant/:pid/comments", (req, res) => {
  const { topicId, stance, text } = req.body || {};
  const mm = db.getMeeting(req.params.id);
  if (mm && meetingEnded(mm)) return res.status(409).json({ error: "meeting has ended; comments are locked", code: "meeting_locked" });
  const r = db.setComment(req.params.id, req.params.pid, topicId, stance, text);
  if (!r) return res.status(400).json({ error: "invalid topic or participant" });
  res.json(r);
});

// ── Check-in ────────────────────────────────────────────────────────────
// Record a participant's check-in (by name; enroll if needed).
app.post("/api/meetings/:id/checkin", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  // Check-in is only allowed during the meeting period; locked before/after.
  if (!checkinOpen(m)) return res.status(409).json({ error: "check-in is only open during the meeting", code: "checkin_closed" });
  const p = db.addParticipant(req.params.id, { name });
  if (!p) return res.status(404).json({ error: "meeting not found" });
  const r = db.checkIn(req.params.id, p.id);
  res.json({ ok: true, checkedInAt: r.checkedInAt });
});

// Check-out: allowed from start until end + 1 hour (must have checked in first).
app.post("/api/meetings/:id/checkout", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  if (!checkoutOpen(m)) return res.status(409).json({ error: "check-out is closed (past the meeting + 1 hour)", code: "checkout_closed" });
  const p = db.addParticipant(req.params.id, { name });
  if (!p) return res.status(404).json({ error: "meeting not found" });
  const r = db.getResponse(req.params.id, p.id);
  if (!r?.checkedInAt) return res.status(409).json({ error: "please check in first", code: "not_checked_in" });
  const out = db.checkOut(req.params.id, p.id);
  res.json({ ok: true, checkedOutAt: out.checkedOutAt });
});

// Push the check-in prompt to a meeting's recipients (personalised per user).
// Only to engaged attendees: confirmed OR read the agenda, and not on leave.
// Someone who neither confirmed nor read the agenda gets no check-in.
function eligibleForCheckin(r) {
  return !!r && r.rsvp !== "leave" && (r.rsvp === "yes" || !!r.agendaReadAt);
}
async function sendCheckin(meeting) {
  if (!LINE_CONFIGURED) return { pushed: 0, skipped: 0 };
  let pushed = 0, skipped = 0;
  for (const p of meeting.roster) {
    if (!/^U[0-9a-f]{32}$/.test(p.lineUserId || "")) { skipped++; continue; }
    const r = meeting.responses[p.id];
    // Everyone on the roster — including the host/creator if they're a recipient
    // — is treated the same: pushed only if they confirmed or read the agenda,
    // and not on leave.
    if (!eligibleForCheckin(r)) { skipped++; continue; }
    try { await pushTo(p.lineUserId, [buildCheckinMessage(meeting, BASE_URL, p.lineUserId)]); pushed++; if (r) r.checkinSentAt = Date.now(); } catch { /* keep going */ }
  }
  return { pushed, skipped };
}

// Is a meeting's check-in window open? Strictly the meeting period: from its
// start time until its end time. Outside that window everything is locked.
function checkinOpen(meeting) {
  if (!meeting?.date || !meeting.startTime) return false;
  const startMs = Date.parse(`${meeting.date}T${meeting.startTime}:00`);
  if (Number.isNaN(startMs)) return false;
  const endMs = meeting.endTime ? Date.parse(`${meeting.date}T${meeting.endTime}:00`) : startMs + CHECKIN_WINDOW_MS;
  const now = Date.now();
  return now >= startMs && now <= endMs; // during the meeting period only
}

// Check-out window: from start until end + 1 hour (a grace hour after the meeting).
function checkoutOpen(meeting) {
  if (!meeting?.date || !meeting.startTime) return false;
  const startMs = Date.parse(`${meeting.date}T${meeting.startTime}:00`);
  if (Number.isNaN(startMs)) return false;
  const endMs = meeting.endTime ? Date.parse(`${meeting.date}T${meeting.endTime}:00`) : startMs + CHECKIN_WINDOW_MS;
  const now = Date.now();
  return now >= startMs && now <= endMs + 60 * 60 * 1000; // start → end + 1h
}

// Has a meeting ended? Once past its end time, attendance is locked (no edits).
function meetingEnded(meeting) {
  if (!meeting?.date) return false;
  const endMs = meeting.endTime
    ? Date.parse(`${meeting.date}T${meeting.endTime}:00`)
    : Date.parse(`${meeting.date}T23:59:59`);
  return Number.isFinite(endMs) && Date.now() > endMs;
}

// When a late attendee confirms / reads the agenda AFTER check-in has opened,
// push them the check-in button right then (once). This is why check-in stays
// gated on "confirm or read agenda": doing either re-triggers the button.
async function maybeSendCheckinTo(meetingId, participantId) {
  if (!LINE_CONFIGURED) return;
  const m = db.getMeeting(meetingId);
  if (!m || !checkinOpen(m)) return;
  const r = m.responses[participantId];
  if (!r || !eligibleForCheckin(r)) return;         // must be confirmed or agenda-read
  if (r.checkedInAt || r.checkinSentAt) return;       // already checked in / already sent
  if (!/^U[0-9a-f]{32}$/.test(r.lineUserId || "")) return;
  try {
    await pushTo(r.lineUserId, [buildCheckinMessage(m, BASE_URL, r.lineUserId)]);
    r.checkinSentAt = Date.now();
    db.persist();
    console.log(`[checkin] re-sent to ${r.name} on ${meetingId} (became eligible)`);
  } catch (e) { console.error("[checkin] re-send failed", e.message); }
}

// Manual trigger (host "send check-in now" button).
app.post("/api/meetings/:id/send-checkin", async (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  const r = await sendCheckin(m);
  res.json({ ok: true, ...r, recipients: m.roster.length });
});

// Shared check-in URL for a meeting (anyone in the room can open it and check
// in — even people who never confirmed / read the agenda, and walk-ins).
function checkinUrl(meetingId) {
  return `${(BASE_URL || "").replace(/\/$/, "")}/?view=checkin&m=${encodeURIComponent(meetingId)}`;
}
app.get("/api/meetings/:id/checkin-link", (req, res) => {
  if (!db.getMeeting(req.params.id)) return res.status(404).json({ error: "meeting not found" });
  res.json({ url: checkinUrl(req.params.id) });
});
// Same link as a scannable QR (SVG) — encodes the public URL so phones can open it.
app.get("/api/meetings/:id/checkin-qr.svg", async (req, res) => {
  if (!db.getMeeting(req.params.id)) return res.status(404).json({ error: "meeting not found" });
  try {
    const svg = await QRCode.toString(checkinUrl(req.params.id), {
      type: "svg", margin: 1, color: { dark: "#1B1A2B", light: "#FFFFFF" },
    });
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-store");
    res.send(svg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── My Meetings: a participant manages attendance across occurrences ───
app.get("/api/my-meetings", (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0); // include today's meetings
  const fromMs = req.query.from ? Date.parse(`${req.query.from}T00:00:00`) : startOfToday.getTime();
  const toMs = req.query.to ? Date.parse(`${req.query.to}T23:59:59`) : now + 120 * 86400000; // ~4 months
  res.json({ name, items: db.memberUpcoming(name, fromMs, toMs) });
});

// Per-participant performance. Pass from/to (YYYY-MM-DD) for an arbitrary date
// window (one day or a multi-day range), or month (YYYY-MM) for a whole month.
app.get("/api/my-meetings/summary", (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const ymd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  if (ymd(req.query.from)) {
    const from = req.query.from;
    const to = ymd(req.query.to) && req.query.to >= from ? req.query.to : from;
    return res.json(db.memberRangeSummary(name, from, to));
  }
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0, 7);
  res.json(db.memberMonthlySummary(name, month));
});

// Update a participant's attendance. "yes" sets the standing default for the
// recurring schedule (so untouched future dates inherit it); "leave" overrides
// one specific date. Untouched dates keep whatever they had.
function materializeOccurrence(scheduleId, occKey) {
  const s = db.getSchedule(scheduleId);
  if (!s) return null;
  const recipients = s.recipientIds?.length ? s.roster.filter((p) => s.recipientIds.includes(p.id)) : s.roster;
  const m = db.getMeeting(`${scheduleId}__${occKey}`) || db.createMeeting({
    id: `${scheduleId}__${occKey}`, title: s.title, date: occKey, startTime: s.startTime, endTime: s.endTime,
    location: s.location, onlineUrl: s.onlineUrl, host: s.host, topics: s.topics, attachments: s.attachments || [], roster: recipients,
    visibility: s.visibility, creatorId: s.creatorId,
  });
  db.applyStanding(m.id, scheduleId);
  return m;
}

app.post("/api/my-meetings/rsvp", (req, res) => {
  const { name, value, leaveReason, meetingId, scheduleId, occKey } = req.body || {};
  if (!String(name || "").trim() || !["yes", "leave"].includes(value)) {
    return res.status(400).json({ error: "name + value (yes|leave) required" });
  }
  const sid = scheduleId || db.scheduleIdOf(meetingId);

  // Lock attendance once the specific occurrence has ended (future dates stay editable).
  const candId = meetingId || (sid && /^\d{4}-\d{2}-\d{2}$/.test(occKey || "") ? `${sid}__${occKey}` : null);
  if (candId) { const cm = db.getMeeting(candId); if (cm && meetingEnded(cm)) return res.status(409).json({ error: "meeting has ended; attendance is locked", code: "meeting_locked" }); }

  if (value === "yes") {
    if (sid) {
      db.setStanding(sid, name, "yes"); // default: attend all future occurrences
      // Also confirm the materialised instance directly so it shows on the host
      // dashboard and unlocks check-in (which is gated on confirm / agenda-read).
      const mId = meetingId || (occKey ? `${sid}__${occKey}` : null);
      if (mId && db.getMeeting(mId)) {
        const p = db.addParticipant(mId, { name });
        if (p) db.setRsvp(mId, p.id, "yes");
      }
      return res.json({ ok: true, scheduleId: sid, standing: "yes" });
    }
    if (meetingId) {
      const p = db.addParticipant(meetingId, { name });
      if (!p) return res.status(404).json({ error: "meeting not found" });
      db.setRsvp(meetingId, p.id, "yes");
      return res.json({ ok: true, meetingId, rsvp: "yes" });
    }
    return res.status(400).json({ error: "meetingId or scheduleId required" });
  }

  // value === "leave": override just this one date.
  let mId = meetingId;
  if (!mId && scheduleId && /^\d{4}-\d{2}-\d{2}$/.test(occKey || "")) {
    const m = materializeOccurrence(scheduleId, occKey);
    if (!m) return res.status(404).json({ error: "schedule not found" });
    mId = m.id;
  }
  if (!mId) return res.status(400).json({ error: "meetingId or scheduleId+occKey required" });
  const p = db.addParticipant(mId, { name });
  if (!p) return res.status(404).json({ error: "meeting not found" });
  const r = db.setRsvp(mId, p.id, "leave", leaveReason);
  res.json({ ok: true, meetingId: mId, rsvp: r.rsvp, leaveReason: r.leaveReason });
});

// ── LINE webhook (real postback/follow events) ─────────────────────────
// Needs a public https URL (tunnel) to actually receive from LINE, and
// LINE_CHANNEL_SECRET set to verify signatures. Captures follower userIds.
app.post("/api/line/webhook", async (req, res) => {
  const sig = req.get("x-line-signature");
  const ok = verifySignature(req.rawBody, sig);
  if (ok === false) return res.status(401).end(); // configured but mismatched
  const events = req.body?.events || [];
  for (const ev of events) {
    const userId = ev.source?.userId;
    if (ev.type === "follow" && userId) {
      // First time adding the OA → create a pending member and ask them to
      // register Name / Employee ID / Email.
      const m = db.upsertPendingMember(userId);
      console.log(`[webhook] follow ${userId} (status: ${m.status})`);
      if (LINE_CONFIGURED && m.status === "pending" && ev.replyToken) {
        try {
          await replyMessage(ev.replyToken, [buildRegistrationMessage(userId, BASE_URL)]);
        } catch (e) { console.error("[webhook] reply failed", e.message); }
      }
    } else if (ev.type === "postback") {
      console.log(`[webhook] postback ${userId}: ${ev.postback?.data}`);
      // Rich-menu "我的任務" → Aiai Board tasks (LINE userId → email → tasks).
      const params = new URLSearchParams(ev.postback?.data || "");
      if (params.get("action") === "aiai_tasks") {
        await handleAiaiTasksPostback({ userId, replyToken: ev.replyToken, baseUrl: BASE_URL });
      }
    } else if (ev.type === "message" && ev.message?.type === "text" && userId) {
      const text = ev.message.text.trim().toLowerCase();
      console.log(`[webhook] message ${userId}: ${text}`);
      // Keyword to (re)open registration so the user can change their name/details.
      if (REGISTER_KEYWORDS.includes(text)) {
        db.upsertPendingMember(userId);
        if (LINE_CONFIGURED && ev.replyToken) {
          try { await replyMessage(ev.replyToken, [buildRegistrationMessage(userId, BASE_URL)]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      } else if (MEETING_KEYWORDS.includes(text)) {
        // Keyword to manage attendance (confirm / leave) on upcoming meetings.
        if (LINE_CONFIGURED && ev.replyToken) {
          try { await replyMessage(ev.replyToken, [buildMyMeetingsMessage(BASE_URL, userId)]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      } else if (ADMIN_KEYWORDS.includes(text)) {
        // Keyword to fetch the CURRENT admin console link (live URL + passcode).
        if (LINE_CONFIGURED && ev.replyToken) {
          const adminUrl = `${BASE_URL}/?view=host`;
          const msg = { type: "text", text: `🛠 會議大師 管理者後台 Admin console\n\n${adminUrl}\n\n開啟後請選擇您的姓名登入 / Open and pick your name to sign in.` };
          try { await replyMessage(ev.replyToken, [msg]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      } else if (HELP_KEYWORDS.includes(text)) {
        // Keyword to re-show the keyword cheat-sheet (Flex card).
        if (LINE_CONFIGURED && ev.replyToken) {
          try { await replyMessage(ev.replyToken, [buildKeywordGuideMessage()]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      } else if (CHECKIN_KEYWORDS.includes(text) || AGENDA_KEYWORDS.includes(text)) {
        // Rich-menu 報到 / 議程 → open My Meetings (check-in + agenda live there).
        if (LINE_CONFIGURED && ev.replyToken) {
          try { await replyMessage(ev.replyToken, [buildMyMeetingsMessage(BASE_URL, userId)]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      } else if (TASK_KEYWORDS.includes(text)) {
        // Rich-menu 任務 → tasks board not built yet.
        if (LINE_CONFIGURED && ev.replyToken) {
          try { await replyMessage(ev.replyToken, [{ type: "text", text: "🗂 任務看板功能開發中，敬請期待。\nTasks board is coming soon." }]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      } else if (CREATE_KEYWORDS.includes(text)) {
        // Rich-menu 建立會議 → creating meetings is done in the admin console.
        if (LINE_CONFIGURED && ev.replyToken) {
          const adminUrl = `${BASE_URL}/?view=host`;
          try { await replyMessage(ev.replyToken, [{ type: "text", text: `🛠 建立會議請至管理者後台：\n${adminUrl}\n開啟後選擇您的姓名登入。` }]); }
          catch (e) { console.error("[webhook] reply failed", e.message); }
        }
      }
    }
  }
  res.status(200).end();
});

// ── Members: registration (first-time onboarding) ──────────────────────
app.get("/api/members", (_req, res) => res.json(db.listMembers()));

app.get("/api/members/:userId", (req, res) => {
  res.json(db.getMember(req.params.userId) || { lineUserId: req.params.userId, status: "new" });
});

// Complete registration from the web form linked in the welcome message.
app.post("/api/members/:userId/register", (req, res) => {
  const { name, employeeId, email, jobTitle, department } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "name is required" });
  if (!String(employeeId || "").trim()) return res.status(400).json({ error: "employeeId is required" });
  if (!String(email || "").trim()) return res.status(400).json({ error: "email is required" });
  if (!String(jobTitle || "").trim()) return res.status(400).json({ error: "jobTitle is required" });
  if (!String(department || "").trim()) return res.status(400).json({ error: "department is required" });
  const m = db.registerMember(req.params.userId, { name, employeeId, email, jobTitle, department });
  res.json(m);
  // Mirror this person into the OPAL central identity service (LINE ↔ email),
  // so other apps can resolve them. Fire-and-forget: never blocks or fails
  // registration if the identity service is down (it queues + retries).
  linkMemberIdentity(m);
  // After registering, push the keyword cheat-sheet so the member knows how to
  // start (fire-and-forget; only to a real, bound LINE userId).
  const uid = req.params.userId;
  if (LINE_CONFIGURED && /^U[0-9a-f]{32}$/.test(uid)) {
    const welcome = { type: "text", text: `✅ 註冊完成，歡迎加入會議大師，${m.name}！\n輸入「關鍵字」可隨時查看以下常用功能。` };
    pushTo(uid, [welcome, buildKeywordGuideMessage()]).catch((e) => console.error("[register] push failed", e.message));
  }
});

// Set a member's employment status: active (with the company) or inactive.
app.patch("/api/members/:userId", (req, res) => {
  if (typeof req.body?.active !== "boolean") return res.status(400).json({ error: "active (boolean) required" });
  const m = db.setMemberActive(req.params.userId, req.body.active);
  if (!m) return res.status(404).json({ error: "member not found" });
  res.json(m);
});

app.delete("/api/members/:userId", (req, res) => {
  db.deleteMember(req.params.userId);
  res.status(204).end();
});

// Demo helper: simulate a first-time follow locally (no public tunnel needed).
// Returns the pending member + the registration link to open.
app.post("/api/members/simulate-follow", (req, res) => {
  const userId = String(req.body?.userId || "").trim() || `Udemo${Date.now().toString(36)}`;
  const m = db.upsertPendingMember(userId);
  res.status(201).json({ member: m, registerUrl: `${BASE_URL}/?view=register&u=${encodeURIComponent(userId)}` });
});

// ── Recurring schedules → auto-broadcast ───────────────────────────────
const AUTOSEND = process.env.SCHEDULER_AUTOSEND !== "0"; // on by default

// Materialise a meeting for a schedule's upcoming occurrence and send the
// notice to the selected recipients (multicast to known userIds; broadcast as
// the demo fallback when no userIds are bound).
async function fireSchedule(s, { live = true } = {}) {
  const occ = db.nextOccurrence(s, Date.now());
  if (!occ) return { error: "no upcoming occurrence" };
  const occKey = db.ymd(occ);
  const meetingId = `${s.id}__${occKey}`;
  // If this occurrence was cancelled / deleted / purged, never (re)materialise or
  // notify — it's off. (createMeeting would otherwise resurrect a trashed copy.)
  if (db.isTrashed(meetingId)) return { mode: "cancelled", meetingId, count: 0 };
  const recipients = s.recipientIds?.length
    ? s.roster.filter((p) => s.recipientIds.includes(p.id))
    : s.roster;

  // Materialise the occurrence's meeting once; reuse it on later sends (so a
  // second lead-time broadcast doesn't reset participants' responses).
  const meeting = db.getMeeting(meetingId) || db.createMeeting({
    id: meetingId,
    title: s.title,
    date: occKey,
    startTime: s.startTime,
    endTime: s.endTime,
    location: s.location,
    onlineUrl: s.onlineUrl,
    host: s.host,
    topics: s.topics,
    attachments: s.attachments || [],
    roster: recipients,
    visibility: s.visibility, creatorId: s.creatorId,
  });
  db.applyStanding(meeting.id, s.id); // reflect standing confirmations on this instance

  // Only registered recipients (bound to a real LINE userId) receive the notice.
  // Unregistered / unbound people get nothing — never a broadcast to all.
  // NOTE: push to each recipient individually rather than multicast — multicast
  // and broadcast are accepted (HTTP 200) but NOT delivered on unverified LINE
  // Official Accounts, whereas push to a friend always works. This matches the
  // cancel / remind-unread flows.
  const ids = recipients.map((p) => p.lineUserId).filter((id) => /^U[0-9a-f]{32}$/.test(id || ""));
  let mode = "skipped", count = 0;
  if (live && LINE_CONFIGURED) {
    if (ids.length) {
      const msg = [buildNoticeMessage(meeting, BASE_URL)];
      for (const id of ids) {
        try { await pushTo(id, msg); count++; }
        catch (e) { meeting._sendError = e.message; }
      }
      mode = count > 0 ? "push" : "error";
    } else {
      mode = "no-recipients"; // nobody registered/bound → nobody notified (by design)
    }
  }
  return { meetingId, occurrenceText: db.decorateSchedule(s, Date.now()).nextOccurrenceText, recipients: recipients.length, bound: ids.length, mode, count };
}

// Calendar feed for the Host page: actual meeting instances + projected
// upcoming occurrences of enabled schedules (so scheduled meetings show too).
app.get("/api/calendar", (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const fromMs = Date.parse(`${from}T00:00:00`);
  const toMs = Date.parse(`${to}T23:59:59`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return res.status(400).json({ error: "from/to required (YYYY-MM-DD)" });

  const uid = currentUser(req);
  const events = [];
  for (const m of db.listMeetings()) {
    if (!m.date) continue;
    if (!canSee(m, uid)) continue; // private meetings only for creator + invited
    const ms = Date.parse(`${m.date}T00:00:00`);
    if (ms >= fromMs && ms <= toMs) {
      events.push({ type: "meeting", id: m.id, date: m.date, title: m.title, startTime: m.startTime, endTime: m.endTime, location: m.location, onlineUrl: m.onlineUrl, count: m.roster.length });
    }
  }
  for (const s of db.listSchedules()) {
    if (!s.enabled) continue;
    if (!canSee(s, uid)) continue; // private schedules only for creator + invited
    for (const occ of db.occurrencesInRange(s, fromMs, toMs)) {
      const occKey = db.ymd(occ);
      const occId = `${s.id}__${occKey}`;
      if (db.getMeeting(occId)) continue; // already materialised → shown as a meeting
      if (db.isTrashed(occId)) continue;  // deleted by the host → stays in the trash, don't re-project
      events.push({ type: "scheduled", scheduleId: s.id, occKey, date: occKey, title: s.title, startTime: s.startTime, endTime: s.endTime, location: s.location, onlineUrl: s.onlineUrl, count: s.recipientIds?.length || s.roster.length });
    }
  }
  res.json(events);
});

// Materialise a schedule occurrence into a meeting (no send) so its host
// dashboard can be opened from the calendar.
app.post("/api/schedules/:id/materialize", (req, res) => {
  const s = db.getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: "schedule not found" });
  const uid = currentUser(req);
  if (uid && !canSee(s, uid)) return res.status(403).json({ error: "not visible to you", code: "not_visible" });
  const occKey = String(req.body?.occKey || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occKey)) return res.status(400).json({ error: "occKey (YYYY-MM-DD) required" });
  const meetingId = `${s.id}__${occKey}`;
  let m = db.getMeeting(meetingId);
  if (!m) {
    const recipients = s.recipientIds?.length ? s.roster.filter((p) => s.recipientIds.includes(p.id)) : s.roster;
    m = db.createMeeting({
      id: meetingId, title: s.title, date: occKey, startTime: s.startTime, endTime: s.endTime,
      location: s.location, onlineUrl: s.onlineUrl, host: s.host, topics: s.topics, attachments: s.attachments || [], roster: recipients,
      visibility: s.visibility, creatorId: s.creatorId,
    });
  }
  db.applyStanding(m.id, s.id);
  res.json(m);
});

app.get("/api/schedules", (req, res) => res.json(db.listSchedules().filter((s) => canSee(s, currentUser(req)))));

app.post("/api/schedules", async (req, res) => {
  if (!String(req.body?.title || "").trim()) return res.status(400).json({ error: "title is required" });
  const { startTime, endTime } = req.body || {};
  if (endTime && startTime && startTime >= endTime) {
    return res.status(400).json({ error: "start time must be before end time" });
  }
  // Stamp the creator from the console identity; auto-invite them so they see it
  // and receive notices (creator + invited).
  const creatorId = currentUser(req) || null;
  const recipientIds = Array.isArray(req.body?.recipientIds) ? [...req.body.recipientIds] : [];
  if (creatorId && !recipientIds.includes(creatorId)) recipientIds.push(creatorId);
  const s = db.createSchedule({ ...req.body, creatorId, recipientIds });

  // `silent` (used for batch/multi-day creation): don't send a per-meeting notice
  // now, and mark this occurrence's lead windows fired so the scheduler doesn't
  // remind per day either — one consolidated batch notice is sent separately.
  let notify = null;
  if (req.body?.silent === true) {
    const occ = db.nextOccurrence(s, Date.now());
    if (occ) { const occKey = db.ymd(occ); for (const lead of s.leads) s.fired[`${occKey}@${lead}`] = true; }
    notify = { mode: "silent", count: 0 };
  } else {
    // Notify the selected recipients immediately on creation (next occurrence),
    // and mark that occurrence's lead windows fired to avoid a duplicate.
    try {
      notify = await fireSchedule(s, { live: true });
      if (notify?.meetingId) {
        const occKey = notify.meetingId.slice(notify.meetingId.indexOf("__") + 2);
        for (const lead of s.leads) s.fired[`${occKey}@${lead}`] = true;
      }
    } catch (e) {
      notify = { mode: "error", error: e.message };
    }
  }

  res.status(201).json({ ...db.decorateSchedule(s, Date.now()), notify });
});

// Send ONE consolidated notice for a batch of just-created schedules (so the
// recipients get a single message for the whole batch, not one per day).
app.post("/api/schedules/notify-batch", async (req, res) => {
  const ids = Array.isArray(req.body?.scheduleIds) ? req.body.scheduleIds : [];
  const uid = currentUser(req);
  const scheds = ids.map((id) => db.getSchedule(id)).filter(Boolean);
  if (!scheds.length) return res.json({ ok: true, pushed: 0, meetings: 0 });
  if (scheds.some((s) => !canEdit(s, uid))) return res.status(403).json({ error: "only the creator can notify", code: "not_owner" });
  const recipients = new Set();
  for (const s of scheds) {
    const recs = s.recipientIds?.length ? s.roster.filter((p) => s.recipientIds.includes(p.id)) : s.roster;
    for (const p of recs) if (/^U[0-9a-f]{32}$/.test(p.lineUserId || "")) recipients.add(p.lineUserId);
  }
  const first = scheds[0];
  const dates = scheds.map((s) => s.recurrence?.date).filter(Boolean).sort();
  let pushed = 0;
  if (LINE_CONFIGURED && recipients.size && dates.length) {
    const msg = [buildBatchNoticeMessage({ title: first.title, location: first.location, onlineUrl: first.onlineUrl, startTime: first.startTime, endTime: first.endTime, dates })];
    for (const rid of recipients) { try { await pushTo(rid, msg); pushed++; } catch { /* keep going */ } }
  }
  res.json({ ok: true, pushed, meetings: scheds.length });
});

app.patch("/api/schedules/:id", (req, res) => {
  const existing = db.getSchedule(req.params.id);
  if (!existing) return res.status(404).json({ error: "schedule not found" });
  if (!canEdit(existing, currentUser(req))) return res.status(403).json({ error: "only the creator can edit this schedule", code: "not_owner" });
  res.json(db.updateSchedule(req.params.id, req.body || {}));
});

app.delete("/api/schedules/:id", (req, res) => {
  const existing = db.getSchedule(req.params.id);
  if (existing && !canEdit(existing, currentUser(req))) return res.status(403).json({ error: "only the creator can delete this schedule", code: "not_owner" });
  db.deleteSchedule(req.params.id);
  res.status(204).end();
});

// Test-fire now (explicit admin action — always sends if LINE configured).
app.post("/api/schedules/:id/run-now", async (req, res) => {
  const s = db.getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: "schedule not found" });
  if (!canEdit(s, currentUser(req))) return res.status(403).json({ error: "only the creator can run this schedule", code: "not_owner" });
  const result = await fireSchedule(s, { live: true });
  res.json({ ok: !result.error, ...result });
});

// Once an occurrence starts, the check-in button is auto-sent if a tick lands
// within this window (forgiving of restarts/downtime; deduped so it's once).
const CHECKIN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// Background tick: for each enabled schedule, fire once per (occurrence, lead)
// whose send window has arrived — so multiple selected lead times each send.
async function tick() {
  const now = Date.now();

  // Auto-purge: permanently drop removed meetings untouched for > 10 days.
  const purged = db.purgeExpiredRemoved(now);
  if (purged.length) {
    console.log(`[scheduler] auto-purged ${purged.length} removed meeting(s) older than 10 days: ${purged.join(", ")}`);
    db.persist();
  }

  for (const real of db.listSchedules().map((s) => db.getSchedule(s.id)).filter(Boolean)) {
    if (!real.enabled) continue;

    // Materialise an occurrence that has just started, so the meeting-driven
    // check-in pass below has a concrete record to work from. Only the
    // occurrence is created here — whether to push is decided there, from the
    // meeting's own times.
    const recent = db.occurrencesInRange(real, now - CHECKIN_WINDOW_MS, now);
    const started = recent.length ? recent[recent.length - 1] : null;
    if (started && !db.isTrashed(`${real.id}__${db.ymd(started)}`)) {
      materializeOccurrence(real.id, db.ymd(started));
    }

    // Lead-time notices: need the next upcoming occurrence.
    const occ = db.nextOccurrence(real, now);
    if (!occ) continue;
    const occKey = db.ymd(occ);
    // Cancelled / deleted / purged occurrence → never remind; mark fired so it stops.
    if (db.isTrashed(`${real.id}__${occKey}`)) {
      for (const lead of real.leads) real.fired[`${occKey}@${lead}`] = true;
      continue;
    }
    for (const lead of real.leads) {
      const sendAt = occ.getTime() - lead * 60000;
      const key = `${occKey}@${lead}`;
      if (now >= sendAt && now < occ.getTime() && !real.fired[key]) {
        if (AUTOSEND) {
          const r = await fireSchedule(real, { live: true });
          console.log(`[scheduler] auto-sent "${real.title}" @${lead}m → ${r.mode} (${r.count})`);
        } else {
          console.log(`[scheduler] window reached for "${real.title}" @${lead}m (AUTOSEND off)`);
        }
        real.fired[key] = true;
      }
    }
  }

  // ── Check-in, driven by each meeting's OWN window ────────────────────
  // This used to be keyed off the schedule's projected start time, so a
  // creator's edit never reached it: push the end time out because a meeting
  // is running late, or move the start, and the prompt still fired against the
  // original slot (and, being deduped schedule-side, re-fired after a restart
  // inside the 2h window). checkinOpen() reads the meeting's real
  // date/start/end — the same rule the check-in screen and 我的會議 use — so
  // the notification now follows whatever the creator last saved.
  // Standalone meetings get an auto check-in for the first time too; they were
  // skipped entirely when only schedules were scanned.
  for (const m of db.listMeetings()) {
    if (m.checkinPushedAt || !checkinOpen(m)) continue;
    // Occurrences already pushed under the old schedule-side flag must not be
    // pushed a second time after this upgrade.
    const sid = db.scheduleIdOf(m.id);
    const s = sid ? db.getSchedule(sid) : null;
    const legacyKey = sid ? `${m.id.slice(sid.length + 2)}@checkin` : null;
    if (s && legacyKey && s.fired?.[legacyKey]) { m.checkinPushedAt = Date.now(); continue; }

    m.checkinPushedAt = Date.now(); // set BEFORE sending: never double-push
    if (s && legacyKey) s.fired[legacyKey] = true;
    if (AUTOSEND) {
      const r = await sendCheckin(m);
      console.log(`[scheduler] check-in sent "${m.title}" ${m.date} ${m.startTime}-${m.endTime} → ${r.pushed} pushed, ${r.skipped} skipped`);
    } else {
      console.log(`[scheduler] check-in window open for "${m.title}" ${m.date} ${m.startTime}-${m.endTime} (AUTOSEND off)`);
    }
    db.persist();
  }
}
setInterval(() => { tick().catch((e) => console.error("[scheduler]", e.message)); }, 60_000);

// SPA fallback: any non-/api GET serves index.html (client-side routing).
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(DIST, "index.html")));

// Flush to disk immediately on shutdown (so restarts never lose data).
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { db.saveStore(); process.exit(0); });
}

app.listen(PORT, () => {
  console.log(`[meeting-master] API on http://localhost:${PORT}`);
  console.log(`[meeting-master] base URL for participant links: ${BASE_URL}`);
  console.log(`[meeting-master] LINE: ${LINE_CONFIGURED ? "configured ✓" : "NOT configured"}`);
  console.log(`[meeting-master] scheduler: tick 60s, autosend ${AUTOSEND ? "ON" : "OFF"}`);
  startIdentitySync(); // background retry sweep for the central identity service
});
