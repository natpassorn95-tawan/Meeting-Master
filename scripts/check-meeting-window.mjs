#!/usr/bin/env node
// ── Is it safe to restart the server right now? ─────────────────────────
//
// Deploying restarts the app for a minute or two. Check-in is only open while
// a meeting is actually running (server/index.js#checkinOpen), so a restart
// landing inside a meeting is the one window where a deploy is visibly felt by
// attendees: they tap 報到 and get nothing.
//
// Whoever presses the deploy button cannot see this - the developer works from
// another machine and has no view of today's schedule - so the check belongs
// here, in the deploy path, not in a rule people are asked to remember.
//
// Recurrence is deliberately NOT reimplemented: this imports the app's own
// store.js so "when does this schedule occur" is answered by the same code the
// server uses. Point MM_DATA_FILE at the live store to inspect production.
//
//   node scripts/check-meeting-window.mjs            exit 0 = clear, 1 = busy
//   node scripts/check-meeting-window.mjs --json     machine-readable
//
// A meeting with no endTime is treated as running for CHECKIN_WINDOW_MS (2h)
// after it starts - the same assumption server/index.js makes when deciding
// whether check-in is open.

import * as db from "../server/store.js";

const CHECKIN_WINDOW_MS = 2 * 60 * 60 * 1000; // matches server/index.js
const EDGE_GUARD_MS = 5 * 60 * 1000;          // don't restart right on the boundary

const asJson = process.argv.includes("--json");

db.loadStore();

const now = Date.now();
const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

// [start, end] of a meeting, widened by the edge guard on both sides.
function windowOf(dateStr, startTime, endTime) {
  const startMs = Date.parse(`${dateStr}T${startTime || "00:00"}:00`);
  if (Number.isNaN(startMs)) return null;
  const endMs = endTime
    ? Date.parse(`${dateStr}T${endTime}:00`)
    : startMs + CHECKIN_WINDOW_MS;
  return { startMs, endMs: Number.isNaN(endMs) ? startMs + CHECKIN_WINDOW_MS : endMs };
}

const busy = [];
const seenOccurrence = new Set();

// Materialised meetings (the common case once a notice has gone out).
for (const m of db.listMeetings()) {
  if (!m.date || !m.startTime) continue;
  seenOccurrence.add(m.id);
  const w = windowOf(m.date, m.startTime, m.endTime);
  if (!w) continue;
  if (now >= w.startMs - EDGE_GUARD_MS && now <= w.endMs + EDGE_GUARD_MS) {
    busy.push({ title: m.title || "(untitled)", date: m.date, from: hhmm(w.startMs), to: hhmm(w.endMs), kind: "meeting" });
  }
}

// Schedule occurrences that have not been materialised yet.
for (const s of db.listSchedules()) {
  if (!s.enabled) continue;
  for (const occ of db.occurrencesInRange(s, startOfDay.getTime(), endOfDay.getTime())) {
    const occKey = db.ymd(occ);
    const occId = `${s.id}__${occKey}`;
    if (seenOccurrence.has(occId) || db.isTrashed(occId)) continue;
    const w = windowOf(occKey, s.startTime, s.endTime);
    if (!w) continue;
    if (now >= w.startMs - EDGE_GUARD_MS && now <= w.endMs + EDGE_GUARD_MS) {
      busy.push({ title: s.title || "(untitled)", date: occKey, from: hhmm(w.startMs), to: hhmm(w.endMs), kind: "scheduled" });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ clear: busy.length === 0, now: new Date(now).toISOString(), busy }));
} else if (busy.length === 0) {
  console.log(`No meeting in progress at ${hhmm(now)} - safe to restart.`);
} else {
  console.log(`DEPLOY BLOCKED - ${busy.length} meeting(s) in progress at ${hhmm(now)}:`);
  for (const b of busy) console.log(`  - ${b.title}  ${b.date} ${b.from}-${b.to} (${b.kind})`);
  const latest = busy.reduce((a, b) => (a.to > b.to ? a : b));
  console.log(`\nRestarting now would break check-in for attendees. Try again after ${latest.to}.`);
  console.log(`Override with --force on the deploy job only if you know the room is empty.`);
}

process.exit(busy.length === 0 ? 0 : 1);
