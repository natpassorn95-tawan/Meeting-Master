// Someone who left the company: marked inactive, they are cut off and taken
// off every recurring schedule and every meeting from today on — but past
// meetings keep them, and the record stays so they can't silently re-register.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MM_DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-left-")), "store.json");
const db = await import("./store.js");

const STAY = "U" + "1".repeat(32), LEFT = "U" + "2".repeat(32);
const ymd = (d) => d.toISOString().slice(0, 10);
const PAST = ymd(new Date(Date.now() - 7 * 86400000));
const FUTURE = ymd(new Date(Date.now() + 7 * 86400000));

test("marking a member inactive blocks them and removes them from future meetings only", () => {
  db.registerMember(STAY, { name: "留任", employeeId: "T1", email: "a@x", jobTitle: "x", department: "x" });
  db.registerMember(LEFT, { name: "離職", employeeId: "T2", email: "b@x", jobTitle: "x", department: "x" });
  const people = [
    { id: STAY, name: "留任", lineUserId: STAY },
    { id: LEFT, name: "離職", lineUserId: LEFT },
  ];
  const s = db.createSchedule({ title: "週會", recurrence: { freq: "weekly", weekday: 1 }, roster: people, recipientIds: [STAY, LEFT] });
  const past = db.createMeeting({ id: `${s.id}__${PAST}`, title: "週會", date: PAST, roster: people });
  const future = db.createMeeting({ id: `${s.id}__${FUTURE}`, title: "週會", date: FUTURE, roster: people });

  assert.equal(db.isBlockedUser(LEFT), false);
  const m = db.setMemberActive(LEFT, false);
  assert.equal(db.isBlockedUser(LEFT), true);
  assert.equal(db.isBlockedUser(STAY), false);
  assert.deepEqual(m.removedFrom, { schedules: 1, meetings: 1 });

  const sched = db.getSchedule(s.id);
  assert.deepEqual(sched.recipientIds, [STAY]);
  assert.deepEqual(sched.roster.map((p) => p.lineUserId), [STAY]);
  assert.deepEqual(db.getMeeting(future.id).roster.map((p) => p.lineUserId), [STAY]);
  assert.equal(Object.values(db.getMeeting(future.id).responses).length, 1);
  assert.equal(db.getMeeting(past.id).roster.length, 2, "history kept");

  // Re-registering (e.g. typing the register keyword) must not unblock them.
  db.registerMember(LEFT, { name: "離職", employeeId: "T2", email: "b@x", jobTitle: "x", department: "x" });
  assert.equal(db.isBlockedUser(LEFT), true);

  db.setMemberActive(LEFT, true);
  assert.equal(db.isBlockedUser(LEFT), false);
});

test("forget: only after inactive; deletes the record but keeps them blocked", () => {
  const GONE = "U" + "3".repeat(32);
  db.registerMember(GONE, { name: "已離開", employeeId: "T3", email: "c@x", jobTitle: "x", department: "x" });

  const early = db.forgetMember(GONE);
  assert.equal(early.code, "still_active", "an active member cannot be forgotten");
  assert.ok(db.getMember(GONE));

  db.setMemberActive(GONE, false);
  assert.deepEqual(db.forgetMember(GONE), { ok: true });
  assert.equal(db.getMember(GONE), null, "personal details gone");
  assert.equal(db.listMembers().some((m) => m.lineUserId === GONE), false);
  assert.equal(db.isBlockedUser(GONE), true, "still blocked after being forgotten");
  assert.equal(db.forgetMember(GONE).status, 404);
});
