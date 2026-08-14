// Editing a meeting must not cost the creator the responses already collected,
// and the edit must actually reach the participant's 我的會議.
//
// Production bugs pinned down here:
//  · Correcting a meeting (e.g. pushing the end time back because it ran late)
//    wiped every RSVP, leave reason, agenda-read, check-in and comment, because
//    the editor re-sends roster/topics WITHOUT ids and the store minted new ones.
//  · 我的會議 read title/time off the schedule, so occurrence edits never showed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MM_DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-edit-")), "store.json");
const db = await import("./store.js");

const OCC = "2026-09-20";
const FROM = Date.parse(`${OCC}T00:00:00`) - 86400000;
const TO = Date.parse(`${OCC}T23:59:59`) + 86400000;

// A recurring meeting whose occurrence has been materialised and answered:
// 歐寶 confirmed, read the agenda and left a comment; 鄒瑞蓮 took leave.
function meetingWithResponses() {
  const s = db.createSchedule({
    title: "月會",
    recurrence: { freq: "once", date: OCC },
    startTime: "14:00", endTime: "15:00",
    topics: [{ title: "議題一" }, { title: "議題二" }],
    roster: [{ name: "歐寶" }, { name: "鄒瑞蓮" }],
  });
  const m = db.createMeeting({
    id: `${s.id}__${OCC}`, title: s.title, date: OCC,
    startTime: s.startTime, endTime: s.endTime,
    topics: s.topics, roster: s.roster,
  });
  const [a, b] = m.roster;
  db.setRsvp(m.id, a.id, "yes");
  db.markAgendaRead(m.id, a.id);
  db.setComment(m.id, a.id, m.topics[0].id, "comment", "我有意見");
  db.checkIn(m.id, a.id);
  db.setRsvp(m.id, b.id, "leave", "出差");
  return { schedule: s, meeting: db.getMeeting(m.id) };
}

// Exactly what CreateForm sends on save: no participant ids, no topic ids.
function saveEditsLikeTheUi(meetingId, patch) {
  const m = db.getMeeting(meetingId);
  db.updateMeetingMeta(meetingId, patch);
  db.setTopics(meetingId, m.topics.map((t) => ({ title: t.title })));
  db.setRoster(meetingId, m.roster.map((p) => ({ name: p.name, dept: p.dept })));
}

test("editing a meeting keeps every response already collected", () => {
  const { meeting } = meetingWithResponses();
  saveEditsLikeTheUi(meeting.id, { endTime: "16:00" }); // ran late

  const after = db.getMeeting(meeting.id);
  const responses = Object.values(after.responses);
  assert.equal(responses.length, 2);

  const yes = responses.find((r) => r.name === "歐寶");
  assert.equal(yes.rsvp, "yes", "confirmation survived");
  assert.ok(yes.agendaReadAt, "agenda-read survived");
  assert.ok(yes.checkedInAt, "check-in survived");
  assert.equal(Object.keys(yes.comments).length, 1, "pre-filled comment survived");

  const leave = responses.find((r) => r.name === "鄒瑞蓮");
  assert.equal(leave.rsvp, "leave");
  assert.equal(leave.leaveReason, "出差", "leave reason survived");
});

test("a comment stays attached to its topic across an edit", () => {
  const { meeting } = meetingWithResponses();
  const topicId = meeting.topics[0].id;
  saveEditsLikeTheUi(meeting.id, { endTime: "16:00" });

  const after = db.getMeeting(meeting.id);
  assert.equal(after.topics[0].id, topicId, "unchanged topic keeps its id");
  const commented = Object.values(after.responses).find((r) => r.name === "歐寶");
  assert.equal(commented.comments[topicId]?.text, "我有意見");
});

test("removing someone from the roster still drops them", () => {
  const { meeting } = meetingWithResponses();
  db.setRoster(meeting.id, [{ name: "歐寶" }]);

  const after = db.getMeeting(meeting.id);
  assert.equal(after.roster.length, 1);
  assert.equal(Object.values(after.responses).length, 1);
  assert.equal(Object.values(after.responses)[0].rsvp, "yes", "the one kept still has their answer");
});

test("我的會議 shows the edited time, not the schedule's original", () => {
  const { schedule, meeting } = meetingWithResponses();
  saveEditsLikeTheUi(meeting.id, { title: "月會（延長）", startTime: "14:00", endTime: "16:00" });

  // Every case shares one store, so select this schedule's own occurrence.
  const [item] = db.memberUpcoming("歐寶", FROM, TO).filter((i) => i.scheduleId === schedule.id);
  assert.equal(item.endTime, "16:00", "the pushed-back end time reaches the participant");
  assert.equal(item.title, "月會（延長）");
  assert.equal(item.rsvp, "yes");
});

test("an occurrence that was never edited still follows its schedule", () => {
  const s = db.createSchedule({
    title: "晨會", recurrence: { freq: "once", date: OCC },
    startTime: "09:00", endTime: "09:30", roster: [{ name: "歐寶" }],
  });
  const [item] = db.memberUpcoming("歐寶", FROM, TO).filter((i) => i.scheduleId === s.id);
  assert.equal(item.startTime, "09:00");
  assert.equal(item.endTime, "09:30");
});
