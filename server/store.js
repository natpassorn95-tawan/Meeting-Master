// ── Store for Meeting Master (demo backend) ───────────────────────────
// Holds meetings (with agenda topics + a participant roster) and each
// participant's response (RSVP / leave / agenda-read / pre-filled comments).
// Persisted to data/store.json so it survives server restarts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEAVE_TYPES = ["出差", "時間衝突", "個人事由", "其他"];
const STANCES = ["none", "comment", "question"]; // 無意見 / 有意見 / 提問

let seq = 0;
const uid = (p) => `${p}${(Date.now() + seq++).toString(36)}`;

// Format structured date/time parts into the display string, e.g.
// ("2026-07-03","14:00","15:30") → "2026/07/03 (四) 14:00–15:30".
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
function fmtDatetime(date, start, end) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const dateStr = `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")} (${wd})`;
  const time = start ? (end ? `${start}–${end}` : start) : "";
  return time ? `${dateStr} ${time}` : dateStr;
}

const store = { meetings: {}, order: [], schedules: {}, scheduleOrder: [], members: {}, standing: {}, deleted: {}, cancelled: {}, tombstones: {} };

// ── Persistence (data/store.json) ──────────────────────────────────────
// MM_DATA_FILE relocates the store (tests point it at a temp dir; an operator
// can point it at a different disk). Defaults to data/store.json beside the app.
const DATA_FILE = process.env.MM_DATA_FILE
  ? path.resolve(process.env.MM_DATA_FILE)
  : fileURLToPath(new URL("../data/store.json", import.meta.url));
// Previous good copy, rotated on every save. A crash mid-save can at worst lose
// the last write, never the whole dataset — loadStore() falls back to this.
const BACKUP_FILE = `${DATA_FILE}.bak`;
const TEMP_FILE = `${DATA_FILE}.tmp`;
let saveTimer = null;

// Atomic save: serialise → temp file → fsync → swap into place by rename.
// Writing straight to DATA_FILE (as this used to) meant a crash or power cut
// part-way through could truncate the ONLY copy of the data.
function saveStore() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const json = JSON.stringify({
      meetings: store.meetings, order: store.order,
      schedules: store.schedules, scheduleOrder: store.scheduleOrder,
      members: store.members, standing: store.standing, deleted: store.deleted, cancelled: store.cancelled, tombstones: store.tombstones, seq,
    });
    // Force the bytes to disk before the rename, so the swap can never publish
    // a file whose contents are still sitting in the OS write cache.
    const fd = fs.openSync(TEMP_FILE, "w");
    try {
      fs.writeFileSync(fd, json);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    // Keep the outgoing version as .bak, then publish the new one. Both renames
    // are atomic, so a reader never sees a half-written file.
    if (fs.existsSync(DATA_FILE)) fs.renameSync(DATA_FILE, BACKUP_FILE);
    fs.renameSync(TEMP_FILE, DATA_FILE);
  } catch (e) { console.error("[store] save failed", e.message); }
}
// Debounced save — call after any mutation.
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveStore(); }, 400);
}
function loadStore() {
  // Prefer the live file; fall back to the rotated .bak if it is missing or
  // unparseable (interrupted save, disk full, bad copy). Silently starting
  // empty on a corrupt file is how a whole dataset disappears unnoticed.
  for (const file of [DATA_FILE, BACKUP_FILE]) {
    if (!fs.existsSync(file)) continue;
    try {
      readStoreFile(file);
      if (file === BACKUP_FILE) console.warn(`[store] ⚠ recovered from ${path.basename(BACKUP_FILE)} — ${path.basename(DATA_FILE)} was missing or corrupt`);
      return;
    } catch (e) {
      console.error(`[store] load failed from ${path.basename(file)}: ${e.message}`);
      // Keep the bad file for forensics instead of letting the next save
      // overwrite it — an operator can still hand-repair the JSON.
      if (file === DATA_FILE) {
        try { fs.copyFileSync(file, `${DATA_FILE}.corrupt`); } catch { /* best effort */ }
      }
    }
  }
  console.warn("[store] no readable store found — starting fresh");
}

// Throws on a missing/corrupt file so loadStore() can try the next candidate.
function readStoreFile(file) {
  {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    store.meetings = d.meetings || {};
    store.order = d.order || [];
    store.schedules = d.schedules || {};
    store.scheduleOrder = d.scheduleOrder || [];
    store.members = d.members || {};
    store.standing = d.standing || {};
    store.deleted = d.deleted || {};
    store.cancelled = d.cancelled || {};
    store.tombstones = d.tombstones || {};
    if (typeof d.seq === "number") seq = d.seq;
    console.log(`[store] loaded ${store.order.length} meetings, ${store.scheduleOrder.length} schedules, ${Object.keys(store.members).length} members`);
  }
}

