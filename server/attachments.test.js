// Agenda attachments must reach the participant on BOTH participant screens:
// 我的會議 (memberUpcoming) and the agenda opened from the LINE notice
// (GET /api/meetings/:id → withScheduleAttachments).
//
// Production bug this pins down: a materialised occurrence copies the
// schedule's attachments when it is created, so a file the creator attached
// afterwards was visible in My Meetings but silently missing from the agenda.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the store file — importing store.js writes to MM_DATA_FILE.
process.env.MM_DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-att-")), "store.json");
const db = await import("./store.js");

const FILE = { url: "/uploads/x-guide.pdf", name: "會議資料.pdf", type: "application/pdf", size: 1234 };

// Creator sets up a recurring meeting, the notice goes out (the occurrence is
// materialised), and only THEN does the creator attach the file.
function scheduleWithLateAttachment() {
  const s = db.createSchedule({
    title: "附件測試",
    recurrence: { freq: "once", date: "2026-09-10" },
    startTime: "14:00",
    endTime: "15:00",
    topics: [{ title: "議題一" }],
    roster: [{ name: "歐寶" }],
  });
  const occKey = "2026-09-10";
  const meeting = db.createMeeting({
    id: `${s.id}__${occKey}`,
    title: s.title, date: occKey, startTime: s.startTime, endTime: s.endTime,
    topics: s.topics, attachments: s.attachments || [], roster: s.roster,
  });
  db.updateSchedule(s.id, { attachments: [FILE] }); // ← attached after the fact
  return { schedule: s, meeting, occKey };
}

test("agenda view shows a file attached to the schedule after materialisation", () => {
  const { meeting } = scheduleWithLateAttachment();

  assert.equal(meeting.attachments.length, 0, "the stored occurrence has no file of its own");
  const served = db.withScheduleAttachments(db.getMeeting(meeting.id));
  assert.equal(served.attachments.length, 1, "the agenda read falls back to the schedule");
  assert.equal(served.attachments[0].name, FILE.name);
});

test("我的會議 shows the same file", () => {
  scheduleWithLateAttachment();
  const from = Date.parse("2026-09-01T00:00:00");
  const to = Date.parse("2026-09-30T23:59:59");

  const items = db.memberUpcoming("歐寶", from, to).filter((i) => i.title === "附件測試");
  assert.ok(items.length, "the occurrence is listed");
  assert.equal(items[0].attachments.length, 1);
});

test("a meeting's own attachment is never replaced by the schedule's", () => {
  const { schedule, occKey } = scheduleWithLateAttachment();
  const own = { url: "/uploads/own.pdf", name: "自己的檔案.pdf" };
  db.updateMeetingMeta(`${schedule.id}__${occKey}`, { attachments: [own] });

  const served = db.withScheduleAttachments(db.getMeeting(`${schedule.id}__${occKey}`));
  assert.equal(served.attachments.length, 1);
  assert.equal(served.attachments[0].name, own.name, "the per-meeting file wins");
});

test("a standalone meeting with no schedule is returned untouched", () => {
  const m = db.createMeeting({ title: "standalone", date: "2026-09-11" });
  assert.equal(db.withScheduleAttachments(db.getMeeting(m.id)).attachments.length, 0);
});
