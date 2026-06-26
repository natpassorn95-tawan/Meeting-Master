import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { card, btn, pill, avatar, GREEN, RED, ACCENT, AMBER, STANCE_META } from "../ui.js";
import { useT } from "../i18n.jsx";

export default function HostDashboard({ meetingId, go }) {
  const { t, lang } = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reminding, setReminding] = useState(false);
  const [remindResult, setRemindResult] = useState(null);
  const [sendingCk, setSendingCk] = useState(false);
  const [ckResult, setCkResult] = useState(null);

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

  async function sendCheckin() {
    setSendingCk(true); setCkResult(null);
    try { setCkResult(await api.sendCheckin(meetingId)); }
    catch (e) { setError(e.message); }
    finally { setSendingCk(false); load(); }
  }

  // Download the attendee responses as a CSV (UTF-8 BOM → opens in Excel).
  function downloadReport() {
    const en = lang === "en";
    const fmtDT = (ms) => ms ? new Date(ms).toLocaleString(en ? "en-US" : "zh-TW") : (en ? "—" : "—");
    const statusOf = (r) => r.rsvp === "yes" ? (en ? "Confirmed" : "已確認") : r.rsvp === "leave" ? (en ? "Leave" : "請假") : (en ? "No reply" : "未回覆");
    const header = en
      ? ["Name", "Employee ID / Dept", "Status", "Leave reason", "Agenda read", "Checked in", "Comments"]
      : ["姓名", "員工編號 / 部門", "出席狀態", "請假事由", "議程已讀", "報到時間", "議程意見"];
    const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [header];
    for (const p of roster) {
      const r = byId[p.id];
      const leave = r.rsvp === "leave" && r.leaveReason ? `${t(`leaveType.${r.leaveReason.type}`)}${r.leaveReason.text ? ` ${r.leaveReason.text}` : ""}` : "";
      const comments = topics
        .map((tp) => { const c = r.comments?.[tp.id]; return c && c.stance !== "none" ? `${tp.order}.${tp.title}: ${t(`stance.${c.stance}`)}${c.text ? `(${c.text})` : ""}` : null; })
        .filter(Boolean).join(" | ");
      rows.push([p.name, p.dept, statusOf(r), leave, r.agendaReadAt ? fmtDT(r.agendaReadAt) : "", r.checkedInAt ? fmtDT(r.checkedInAt) : "", comments]);
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
          <button onClick={() => go("host", { m: meetingId })} style={{ ...btn(false), height: 34, fontSize: 13 }}>{t("host.backToCalendar")}</button>
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
            <button onClick={downloadReport} style={{ ...btn(false), height: 32, fontSize: 12 }}>{t("host.download")}</button>
            <button onClick={sendCheckin} disabled={sendingCk} style={{ ...btn(false), height: 32, fontSize: 12 }}>
              {sendingCk ? t("host.sendingCheckin") : t("host.sendCheckin")}
            </button>
            <button onClick={remind} disabled={reminding} style={{ ...btn(false), height: 32, fontSize: 12 }}>
              {reminding ? t("host.reminding") : t("host.remind")}
            </button>
          </div>
        </div>
        {ckResult ? (
          <div style={{ marginBottom: 12, padding: "0.6rem 0.9rem", background: "#E1F5EE", color: GREEN, borderRadius: 8, fontSize: 13 }}>
            {t("host.checkinSent", { pushed: ckResult.pushed, total: ckResult.recipients })}
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
                  <button onClick={() => go("invite", { m: meetingId, p: p.id })} style={{ ...btn(false), height: 28, fontSize: 11, padding: "0 10px" }}>{t("host.playAs")}</button>
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