// ── Standing (default) attendance per recurring schedule ────────────────
// standing[scheduleId][name] = "yes". A participant's default intention for a
// recurring meeting; individual dates can override it (e.g. leave for one day).
function scheduleIdOf(meetingId) {
  return meetingId && meetingId.includes("__") ? meetingId.slice(0, meetingId.indexOf("__")) : null;
}
function getStanding(scheduleId, name) {
  return store.standing[scheduleId]?.[name] || null;
}
function setStanding(scheduleId, name, value) {
  if (!scheduleId || !name) return;
  const map = (store.standing[scheduleId] ||= {});
  if (value) map[name] = value; else delete map[name];
}
// Seed a materialised instance's blank responses from the schedule's standing
// defaults (explicit per-date choices are left untouched). Keeps the Host view
// aligned with what participants see in "My Meetings".
function applyStanding(meetingId, scheduleId) {
  const m = getMeeting(meetingId);
  if (!m || !scheduleId) return;
  const st = store.standing[scheduleId] || {};
  for (const p of m.roster) {
    const r = m.responses[p.id];
    if (r && !r.rsvp && st[p.name] === "yes") r.rsvp = "yes";
  }
}

// ── Members (LINE OA followers) ─────────────────────────────────────────
// The first time someone adds the OA (a `follow` webhook event) we create a
// "pending" member and ask them to register Name / Employee ID / Email.
function getMember(userId) {
  return store.members[userId] || null;
}
function upsertPendingMember(userId) {
  if (!store.members[userId]) {
    store.members[userId] = {
      lineUserId: userId, name: "", employeeId: "", email: "", jobTitle: "", department: "",
      status: "pending", active: true, createdAt: Date.now(), registeredAt: null,
    };
  }
  return store.members[userId];
}
function registerMember(userId, { name, employeeId, email, jobTitle, department }) {
  const m = upsertPendingMember(userId);
  m.name = (name || "").trim();
  m.employeeId = (employeeId || "").trim();
  m.email = (email || "").trim();
  m.jobTitle = (jobTitle || "").trim();
  m.department = (department || "").trim();
  m.status = "registered";
  m.registeredAt = Date.now();
  if (m.name) linkLineUser(m.name, userId); // bind userId onto matching roster entries
  return m;
}
function listMembers() {
  return Object.values(store.members).sort((a, b) => b.createdAt - a.createdAt);
}
function deleteMember(userId) {
  delete store.members[userId];
}
// Mark an employee active (still with the company) or inactive (left / suspended).
// Inactive members are kept for history but excluded from new meeting recipients.
function setMemberActive(userId, active) {
  const m = store.members[userId];
  if (!m) return null;
  m.active = !!active;
  return m;
}

function blankResponse(p) {
  return {
    participantId: p.id,
    name: p.name,
    dept: p.dept,
    lineUserId: p.lineUserId || null,
    rsvp: null, // "yes" | "leave"
    leaveReason: null, // { type, text }
    agendaReadAt: null,
    checkinSentAt: null, // when the check-in button was pushed to them (dedupe)
    checkedInAt: null, // timestamp when they checked in at meeting start
    checkedOutAt: null, // timestamp when they checked out (until end + 1h)
    comments: {}, // { [topicId]: { stance, text, at } }
    updatedAt: null,
  };
}

function createMeeting(input) {
  const id = input.id || uid("M");
  const roster = (input.roster || []).map((r) => ({
    id: r.id || uid("P"),
    name: r.name,
    dept: r.dept || "—",
    lineUserId: r.lineUserId || null,
  }));
  const topics = (input.topics || []).map((t, i) => ({
    id: t.id || uid("T"),
    order: i + 1,
    title: t.title,
    description: t.description || "",
  }));
  const date = input.date || "";
  const startTime = input.startTime || "";
  const endTime = input.endTime || "";
  const meeting = {
    id,
    title: input.title || "（未命名會議）",
    date,
    startTime,
    endTime,
    // derive the display string from parts when present, else keep any literal
    datetime: (date ? fmtDatetime(date, startTime, endTime) : input.datetime) || "",
    location: input.location || "",
    onlineUrl: normalizeUrl(input.onlineUrl), // optional video-call link (online / hybrid meetings)
    host: input.host || "",
    agendaUrl: input.agendaUrl || "",
    // Access control: public (default, everyone) or private (creator + invited).
    visibility: input.visibility === "private" ? "private" : "public",
    creatorId: input.creatorId || null,
    topics,
    attachments: input.attachments || [], // [{ url, name, type, size }]
    roster,
    responses: Object.fromEntries(roster.map((p) => [p.id, blankResponse(p)])),
    createdAt: Date.now(),
  };
  store.meetings[id] = meeting;
  if (!store.order.includes(id)) store.order.unshift(id);
  delete store.deleted[id]; delete store.cancelled[id]; delete store.tombstones[id]; // recreating supersedes any trashed/cancelled/tombstoned copy
  return meeting;
}

function getMeeting(id) {
  return store.meetings[id] || null;
}

// Normalize a user-typed meeting link into a clickable https URL (or "").
// A bare "meet.google.com/x" becomes "https://meet.google.com/x"; blanks stay
// blank. Keeps LINE's URI actions valid (they require an http/https scheme).
function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

