// Editing a weekly meeting: "this date only" vs "this and all later dates".
// Before this, removing someone from a long-running weekly meeting meant
// opening and saving every date one by one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MM_DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-series-")), "store.json");
const db = await import("./store.js");

const A = "U" + "a".repeat(32), B = "U" + "b".repeat(32), C = "U" + "c".repeat(32);
const people = [
  { id: A, name: "歐寶", dept: "—", lineUserId: A },
  { id: B, name: "鄒瑞蓮", dept: "—", lineUserId: B },
  { id: C, name: "張瓊文", dept: "—", lineUserId: C },
];
const DATES = ["2026-11-02", "2026-11-09", "2026-11-16"];

function weeklyWithThreeDates() {
  const s = db.createSchedule({
    title: "晨會", recurrence: { freq: "weekly", weekday: 1 },
    startTime: "09:00", endTime: "10:00",
    topics: [{ title: "議題一" }], roster: people, recipientIds: [A, B, C],
  });
  const ms = DATES.map((d) => db.createMeeting({
    id: `${s.id}__${d}`, title: s.title, date: d, startTime: s.startTime, endTime: s.endTime,
    topics: s.topics, roster: people,
  }));
  return { s, ms };
}
// What CreateForm sends: the selected people, no participant ids.
const keep = (...ids) => people.filter((p) => ids.includes(p.lineUserId)).map(({ name, dept, lineUserId }) => ({ name, dept, lineUserId }));

test("scope 'one' changes only the edited date", () => {
  const { s, ms } = weeklyWithThreeDates();
  db.editMeetingScope(ms[1].id, { scope: "one", roster: keep(A, B) });
  assert.equal(db.getMeeting(ms[0].id).roster.length, 3);
  assert.equal(db.getMeeting(ms[1].id).roster.length, 2);
  assert.equal(db.getMeeting(ms[2].id).roster.length, 3);
  assert.deepEqual(db.getSchedule(s.id).recipientIds, [A, B, C], "series untouched");
});

test("scope 'future' changes this and later dates and the schedule, not earlier ones", () => {
  const { s, ms } = weeklyWithThreeDates();
  const yes = ms[2].roster.find((p) => p.lineUserId === A);
  db.setRsvp(ms[2].id, yes.id, "yes");

  const r = db.editMeetingScope(ms[1].id, {
    scope: "future", roster: keep(A, B),
    meta: { title: "晨會（新）", date: "2026-11-10", startTime: "09:30", endTime: "10:30" },
  });
  assert.equal(r.series, true);
  assert.equal(r.updated.length, 2);

  const [m0, m1, m2] = ms.map((m) => db.getMeeting(m.id));
  assert.equal(m0.roster.length, 3, "earlier date untouched");
  assert.equal(m0.title, "晨會");
  assert.equal(m1.roster.length, 2);
  assert.equal(m2.roster.length, 2);
  assert.equal(m2.title, "晨會（新）");
  assert.equal(m2.startTime, "09:30");
  assert.equal(m1.date, "2026-11-10", "date change applies to the edited date");
  assert.equal(m2.date, "2026-11-16", "…but not to the rest of the series");
  assert.equal(m2.responses[yes.id].rsvp, "yes", "responses survive");

  const sched = db.getSchedule(s.id);
  assert.deepEqual(sched.recipientIds, [A, B], "deselected person gets no future notices");
  assert.equal(sched.roster.length, 2);
  assert.equal(sched.title, "晨會（新）");
  assert.equal(sched.startTime, "09:30");
});
