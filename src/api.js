// Thin client over the Meeting Master dev API (server/index.js).

async function req(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  // Console identity (who am I) — scopes what the API returns / lets me edit.
  try { const u = localStorage.getItem("mm_user"); if (u) headers["x-mm-user"] = u; } catch { /* ignore */ }
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const post = (path, body) => req(path, { method: "POST", body: JSON.stringify(body || {}) });
const patch = (path, body) => req(path, { method: "PATCH", body: JSON.stringify(body || {}) });
const put = (path, body) => req(path, { method: "PUT", body: JSON.stringify(body || {}) });
const del = (path) => req(path, { method: "DELETE" });

export const api = {
  // LINE connection + notice
  lineStatus: () => req("/line/status"),
  previewNotice: (notice) => post("/line/notice/preview", notice),

  // Meetings
  listMeetings: () => req("/meetings"),
  getMeeting: (id) => req(`/meetings/${id}`),
  listDeletedMeetings: () => req("/meetings/deleted"),
  restoreMeeting: (id) => post(`/meetings/${id}/restore`),
  purgeMeeting: (id) => del(`/meetings/${id}`),
  listCancelledMeetings: () => req("/meetings/cancelled"),
  restoreCancelled: (id) => post(`/meetings/${id}/restore-cancelled`),
  purgeCancelled: (id) => del(`/meetings/${id}/cancelled`),
  trashMeeting: (id) => post(`/meetings/${id}/trash`),
  createMeeting: (m) => post("/meetings", m),
  updateMeta: (id, patchBody) => patch(`/meetings/${id}/meta`, patchBody),
  setTopics: (id, topics) => put(`/meetings/${id}/topics`, { topics }),
  setRoster: (id, roster) => put(`/meetings/${id}/roster`, { roster }),
  enroll: (id, person) => post(`/meetings/${id}/enroll`, person),
  inviteToMeeting: (id, members) => post(`/meetings/${id}/invite`, { members }),
  uploadFile: (payload) => post("/uploads", payload), // { name, type, dataUrl }

  // My Meetings (participant manages attendance across occurrences)
  myMeetings: (name, from, to) => req(`/my-meetings?name=${encodeURIComponent(name)}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`),
  mySummary: (name, month) => req(`/my-meetings/summary?name=${encodeURIComponent(name)}&month=${month}`),
  mySummaryRange: (name, from, to) => req(`/my-meetings/summary?name=${encodeURIComponent(name)}&from=${from}&to=${to || from}`),
  myMeetingsRsvp: (payload) => post("/my-meetings/rsvp", payload),
  getResponses: (id) => req(`/meetings/${id}/responses`),
  notify: (id, mode, to) => post(`/meetings/${id}/notify`, { mode, to }),
  remindUnread: (id) => post(`/meetings/${id}/remind-unread`),
  cancelMeeting: (id) => post(`/meetings/${id}/cancel`),

  // Participant
  getParticipant: (id, pid) => req(`/meetings/${id}/participant/${pid}`),
  rsvp: (id, pid, value, leaveReason) =>
    post(`/meetings/${id}/participant/${pid}/rsvp`, { value, leaveReason }),
  markAgendaRead: (id, pid) => post(`/meetings/${id}/participant/${pid}/agenda-read`),
  checkin: (id, name) => post(`/meetings/${id}/checkin`, { name }),
  checkout: (id, name) => post(`/meetings/${id}/checkout`, { name }),
  sendCheckin: (id) => post(`/meetings/${id}/send-checkin`),
  checkinLink: (id) => req(`/meetings/${id}/checkin-link`),
  setComment: (id, pid, topicId, stance, text) =>
    post(`/meetings/${id}/participant/${pid}/comments`, { topicId, stance, text }),

  // Recurring schedules
  listSchedules: () => req("/schedules"),
  createSchedule: (s) => post("/schedules", s),
  updateSchedule: (id, patchBody) => patch(`/schedules/${id}`, patchBody),
  deleteSchedule: (id) => del(`/schedules/${id}`),
  runSchedule: (id) => post(`/schedules/${id}/run-now`),
  getCalendar: (from, to) => req(`/calendar?from=${from}&to=${to}`),
  materialize: (scheduleId, occKey) => post(`/schedules/${scheduleId}/materialize`, { occKey }),

  // Members / onboarding
  listMembers: () => req("/members"),
  getMember: (userId) => req(`/members/${encodeURIComponent(userId)}`),
  registerMember: (userId, body) => post(`/members/${encodeURIComponent(userId)}/register`, body),
  setMemberActive: (userId, active) => patch(`/members/${encodeURIComponent(userId)}`, { active }),
  simulateFollow: (userId) => post("/members/simulate-follow", { userId }),
};