// Update meeting basics without touching topics / roster / responses.
function updateMeetingMeta(id, patch) {
  const m = getMeeting(id);
  if (!m) return null;
  for (const k of ["title", "location", "host", "date", "startTime", "endTime"]) {
    if (patch[k] != null) m[k] = patch[k];
  }
  if (patch.onlineUrl != null) m.onlineUrl = normalizeUrl(patch.onlineUrl);
  if (patch.visibility === "public" || patch.visibility === "private") m.visibility = patch.visibility;
  if (Array.isArray(patch.attachments)) m.attachments = patch.attachments;
  m.datetime = m.date ? fmtDatetime(m.date, m.startTime, m.endTime) : (patch.datetime ?? m.datetime);
  return m;
}

// Replace the agenda topics. Existing topic ids are kept (so pre-filled
// comments survive); new ones get fresh ids; order follows array order.
function setTopics(id, topics) {
  const m = getMeeting(id);
  if (!m) return null;
  // Same trap as setRoster: the editor re-sends topics as plain { title }, and
  // pre-filled comments are keyed by topic id — minting new ids orphaned every
  // comment. Reuse the existing topic's id when the title is unchanged.
  const claimed = new Set();
  const matchExisting = (t) => {
    const title = (t.title || "").trim();
    const candidates = [t.id && m.topics.find((x) => x.id === t.id), m.topics.find((x) => x.title === title)];
    return candidates.find((x) => x && !claimed.has(x.id)) || null;
  };
  m.topics = (topics || [])
    .filter((t) => (t.title || "").trim())
    .map((t, i) => {
      const prev = matchExisting(t);
      if (prev) claimed.add(prev.id);
      return {
        id: prev?.id || t.id || uid("T"),
        order: i + 1,
        title: (t.title || "").trim(),
        description: t.description || prev?.description || "",
      };
    });
  return m;
}

// Replace the roster, reconciling responses: kept participants retain their
// response, new ones get a blank, removed ones are dropped.
function setRoster(id, roster) {
  const m = getMeeting(id);
  if (!m) return null;
  // The meeting editor re-sends the roster as plain { name, dept, lineUserId }
  // with no participant ids (Schedules.jsx CreateForm). Keying only on `id`
  // therefore minted a fresh id for everyone and silently discarded every RSVP,
  // leave reason, agenda-read flag, check-in/out and pre-filled comment — so
  // simply correcting a meeting's time wiped the responses it had collected.
  // Match on whatever identity the caller does supply: id, then lineUserId,
  // then name. Each existing participant can only be claimed once.
  const claimed = new Set();
  const matchExisting = (r) => {
    const name = (r.name || "").trim();
    const candidates = [
      r.id && m.roster.find((p) => p.id === r.id),
      r.lineUserId && m.roster.find((p) => p.lineUserId === r.lineUserId),
      m.roster.find((p) => p.name === name),
    ];
    return candidates.find((p) => p && !claimed.has(p.id)) || null;
  };
  const next = (roster || [])
    .filter((r) => (r.name || "").trim())
    .map((r) => {
      const prev = matchExisting(r);
      if (prev) claimed.add(prev.id);
      return {
        id: prev?.id || r.id || uid("P"),
        name: (r.name || "").trim(),
        dept: r.dept || prev?.dept || "—",
        // Preserve details the editor never sends back rather than nulling them.
        employeeId: r.employeeId || prev?.employeeId || "",
        lineUserId: r.lineUserId || prev?.lineUserId || null,
      };
    });
  const responses = {};
  for (const p of next) {
    const existing = m.responses[p.id] || blankResponse(p);
    existing.name = p.name;
    existing.dept = p.dept;
    existing.lineUserId = p.lineUserId;
    responses[p.id] = existing;
  }
  m.roster = next;
  m.responses = responses;
  return m;
}

// Add one participant if not already present (matched by name). Returns the
// participant. Used to auto-enroll a registered member so the buttons know them.
function addParticipant(meetingId, { name, dept, employeeId, lineUserId }) {
  const m = getMeeting(meetingId);
  if (!m) return null;
  const nm = (name || "").trim();
  if (!nm) return null;
  let p = m.roster.find((x) => x.name === nm);
  if (!p) {
    p = { id: uid("P"), name: nm, dept: dept || "—", employeeId: employeeId || "", lineUserId: lineUserId || null };
    m.roster.push(p);
    m.responses[p.id] = blankResponse(p);
  }
  return p;
}

function listMeetings() {
  return store.order.map((id) => store.meetings[id]).filter(Boolean);
}

// Add someone to a schedule's invite list (recipientIds + roster) so the invite
// applies to visibility and future occurrences, not just the current instance.
function addScheduleInvitee(scheduleId, member) {
  const s = store.schedules[scheduleId];
  if (!s || !member?.lineUserId) return;
  s.recipientIds = s.recipientIds || [];
  if (!s.recipientIds.includes(member.lineUserId)) s.recipientIds.push(member.lineUserId);
  s.roster = s.roster || [];
  if (!s.roster.some((p) => p.lineUserId === member.lineUserId || p.id === member.lineUserId)) {
    s.roster.push({ id: member.lineUserId, name: member.name, dept: member.dept || "—", lineUserId: member.lineUserId });
  }
}

