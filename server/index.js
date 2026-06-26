import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNoticeMessage,
  buildReminderMessage,
  buildRegistrationMessage,
  buildMyMeetingsMessage,
  buildCheckinMessage,
  getBotInfo,
  getQuota,
  broadcast,
  pushTo,
  multicast,
  replyMessage,
  verifySignature,
} from "./line.js";
import * as db from "./store.js";

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

// ── Meetings ─────────────────────────────────────────────────────────
app.get("/api/meetings", (_req, res) => res.json(db.listMeetings()));

app.post("/api/meetings", (req, res) => {
  const { title } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "title is required" });
  res.status(201).json(db.createMeeting(req.body));
});

app.get("/api/meetings/:id", (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  res.json(m);
});

// Admin maintenance: edit meeting basics / agenda / roster (responses kept).
app.patch("/api/meetings/:id/meta", (req, res) => {
  const m = db.updateMeetingMeta(req.params.id, req.body || {});
  if (!m) return res.status(404).json({ error: "meeting not found" });
  res.json(m);
});
app.put("/api/meetings/:id/topics", (req, res) => {
  const m = db.setTopics(req.params.id, req.body?.topics);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  res.json(m);
});
app.put("/api/meetings/:id/roster", (req, res) => {
  const m = db.setRoster(req.params.id, req.body?.roster);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  res.json(m);
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
  res.json({
    meeting: { id: m.id, title: m.title, datetime: m.datetime, location: m.location, host: m.host },
    topics: m.topics,
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

// ── Participant responses (the "Receive" + agenda-preview surface) ─────
app.get("/api/meetings/:id/participant/:pid", (req, res) => {
  const m = db.getMeeting(req.params.id);
  const r = db.getResponse(req.params.id, req.params.pid);
  if (!m || !r) return res.status(404).json({ error: "not found" });
  res.json({
    meeting: { id: m.id, title: m.title, datetime: m.datetime, location: m.location, host: m.host },
    topics: m.topics,
    response: r,
  });
});

app.post("/api/meetings/:id/participant/:pid/rsvp", (req, res) => {
  const { value, leaveReason } = req.body || {};
  if (!["yes", "leave"].includes(value)) return res.status(400).json({ error: "value must be yes|leave" });
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
  const r = db.setComment(req.params.id, req.params.pid, topicId, stance, text);
  if (!r) return res.status(400).json({ error: "invalid topic or participant" });
  res.json(r);
});

// ── Check-in ────────────────────────────────────────────────────────────
// Record a participant's check-in (by name; enroll if needed).
app.post("/api/meetings/:id/checkin", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const p = db.addParticipant(req.params.id, { name });
  if (!p) return res.status(404).json({ error: "meeting not found" });
  const r = db.checkIn(req.params.id, p.id);
  res.json({ ok: true, checkedInAt: r.checkedInAt });
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
    if (!eligibleForCheckin(meeting.responses[p.id])) { skipped++; continue; } // not confirmed & not read agenda → skip
    try { await pushTo(p.lineUserId, [buildCheckinMessage(meeting, BASE_URL, p.lineUserId)]); pushed++; } catch { /* keep going */ }
  }
  return { pushed, skipped };
}

// Manual trigger (host "send check-in now" button).
app.post("/api/meetings/:id/send-checkin", async (req, res) => {
  const m = db.getMeeting(req.params.id);
  if (!m) return res.status(404).json({ error: "meeting not found" });
  const r = await sendCheckin(m);
  res.json({ ok: true, ...r, recipients: m.roster.length });
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

// Per-participant monthly performance (resets each month; pick any month).
app.get("/api/my-meetings/summary", (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
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
    location: s.location, host: s.host, topics: s.topics, attachments: s.attachments || [], roster: recipients,
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

  if (value === "yes") {
    if (sid) {
      db.setStanding(sid, name, "yes"); // default: attend all future occurrences
      // clear any explicit override on this date so it follows the default again
      const mId = meetingId || (occKey ? `${sid}__${occKey}` : null);
      if (mId && db.getMeeting(mId)) { const p = db.addParticipant(mId, { name }); if (p) db.setRsvp(mId, p.id, null); }
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
  const { name, employeeId, email, jobTitle } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "name is required" });
  if (!String(employeeId || "").trim()) return res.status(400).json({ error: "employeeId is required" });
  if (!String(email || "").trim()) return res.status(400).json({ error: "email is required" });
  if (!String(jobTitle || "").trim()) return res.status(400).json({ error: "jobTitle is required" });
  res.json(db.registerMember(req.params.userId, { name, employeeId, email, jobTitle }));
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
  const recipients = s.recipientIds?.length
    ? s.roster.filter((p) => s.recipientIds.includes(p.id))
    : s.roster;

  // Materialise the occurrence's meeting once; reuse it on later sends (so a
  // second lead-time broadcast doesn't reset participants' responses).
  const meetingId = `${s.id}__${occKey}`;
  const meeting = db.getMeeting(meetingId) || db.createMeeting({
    id: meetingId,
    title: s.title,
    date: occKey,
    startTime: s.startTime,
    endTime: s.endTime,
    location: s.location,
    host: s.host,
    topics: s.topics,
    attachments: s.attachments || [],
    roster: recipients,
  });
  db.applyStanding(meeting.id, s.id); // reflect standing confirmations on this instance

  // Only registered recipients (bound to a real LINE userId) receive the notice.
  // Unregistered / unbound people get nothing — never a broadcast to all.
  const ids = recipients.map((p) => p.lineUserId).filter((id) => /^U[0-9a-f]{32}$/.test(id || ""));
  let mode = "skipped", count = 0;
  if (live && LINE_CONFIGURED) {
    if (ids.length) {
      try { await multicast(ids, [buildNoticeMessage(meeting, BASE_URL)]); mode = "multicast"; count = ids.length; }
      catch (e) { mode = "error"; meeting._sendError = e.message; }
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

  const events = [];
  for (const m of db.listMeetings()) {
    if (!m.date) continue;
    const ms = Date.parse(`${m.date}T00:00:00`);
    if (ms >= fromMs && ms <= toMs) {
      events.push({ type: "meeting", id: m.id, date: m.date, title: m.title, startTime: m.startTime, endTime: m.endTime, location: m.location, count: m.roster.length });
    }
  }
  for (const s of db.listSchedules()) {
    if (!s.enabled) continue;
    for (const occ of db.occurrencesInRange(s, fromMs, toMs)) {
      const occKey = db.ymd(occ);
      if (db.getMeeting(`${s.id}__${occKey}`)) continue; // already materialised → shown as a meeting
      events.push({ type: "scheduled", scheduleId: s.id, occKey, date: occKey, title: s.title, startTime: s.startTime, endTime: s.endTime, location: s.location, count: s.recipientIds?.length || s.roster.length });
    }
  }
  res.json(events);
});

// Materialise a schedule occurrence into a meeting (no send) so its host
// dashboard can be opened from the calendar.
app.post("/api/schedules/:id/materialize", (req, res) => {
  const s = db.getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: "schedule not found" });
  const occKey = String(req.body?.occKey || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occKey)) return res.status(400).json({ error: "occKey (YYYY-MM-DD) required" });
  const meetingId = `${s.id}__${occKey}`;
  let m = db.getMeeting(meetingId);
  if (!m) {
    const recipients = s.recipientIds?.length ? s.roster.filter((p) => s.recipientIds.includes(p.id)) : s.roster;
    m = db.createMeeting({
      id: meetingId, title: s.title, date: occKey, startTime: s.startTime, endTime: s.endTime,
      location: s.location, host: s.host, topics: s.topics, attachments: s.attachments || [], roster: recipients,
    });
  }
  db.applyStanding(m.id, s.id);
  res.json(m);
});

app.get("/api/schedules", (_req, res) => res.json(db.listSchedules()));

app.post("/api/schedules", (req, res) => {
  if (!String(req.body?.title || "").trim()) return res.status(400).json({ error: "title is required" });
  const { startTime, endTime } = req.body || {};
  if (endTime && startTime && startTime >= endTime) {
    return res.status(400).json({ error: "start time must be before end time" });
  }
  res.status(201).json(db.decorateSchedule(db.createSchedule(req.body), Date.now()));
});

app.patch("/api/schedules/:id", (req, res) => {
  const s = db.updateSchedule(req.params.id, req.body || {});
  if (!s) return res.status(404).json({ error: "schedule not found" });
  res.json(s);
});

app.delete("/api/schedules/:id", (req, res) => {
  db.deleteSchedule(req.params.id);
  res.status(204).end();
});

// Test-fire now (explicit admin action — always sends if LINE configured).
app.post("/api/schedules/:id/run-now", async (req, res) => {
  const s = db.getSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: "schedule not found" });
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
  for (const real of db.listSchedules().map((s) => db.getSchedule(s.id)).filter(Boolean)) {
    if (!real.enabled) continue;

    // Check-in: when an occurrence has just started, send the check-in button
    // once. Computed FIRST and independently of future occurrences, so one-time
    // meetings (no "next" occurrence after they start) still trigger.
    const recent = db.occurrencesInRange(real, now - CHECKIN_WINDOW_MS, now);
    const started = recent.length ? recent[recent.length - 1] : null;
    if (started) {
      const ck = `${db.ymd(started)}@checkin`;
      if (!real.fired[ck]) {
        real.fired[ck] = true;
        if (AUTOSEND) {
          const meeting = materializeOccurrence(real.id, db.ymd(started));
          const r = meeting ? await sendCheckin(meeting) : { pushed: 0 };
          console.log(`[scheduler] check-in sent "${real.title}" ${db.ymd(started)} → ${r.pushed} pushed`);
        }
      }
    }

    // Lead-time notices: need the next upcoming occurrence.
    const occ = db.nextOccurrence(real, now);
    if (!occ) continue;
    const occKey = db.ymd(occ);
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
});
