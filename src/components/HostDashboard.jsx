import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { card, btn, pill, avatar, GREEN, RED, ACCENT, AMBER, STANCE_META } from "../ui.js";
import { useT } from "../i18n.jsx";
import { RecipientPicker } from "./Schedules.jsx";

export default function HostDashboard({ meetingId, go }) {
  const { t, lang } = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reminding, setReminding] = useState(false);
  const [remindResult, setRemindResult] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [checkinUrl, setCheckinUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [pool, setPool] = useState(null);      // registered members for the invite picker
  const [inviteSel, setInviteSel] = useState([]); // selected lineUserIds
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.getResponses(meetingId)); }
    catch (e) { setError(e.message); }
  }, [meetingId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <p style={{ color: RED }}>⚠ {error}</p>;
  if (!data) return <p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>;

  const { meeting, topics, roster, responses } = data;
  const byId = Object.fromEntries(responses.map((r) => [r.participantId, r]));
  const confirmed = responses.filter((r) => r.rsvp === "yes").length;
  const onLeave = responses.filter((r) => r.rsvp === "leave").length;
  const noReply = responses.filter((r) => !r.rsvp).length;
  const readCount = responses.filter((r) => r.agendaReadAt).length;
  const checkedInCount = responses.filter((r) => r.checkedInAt).length;
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

  const rsvpPill = (r) => {
    if (r.rsvp === "yes") return <span style={pill("#E1F5EE", GREEN)}>{t("host.pillConfirmed")}</span>;
    if (r.rsvp === "leave") return <span style={pill("#F7E4EC", RED)}>{t("host.pillLeave")}</span>;
    return <span style={pill("rgba(0,0,0,.06)", "#888")}>{t("host.pillNoReply")}</span>;
  };

  async function remind() {
    setReminding(true); setRemindResult(null);
    try { setRemindResult(await api.remindUnread(meetingId)); }
    catch (e) { setError(e.message); }
    finally { setReminding(false); load(); }
  }

  async function toggleQR() {
    const next = !showQR; setShowQR(next);
    if (next && !checkinUrl) {
      try { const r = await api.checkinLink(meetingId); setCheckinUrl(r.url); }
      catch { setCheckinUrl(`${window.location.origin}/?view=checkin&m=${meetingId}`); }
    }
  }
  function copyLink() {
    const url = checkinUrl || `${window.location.origin}/?view=checkin&m=${meetingId}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  }

  async function toggleInvite() {
    const next = !showInvite; setShowInvite(next); setInviteSel([]);
    if (next && pool === null) {
      try { setPool((await api.listMembers()).filter((m) => m.status === "registered" && m.active !== false)); }
      catch { setPool([]); }
    }
  }
  async function submitInvite(availPool) {
    const members = availPool.filter((m) => inviteSel.includes(m.lineUserId))
      .map((m) => ({ name: m.name, dept: m.dept, lineUserId: m.lineUserId }));
    if (!members.length) return;
    setInviting(true); setError("");
    try {
      const r = await api.inviteToMeeting(meetingId, members);
      setShowInvite(false); setInviteSel([]);
      await load();
      alert(t("host.inviteDone", { added: r.added, pushed: r.pushed }));
    } catch (e) { setError(e.message); }
    finally { setInviting(false); }
  }

  // Cancel the meeting: notify attendees on LINE, then it moves to the trash.
  async function cancelMeeting() {
    if (!confirm(t("host.cancelConfirm", { title: meeting.title }))) return;
    setCancelling(true); setError("");
    try {
      const r = await api.cancelMeeting(meetingId);
      alert(t("host.cancelDone", { pushed: r.pushed, total: r.recipients }));
      go("host", {}); // back to the calendar; meeting is now in the Cancelled folder
    } catch (e) { setError(e.message); setCancelling(false); }
  }

  // Delete the meeting: no LINE notice, just move it to the Deleted folder
  // (restorable). For schedule occurrences this also keeps it off the calendar.
  async function deleteMeeting() {
    if (!confirm(t("host.deleteConfirm", { title: meeting.title }))) return;
    setDeleting(true); setError("");
    try {
      await api.trashMeeting(meetingId);
      go("host", {}); // back to the calendar; meeting is now in the Deleted folder
    } catch (e) { setError(e.message); setDeleting(false); }
  }

  // Send now: manually push this meeting's LINE notice immediately (broadcast to
  // the OA's followers), regardless of any schedule send window.
  async function sendNow() {
    if (!confirm(t("host.sendNowConfirm", { title: meeting.title }))) return;
    setSending(true); setError("");
    try {
      await api.notify(meetingId, "broadcast");
      alert(t("host.sendNowDone"));
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  // Download the attendee responses as a CSV (UTF-8 BOM → opens in Excel).
  function downloadReport() {
    const en = lang === "en";
    const fmtDT = (ms) => ms ? new Date(ms).toLocaleString(en ? "en-US" : "zh-TW") : (en ? "—" : "—");
    const statusOf = (r) => r.rsvp === "yes" ? (en ? "Confirmed" : "已確認") : r.rsvp === "leave" ? (en ? "Leave" : "請假") : (en ? "No reply" : "未回覆");
    const header = en
      ? ["Name", "Employee ID / Dept", "Status", "Leave reason", "Agenda read", "Checked in", "Checked out", "Comments"]
      : ["姓名", "員工編號 / 部門", "出席狀態", "請假事由", "議程已讀", "報到時間", "簽退時間", "議程意見"];
    const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [header];
    for (const p of roster) {
      const r = byId[p.id];
      const leave = r.rsvp === "leave" && r.leaveReason ? `${t(`leaveType.${r.leaveReason.type}`)}${r.leaveReason.text ? ` ${r.leaveReason.text}` : ""}` : "";
      const comments = topics
        .map((tp) => { const c = r.comments?.[tp.id]; return c && c.stance !== "none" ? `${tp.order}.${tp.title}: ${t(`stance.${c.stance}`)}${c.text ? `(${c.text})` : ""}` : null; })
        .filter(Boolean).join(" | ");
      rows.push([p.name, p.dept, statusOf(r), leave, r.agendaReadAt ? fmtDT(r.agendaReadAt) : "", r.checkedInAt ? fmtDT(r.checkedInAt) : "", r.checkedOutAt ? fmtDT(r.checkedOutAt) : "", comments]);
    }
    const csv = "﻿" + rows.map((row) => row.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(meeting.title || "meeting").replace(/[^\w一-鿿-]+/g, "_")}_${meeting.datetime ? meeting.id : meetingId}_attendance.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const stat = (n, lbl, color) => (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 26, fontWeight: 600, color }}>{n}</div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{lbl}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 13, color: "var(--color-text-secondary)" }}>{meeting.datetime}・{meeting.location}・{t("label.host")}：{meeting.host}</p>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>{meeting.title}</h2>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => go("host", { m: meetingId })} style={{ ...btn(false), height: 34, fontSize: 13 }}>{t("host.backToCalendar")}</button>
            <button onClick={cancelMeeting} disabled={cancelling || deleting} style={{ height: 34, fontSize: 13, fontWeight: 500, padding: "0 14px", borderRadius: 8, cursor: cancelling ? "default" : "pointer", border: "none", background: RED, color: "#fff", opacity: cancelling ? 0.6 : 1 }}>
              {cancelling ? t("host.cancelling") : t("host.cancelMeeting")}
            </button>
            <button onClick={deleteMeeting} disabled={cancelling || deleting} style={{ ...btn(false), height: 34, fontSize: 13, color: RED, borderColor: RED + "55", opacity: deleting ? 0.6 : 1 }}>
              {deleting ? t("host.deleting") : t("host.deleteMeeting")}
            </button>
            <button onClick={sendNow} disabled={sending || cancelling || deleting} style={{ ...btn(true), height: 34, fontSize: 13, opacity: sending ? 0.6 : 1 }}>
              {sending ? t("host.sending") : t("host.sendNow")}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 16, paddingTop: 16, borderTop: "0.5px solid rgba(0,0,0,.1)" }}>
          {stat(confirmed, t("host.confirmed"), GREEN)}
          {stat(onLeave, t("host.leave"), RED)}
          {stat(noReply, t("host.noReply"), "#888")}
          {stat(`${readCount}/${roster.length}`, t("host.read"), ACCENT)}
          {stat(`${checkedInCount}/${roster.length}`, t("host.checkedIn"), "#0F6E56")}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{t("host.rosterTitle")}</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={toggleInvite} style={{ ...btn(showInvite), height: 32, fontSize: 12 }}>➕ {t("host.invite")}</button>
            <button onClick={downloadReport} style={{ ...btn(false), height: 32, fontSize: 12 }}>{t("host.download")}</button>
            <button onClick={remind} disabled={reminding} style={{ ...btn(false), height: 32, fontSize: 12 }}>
              {reminding ? t("host.reminding") : t("host.remind")}
            </button>
            <button onClick={toggleQR} style={{ ...btn(showQR), height: 32, fontSize: 12 }}>📷 {t("host.checkinQR")}</button>
          </div>
        </div>
        {showInvite ? (() => {
          const onRoster = new Set((roster || []).map((p) => p.lineUserId).filter(Boolean));
          const availPool = (pool || [])
            .filter((mem) => !onRoster.has(mem.lineUserId))
            .map((mem) => ({ id: mem.lineUserId, name: mem.name, dept: mem.employeeId || mem.department || "—", lineUserId: mem.lineUserId }));
          const n = inviteSel.length;
          return (
            <div style={{ marginBottom: 14, padding: "14px", border: "0.5px dashed " + ACCENT + "66", borderRadius: 12, background: ACCENT + "08" }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>{t("host.inviteDesc")}</p>
              {pool === null ? <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>
                : availPool.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("host.inviteNone")}</p>
                : (
                  <>
                    <RecipientPicker pool={availPool} recipients={inviteSel} setRecipients={setInviteSel} />
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button onClick={() => submitInvite(availPool)} disabled={inviting || n === 0} style={{ ...btn(true), height: 36, fontSize: 13, opacity: (inviting || n === 0) ? 0.5 : 1 }}>{inviting ? t("host.inviting") : t("host.inviteN", { n })}</button>
                      <button onClick={() => setShowInvite(false)} style={{ ...btn(false), height: 36, fontSize: 13 }}>{t("common.cancel")}</button>
                    </div>
                  </>
                )}
            </div>
          );
        })() : null}
        {showQR ? (
          <div style={{ marginBottom: 14, padding: "16px", border: "0.5px dashed " + ACCENT + "66", borderRadius: 12, background: ACCENT + "08" }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center" }}>{t("host.checkinQRDesc")}</p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div style={{ width: 240, height: 240, padding: 12, background: "#fff", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 12 }}>
                <img src={`/api/meetings/${encodeURIComponent(meetingId)}/checkin-qr.svg`} alt="check-in QR" style={{ width: "100%", height: "100%", display: "block" }} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
                <code style={{ fontSize: 12, color: "var(--color-text-secondary)", wordBreak: "break-all" }}>{checkinUrl || "…"}</code>
                <button onClick={copyLink} style={{ ...btn(false), height: 30, fontSize: 12 }}>{copied ? t("host.copied") : t("host.copyLink")}</button>
              </div>
            </div>
          </div>
        ) : null}
        {remindResult ? (
          <div style={{ marginBottom: 12, padding: "0.6rem 0.9rem", background: "#FFF6E5", color: AMBER, borderRadius: 8, fontSize: 13 }}>
            {t("host.remindResult", {
              n: remindResult.unread.length,
              names: remindResult.unread.length ? `：${remindResult.unread.map((u) => u.name).join("、")}` : "",
              pushed: remindResult.pushed,
              note: remindResult.pushed === 0 ? t("host.remindNote") : "",
            })}
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roster.map((p, i) => {
            const r = byId[p.id];
            const a = avatar(p.name, i);
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: i === 0 ? "none" : "0.5px solid rgba(0,0,0,.08)" }}>
                <div style={a.wrap}>{a.letter}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{p.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{p.dept}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {rsvpPill(r)}
                  {r.rsvp === "leave" && r.leaveReason ? (
                    <span style={{ fontSize: 12, color: RED }}>{t(`leaveType.${r.leaveReason.type}`)}{r.leaveReason.text ? `：${r.leaveReason.text}` : ""}</span>
                  ) : null}
                  {r.agendaReadAt ? <span style={pill("#EDEBF7", ACCENT)}>{t("host.pillRead")}</span> : <span style={pill("rgba(0,0,0,.06)", "#999")}>{t("host.pillUnread")}</span>}
                  {r.checkedInAt
                    ? <span style={pill("#E1F5EE", "#0F6E56")}>🙋 {fmtTime(r.checkedInAt)}</span>
                    : <span style={pill("rgba(0,0,0,.06)", "#999")}>{t("host.notCheckedIn")}</span>}
                  {r.checkedOutAt ? <span style={pill("#EDEBF7", ACCENT)}>👋 {fmtTime(r.checkedOutAt)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 500 }}>{t("host.rollup")}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {topics.map((tp) => {
            const remarks = responses
              .map((r) => ({ r, c: r.comments[tp.id] }))
              .filter((x) => x.c && x.c.stance !== "none");
            return (
              <div key={tp.id}>
                <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 500 }}>{tp.order}. {tp.title}</p>
                {remarks.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("host.noComments")}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {remarks.map(({ r, c }) => {
                      const meta = STANCE_META[c.stance];
                      return (
                        <div key={r.participantId} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                          <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon} {r.name}</span>
                          <span style={{ color: "#333" }}>{c.text || (c.stance === "question" ? t("host.questionInMeeting") : "")}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