function getResponse(meetingId, participantId) {
  const m = getMeeting(meetingId);
  if (!m) return null;
  return m.responses[participantId] || null;
}

function setRsvp(meetingId, participantId, value, leaveReason) {
  const r = getResponse(meetingId, participantId);
  if (!r) return null;
  r.rsvp = value || null; // "yes" | "leave" | null (clear → inherit standing default)
  r.leaveReason = value === "leave" ? leaveReason || { type: "其他", text: "" } : null;
  r.updatedAt = Date.now();
  return r;
}

function checkIn(meetingId, participantId) {
  const r = getResponse(meetingId, participantId);
  if (!r) return null;
  if (!r.checkedInAt) r.checkedInAt = Date.now(); // first check-in wins
  r.updatedAt = Date.now();
  return r;
}

function checkOut(meetingId, participantId) {
  const r = getResponse(meetingId, participantId);
  if (!r) return null;
  if (!r.checkedOutAt) r.checkedOutAt = Date.now(); // first check-out wins
  r.updatedAt = Date.now();
  return r;
}

function markAgendaRead(meetingId, participantId) {
  const r = getResponse(meetingId, participantId);
  if (!r) return null;
  if (!r.agendaReadAt) r.agendaReadAt = Date.now();
  r.updatedAt = Date.now();
  return r;
}

function setComment(meetingId, participantId, topicId, stance, text) {
  const m = getMeeting(meetingId);
  const r = getResponse(meetingId, participantId);
  if (!m || !r) return null;
  if (!m.topics.some((t) => t.id === topicId)) return null;
  r.comments[topicId] = {
    stance: STANCES.includes(stance) ? stance : "none",
    text: text || "",
    at: Date.now(),
  };
  r.updatedAt = Date.now();
  return r;
}

// Map an inbound LINE userId to a roster participant (best-effort; demo).
function linkLineUser(name, lineUserId) {
  for (const m of listMeetings()) {
    for (const p of m.roster) {
      if (p.name === name) {
        p.lineUserId = lineUserId;
        if (m.responses[p.id]) m.responses[p.id].lineUserId = lineUserId;
      }
    }
  }
}

// ── Recurring schedules ────────────────────────────────────────────────
// A schedule is a meeting template + recurrence rule + selected recipients.
// The scheduler (server/index.js) materialises a meeting and auto-sends the
// LINE notice ahead of each occurrence.

const ORDINALS = { 1: "第一個", 2: "第二個", 3: "第三個", 4: "第四個", 5: "最後一個" };
const LEAD_LABELS = { 15: "15 分鐘前", 60: "1 小時前", 1440: "1 天前", 4320: "3 天前", 10080: "1 週前" };

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// nth (1-4) or 5 = last occurrence of `weekday` in a given month.
function nthWeekdayOfMonth(year, month, weekday, nth) {
  if (nth === 5) {
    const last = new Date(year, month + 1, 0).getDate();
    for (let d = last; d >= 1; d--) {
      const dt = new Date(year, month, d);
      if (dt.getDay() === weekday) return dt;
    }
    return null;
  }
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === weekday && ++count === nth) return dt;
  }
  return null;
}

// Next meeting-start Date strictly after `from` (ms epoch), bounded by the
// schedule's optional period [startDate, endDate]. null if none.
function nextOccurrence(schedule, from) {
  const { recurrence, startTime, startDate, endDate } = schedule;
  const [h, mn] = (startTime || "00:00").split(":").map(Number);
  // Floor the search at the period start; ceiling at the period end.
  let fromMs = from;
  if (startDate) {
    const s = Date.parse(`${startDate}T00:00:00`) - 1;
    if (s > fromMs) fromMs = s;
  }
  const endMs = endDate ? Date.parse(`${endDate}T23:59:59`) : Infinity;
  const f = new Date(fromMs);
  let occ = null;

  if (recurrence.freq === "once") {
    if (!recurrence.date) return null;
    const [y, mo, d] = recurrence.date.split("-").map(Number);
    if (!y || !mo || !d) return null;
    const cand = new Date(y, mo - 1, d, h, mn);
    occ = cand.getTime() > fromMs ? cand : null;
  } else if (recurrence.freq === "weekly") {
    for (let i = 0; i < 14; i++) {
      const cand = new Date(f.getFullYear(), f.getMonth(), f.getDate() + i, h, mn);
      if (cand.getDay() === recurrence.weekday && cand.getTime() > fromMs) { occ = cand; break; }
    }
  } else if (recurrence.freq === "monthly") {
    for (let m = 0; m < 4; m++) {
      const dt = nthWeekdayOfMonth(f.getFullYear(), f.getMonth() + m, recurrence.weekday, recurrence.nth || 1);
      if (dt) {
        const cand = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), h, mn);
        if (cand.getTime() > fromMs) { occ = cand; break; }
      }
    }
  }
  if (occ && occ.getTime() > endMs) return null; // past the period end
  return occ;
}

// All occurrences of a schedule within [fromMs, toMs] (inclusive), bounded.
function occurrencesInRange(s, fromMs, toMs) {
  const out = [];
  let cursor = fromMs - 1; // include an occurrence exactly at fromMs
  for (let i = 0; i < 120 && out.length < 120; i++) {
    const occ = nextOccurrence(s, cursor);
    if (!occ || occ.getTime() > toMs) break;
    out.push(occ);
    cursor = occ.getTime();
  }
  return out;
}

function recurrenceSummary(s) {
  if (s.recurrence.freq === "once") return `單次 ${s.recurrence.date || ""} ${s.startTime}`.trim();
  const wd = WEEKDAYS[s.recurrence.weekday];
  if (s.recurrence.freq === "weekly") return `每週${wd} ${s.startTime}`;
  return `每月${ORDINALS[s.recurrence.nth || 1]}週${wd} ${s.startTime}`;
}

// Normalize a lead-times input (array or single) into a sorted, deduped array
// of positive minutes. Defaults to [15].
function normalizeLeads(input) {
  const arr = Array.isArray(input) ? input : (input != null ? [input] : []);
  const xs = arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const uniq = [...new Set(xs)].sort((a, b) => b - a);
  return uniq.length ? uniq : [15];
}

// The soonest future send across the next few occurrences (any lead time).
function nextSendInfo(s, now) {
  let from = now;
  for (let i = 0; i < 4; i++) {
    const occ = nextOccurrence(s, from);
    if (!occ) break;
    const sends = s.leads.map((l) => occ.getTime() - l * 60000).filter((tms) => tms > now);
    if (sends.length) return { occ, sendAt: Math.min(...sends) };
    from = occ.getTime();
  }
  return { occ: nextOccurrence(s, now), sendAt: null };
}

// Decorate a schedule with derived display fields for the API.
function decorateSchedule(s, now) {
  const occ = nextOccurrence(s, now);
  const { sendAt } = nextSendInfo(s, now);
  return {
    ...s,
    recurrenceText: recurrenceSummary(s),
    leadText: s.leads.map((l) => LEAD_LABELS[l] || `${l} 分鐘前`).join("、"),
    nextOccurrenceAt: occ ? occ.getTime() : null,
    nextOccurrenceText: occ ? fmtDatetime(ymd(occ), s.startTime, s.endTime) : null,
    nextSendAt: sendAt,
  };
}

function createSchedule(input) {
  const id = input.id || uid("S");
  const now = Date.now();
  const s = {
    id,
    title: input.title || "（未命名定期會議）",
    location: input.location || "",
    onlineUrl: normalizeUrl(input.onlineUrl), // optional video-call link (online / hybrid meetings)
    host: input.host || "",
    startTime: input.startTime || "14:00",
    endTime: input.endTime || "",
    recurrence: {
      freq: ["weekly", "monthly", "once"].includes(input.recurrence?.freq) ? input.recurrence.freq : "weekly",
      weekday: Number.isInteger(input.recurrence?.weekday) ? input.recurrence.weekday : 5,
      nth: input.recurrence?.nth || 1,
      date: input.recurrence?.date || "", // used when freq === "once"
    },
    startDate: input.startDate || "", // optional period bounds for weekly/monthly
    endDate: input.endDate || "",
    // One or more lead times (minutes before). Default: broadcast 15 min before.
    leads: normalizeLeads(input.leads != null ? input.leads : input.leadMinutes),
    attachments: input.attachments || [], // [{ url, name, type, size }]
    topics: (input.topics || []).map((t) => ({ title: typeof t === "string" ? t : t.title })).filter((t) => t.title),
    roster: (input.roster || []).map((r) => ({
      id: r.id || uid("P"), name: r.name, dept: r.dept || "—", lineUserId: r.lineUserId || null,
    })),
    recipientIds: input.recipientIds || [],
    // Access control: public (everyone) or private (creator + invited recipients).
    visibility: input.visibility === "private" ? "private" : "public",
    creatorId: input.creatorId || null,
    enabled: input.enabled !== false,
    fired: {}, // dedupe map keyed by `${occurrenceKey}@${lead}`
    createdAt: now,
  };
  // Don't back-fire sends whose window already passed at creation.
  const occ = nextOccurrence(s, now);
  if (occ) {
    for (const lead of s.leads) {
      if (occ.getTime() - lead * 60000 <= now) s.fired[`${ymd(occ)}@${lead}`] = true;
    }
  }
  store.schedules[id] = s;
  if (!store.scheduleOrder.includes(id)) store.scheduleOrder.unshift(id);
  return s;
}

function listSchedules() {
  const now = Date.now();
  return store.scheduleOrder.map((id) => store.schedules[id]).filter(Boolean).map((s) => decorateSchedule(s, now));
}
function getSchedule(id) { return store.schedules[id] || null; }
function updateSchedule(id, patch) {
  const s = store.schedules[id];
  if (!s) return null;
  Object.assign(s, patch);
  return decorateSchedule(s, Date.now());
}
function deleteSchedule(id) {
  delete store.schedules[id];
  store.scheduleOrder = store.scheduleOrder.filter((x) => x !== id);
  // Cascade: move every materialised occurrence of this schedule to the trash
  // so it leaves the Host calendar but can still be restored. Drop standing too.
  let removed = 0;
  for (const mid of Object.keys(store.meetings)) {
    if (scheduleIdOf(mid) === id) { trashMeeting(mid); removed++; }
  }
  delete store.standing[id];
  return removed;
}

// ── Soft delete (trash) ────────────────────────────────────────────────
// Trashed meetings move out of meetings/order into store.deleted (keyed by id)
// with a deletedAt stamp, so the Host "Deleted" folder can list/restore them.
function trashMeeting(id) {
  const m = store.meetings[id];
  if (!m) return null;
  m.deletedAt = Date.now();
  store.deleted[id] = m;
  delete store.meetings[id];
  store.order = store.order.filter((x) => x !== id);
  return m;
}
function restoreMeeting(id) {
  const m = store.deleted[id];
  if (!m) return null;
  delete m.deletedAt;
  store.meetings[id] = m;
  if (!store.order.includes(id)) store.order.unshift(id);
  delete store.deleted[id];
  delete store.tombstones[id];
  return m;
}
function purgeMeeting(id) {
  if (!store.deleted[id]) return false;
  delete store.deleted[id];
  tombstone(id);
  return true;
}
function listDeleted() {
  return Object.values(store.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

// ── Cancelled (host cancelled the meeting) ─────────────────────────────
// Separate bucket from deleted: populated by the Cancel-meeting action, shown
// in the Host page "Cancelled meetings" folder (also restorable).
function cancelMeeting(id) {
  const m = store.meetings[id];
  if (!m) return null;
  m.cancelledAt = Date.now();
  store.cancelled[id] = m;
  delete store.meetings[id];
  store.order = store.order.filter((x) => x !== id);
  return m;
}
function restoreCancelled(id) {
  const m = store.cancelled[id];
  if (!m) return null;
  delete m.cancelledAt;
  store.meetings[id] = m;
  if (!store.order.includes(id)) store.order.unshift(id);
  delete store.cancelled[id];
  delete store.tombstones[id];
  return m;
}
function purgeCancelled(id) {
  if (!store.cancelled[id]) return false;
  delete store.cancelled[id];
  tombstone(id);
  return true;
}
function listCancelled() {
  return Object.values(store.cancelled).sort((a, b) => (b.cancelledAt || 0) - (a.cancelledAt || 0));
}

// ── Auto-purge of removed meetings ─────────────────────────────────────
// Removed (cancelled or deleted) meetings sit in a trash bucket until restored.
// If nobody acts on one for longer than REMOVED_TTL_MS (10 days from the moment
// it was removed), it is permanently purged (tombstoned). Restoring clears the
// stamp — the item leaves the bucket — so the 10-day clock only runs while it
// stays removed. Called from the scheduler tick.
const REMOVED_TTL_MS = 10 * 24 * 60 * 60 * 1000; // 10 days
function purgeExpiredRemoved(now = Date.now(), maxAgeMs = REMOVED_TTL_MS) {
  const purged = [];
  for (const [id, m] of Object.entries(store.deleted)) {
    if (m.deletedAt && now - m.deletedAt > maxAgeMs) { delete store.deleted[id]; tombstone(id); purged.push(id); }
  }
  for (const [id, m] of Object.entries(store.cancelled)) {
    if (m.cancelledAt && now - m.cancelledAt > maxAgeMs) { delete store.cancelled[id]; tombstone(id); purged.push(id); }
  }
  return purged;
}

// ── Tombstones ─────────────────────────────────────────────────────────
// Permanently deleting a schedule occurrence leaves a tombstone so the still-
// enabled schedule never re-projects (resurrects) that occurrence again. Only
// occurrence ids (schedule__date) are tombstoned; standalone meetings can't be
// re-projected, so there's nothing to suppress.
function tombstone(id) {
  if (scheduleIdOf(id)) store.tombstones[id] = true;
}
function isTombstoned(id) {
  return !!store.tombstones[id];
}

// In a trash bucket or tombstoned → don't re-project this occurrence.
function isTrashed(id) {
  return !!store.deleted[id] || !!store.cancelled[id] || !!store.tombstones[id];
}

export { ymd, nextOccurrence, occurrencesInRange, recurrenceSummary, decorateSchedule, createSchedule, listSchedules, getSchedule, updateSchedule, deleteSchedule, trashMeeting, restoreMeeting, purgeMeeting, listDeleted, cancelMeeting, restoreCancelled, purgeCancelled, listCancelled, purgeExpiredRemoved, REMOVED_TTL_MS, isTrashed, isTombstoned };

// A participant's meetings (by name). One row per schedule = the NEAREST
// upcoming occurrence (weekly/monthly collapse to a single row); one-time
// meetings show their single date. Plus any standalone meetings they're on.
// A materialised occurrence snapshots the schedule's attachments at the moment
// it is created, so a file the creator adds to the schedule AFTERWARDS never
// reaches a participant who opens that occurrence directly. memberUpcoming()
// already falls back to the schedule for My Meetings; this gives the single
// meeting read the same behaviour, so the file shows on both screens.
// Attachments only — topics deliberately do NOT fall back here, because the
// agenda comment form is keyed by topic id and schedule topics carry no ids.
function withScheduleAttachments(m) {
  if (!m || m.attachments?.length) return m;
  const s = store.schedules[scheduleIdOf(m.id) || ""];
  if (!s?.attachments?.length) return m;
  return { ...m, attachments: s.attachments };
}

function memberUpcoming(name, fromMs, toMs) {
  const out = [];
  const seenSchedules = new Set();

  for (const s of Object.values(store.schedules)) {
    if (!s.enabled) continue;
    const rec = s.recipientIds?.length ? s.roster.filter((p) => s.recipientIds.includes(p.id)) : s.roster;
    if (!rec.some((p) => p.name === name)) continue;
    seenSchedules.add(s.id);
    const occ = nextOccurrence(s, fromMs - 1); // nearest occurrence at/after fromMs
    if (!occ || occ.getTime() > toMs) continue;
    const occKey = ymd(occ);
    const occId = `${s.id}__${occKey}`;
    if (store.tombstones[occId]) continue; // permanently deleted → hidden (matches the calendar)
    const active = getMeeting(occId);
    // Reflect cancel/delete status so My Meetings stays aligned with the calendar.
    const status = store.cancelled[occId] ? "cancelled" : store.deleted[occId] ? "deleted" : null;
    const inst = active || store.cancelled[occId] || store.deleted[occId] || null;
    let rsvp = getStanding(s.id, name);
    let leaveReason = null;
    let checkedInAt = null;
    let checkedOutAt = null;
    if (inst) { // explicit per-date choice on the materialised instance wins
      const p = inst.roster.find((r) => r.name === name);
      const r = p ? inst.responses[p.id] : null;
      if (r?.rsvp) { rsvp = r.rsvp; leaveReason = r.rsvp === "leave" ? r.leaveReason : null; }
      checkedInAt = r?.checkedInAt || null;
      checkedOutAt = r?.checkedOutAt || null;
    }
    const tsrc = (inst?.topics?.length ? inst.topics : s.topics) || [];
    const topics = tsrc.map((tp) => ({ title: tp.title || "", description: tp.description || "" })).filter((tp) => tp.title);
    const attachments = (inst?.attachments?.length ? inst.attachments : s.attachments) || [];
    // Once an occurrence has been materialised it becomes the source of truth
    // for its own details: the creator edits THAT record when a meeting runs
    // late or moves. Reading title/time off the schedule meant those edits
    // never reached 我的會議, so participants kept seeing the original slot.
    // `occKey` still identifies the occurrence — only the display date follows
    // the edit.
    out.push({
      kind: status || (active ? "meeting" : "scheduled"), status,
      scheduleId: s.id, occKey, meetingId: active?.id,
      date: inst?.date || occKey,
      title: inst?.title || s.title,
      startTime: inst?.startTime || s.startTime,
      endTime: inst?.endTime || s.endTime,
      location: inst?.location || s.location || "",
      onlineUrl: inst?.onlineUrl || s.onlineUrl || "",
      recurring: s.recurrence.freq !== "once", rsvp, leaveReason, checkedInAt, checkedOutAt, topics, attachments,
    });
  }

  // Standalone meetings (not generated by a schedule) they're a roster member of.
  for (const m of listMeetings()) {
    if (!m.date) continue;
    if (scheduleIdOf(m.id) && seenSchedules.has(scheduleIdOf(m.id))) continue; // covered above
    const ms = Date.parse(`${m.date}T00:00:00`);
    if (ms < fromMs || ms > toMs) continue;
    const p = m.roster.find((r) => r.name === name);
    if (!p) continue;
    const r = m.responses[p.id];
    const topics = (m.topics || []).map((tp) => ({ title: tp.title || "", description: tp.description || "" })).filter((tp) => tp.title);
    out.push({ kind: "meeting", meetingId: m.id, date: m.date, title: m.title, startTime: m.startTime, endTime: m.endTime, recurring: false, rsvp: r?.rsvp || null, leaveReason: r?.rsvp === "leave" ? r.leaveReason : null, checkedInAt: r?.checkedInAt || null, checkedOutAt: r?.checkedOutAt || null, topics, attachments: m.attachments || [] });
  }

  // Order by date, then start time (so same-day meetings run in start-time order).
  const key = (x) => `${x.date}T${x.startTime || "00:00"}`;
  out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return out;
}

// Scheduling-conflict detection: for each proposed attendee (by name), find
// existing meetings on the given date(s) whose time window overlaps
// [startTime, endTime]. Skips the meeting being edited, permanently-removed /
// cancelled / deleted occurrences, and anyone already on leave for the clashing
// meeting. Used to warn the creator before a notice goes out. Non-blocking.
function findConflicts({ dates, startTime, endTime, names, excludeMeetingId }) {
  const dayList = [...new Set((dates || []).filter(Boolean))];
  const who = new Set((names || []).filter(Boolean));
  if (!dayList.length || !who.size) return [];
  const toMin = (s, def) => { const [h, m] = (s || "").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : def; };
  const aS = toMin(startTime, 0), aE = toMin(endTime, aS + 60);
  const overlaps = (bStart, bEnd) => { const bS = toMin(bStart, 0), bE = toMin(bEnd, bS + 60); return aS < bE && bS < aE; };
  const byName = new Map();
  const add = (name, c) => { if (!byName.has(name)) byName.set(name, []); byName.get(name).push(c); };

  for (const date of dayList) {
    // Standalone / materialised meetings landing on this date.
    for (const m of listMeetings()) {
      if (m.date !== date || (excludeMeetingId && m.id === excludeMeetingId)) continue;
      if (!overlaps(m.startTime, m.endTime)) continue;
      for (const p of m.roster) {
        if (!who.has(p.name) || m.responses[p.id]?.rsvp === "leave") continue;
        add(p.name, { date, title: m.title, startTime: m.startTime, endTime: m.endTime });
      }
    }
    // Recurring-schedule occurrences on this date (not yet materialised).
    const dayStart = Date.parse(`${date}T00:00:00`);
    const dayEnd = Date.parse(`${date}T23:59:59`);
    for (const s of Object.values(store.schedules)) {
      if (!s.enabled) continue;
      const occId = `${s.id}__${date}`;
      if ((excludeMeetingId && occId === excludeMeetingId) || getMeeting(occId)) continue; // materialised → counted above
      if (store.tombstones[occId] || store.cancelled[occId] || store.deleted[occId]) continue;
      const occs = occurrencesInRange(s, dayStart, dayEnd);
      if (!occs.some((o) => ymd(o) === date) || !overlaps(s.startTime, s.endTime)) continue;
      const rec = s.recipientIds?.length ? s.roster.filter((p) => s.recipientIds.includes(p.id)) : s.roster;
      for (const p of rec) {
        if (!who.has(p.name) || getStanding(s.id, p.name) === "leave") continue;
        add(p.name, { date, title: s.title, startTime: s.startTime, endTime: s.endTime });
      }
    }
  }
  return [...byName.entries()].map(([name, conflicts]) => ({ name, conflicts }));
}

const HOURS_WARNING = 20; // meeting-hours threshold over the selected window

// A participant's performance over an inclusive [fromDate, toDate] window
// (YYYY-MM-DD), computed over the materialised meeting instances they're on.
function memberRangeSummary(name, fromDate, toDate) {
  const hm = (s) => { const [h, m] = (s || "").split(":").map(Number); return Number.isFinite(h) ? h + (m || 0) / 60 : 0; };
  const now = Date.now();
  let sessions = 0, occurred = 0, checkedIn = 0, hours = 0, absentNoLeave = 0, onLeave = 0;
  for (const m of listMeetings()) {
    if (!m.date || m.date < fromDate || m.date > toDate) continue;
    const p = m.roster.find((r) => r.name === name);
    if (!p) continue;
    const r = m.responses[p.id];
    sessions++;
    const dur = Math.max(0, hm(m.endTime) - hm(m.startTime));
    if (r?.checkedInAt) { checkedIn++; hours += dur; }
    if (r?.rsvp === "leave") onLeave++;
    if (Date.parse(`${m.date}T${m.startTime || "00:00"}:00`) <= now) { // already occurred
      occurred++;
      if (!r?.checkedInAt && r?.rsvp !== "leave") absentNoLeave++;
    }
  }
  return {
    from: fromDate, to: toDate, sessions, occurred, checkedIn, onLeave,
    hours: Math.round(hours * 10) / 10,
    attendanceRate: occurred ? Math.round((checkedIn / occurred) * 100) : 0,
    absentNoLeave,
    overWarning: hours >= HOURS_WARNING,
    warningHours: HOURS_WARNING,
  };
}

// Convenience: a whole calendar month (YYYY-MM).
function memberMonthlySummary(name, month) {
  const [y, mo] = month.split("-").map(Number);
  const last = (y && mo) ? new Date(y, mo, 0).getDate() : 31;
  const to = `${month}-${String(last).padStart(2, "0")}`;
  return { ...memberRangeSummary(name, `${month}-01`, to), month };
}

// ── Seed ───────────────────────────────────────────────────────────────
// No mock data. Start with a single EMPTY meeting shell (so the app's default
// route works); the admin fills in title/time/agenda/roster via the UI, and
// creates real schedules. No sample staff, agenda, schedule, or members.
function seed() {
  if (store.order.length) return;
  const m = createMeeting({ id: "M202607", topics: [], roster: [] });
  m.title = ""; // blank — admin sets it in Compose / Manage
}

export {
  LEAVE_TYPES,
  STANCES,
  createMeeting,
  getMeeting,
  updateMeetingMeta,
  setTopics,
  setRoster,
  addParticipant,
  addScheduleInvitee,
  listMeetings,
  getResponse,
  setRsvp,
  checkIn,
  checkOut,
  markAgendaRead,
  setComment,
  linkLineUser,
  withScheduleAttachments,
  loadStore,
  saveStore,
  persist,
  memberUpcoming,
  memberMonthlySummary,
  memberRangeSummary,
  findConflicts,
  scheduleIdOf,
  getStanding,
  setStanding,
  applyStanding,
  getMember,
  upsertPendingMember,
  registerMember,
  listMembers,
  deleteMember,
  setMemberActive,
  seed,
};
