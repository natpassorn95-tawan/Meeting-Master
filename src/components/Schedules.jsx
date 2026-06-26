import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, card, label, input, btn, pill } from "../ui.js";
import { useT, recurrenceTextI18n, fmtDateTimeI18n, ordinalText } from "../i18n.jsx";

const NTHS = [1, 2, 3, 4, 5];
const LEADS = [15, 60, 1440, 4320, 10080];

function occText(s, lang) {
  if (!s.nextOccurrenceAt) return "—";
  const d = new Date(s.nextOccurrenceAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return fmtDateTimeI18n(date, s.startTime, s.endTime, lang);
}
function fmtTs(ms, lang) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(lang === "en" ? "en-US" : "zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Schedules({ go }) {
  const { t, lang } = useT();
  const [schedules, setSchedules] = useState(null);
  const [pool, setPool] = useState([]);
  const [error, setError] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showPassed, setShowPassed] = useState(false);
  const [deleted, setDeleted] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const [scheds, del] = await Promise.all([api.listSchedules(), api.listDeletedMeetings().catch(() => [])]);
      setSchedules(scheds);
      setDeleted(del);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Recipient pool = registered Members (aligned with the Members page).
  useEffect(() => {
    api.listMembers()
      .then((ms) => setPool(ms.filter((m) => m.status === "registered").map((m) => ({
        id: m.lineUserId, name: m.name, dept: m.employeeId || "—", lineUserId: m.lineUserId,
      }))))
      .catch(() => {});
  }, []);

  async function runNow(id) {
    setBusyId(id); setRunResult(null); setError("");
    try { setRunResult(await api.runSchedule(id)); }
    catch (e) { setError(e.message); }
    finally { setBusyId(null); load(); }
  }
  async function toggle(s) {
    try { await api.updateSchedule(s.id, { enabled: !s.enabled }); load(); } catch (e) { setError(e.message); }
  }
  async function remove(id) {
    try { await api.deleteSchedule(id); load(); } catch (e) { setError(e.message); }
  }
  async function actDeleted(fn) {
    setError("");
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>{t("sched.heading")}</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{t("sched.desc")}</p>
      </div>

      {error ? <div style={{ ...card, borderColor: RED, color: RED, fontSize: 14 }}>⚠ {error}</div> : null}
      {runResult ? (
        <div style={{ ...card, borderColor: GREEN, fontSize: 14 }}>
          {t("sched.result", { occ: runResult.occurrenceText, mode: runResult.mode, count: runResult.count })}
          <button onClick={() => go("host", { m: runResult.meetingId, board: "1" })} style={{ ...btn(false), height: 30, fontSize: 12, marginLeft: 10 }}>{t("sched.viewHost")}</button>
        </div>
      ) : null}

      {schedules === null ? <p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p> : (() => {
        const active = schedules.filter((s) => s.nextOccurrenceAt != null);
        const passed = schedules.filter((s) => s.nextOccurrenceAt == null);
        const renderCard = (s, isPassed) => (
          <div key={s.id} style={{ ...card, ...(isPassed ? { opacity: 0.85 } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>{s.title}</h3>
                  {isPassed ? <span style={pill("rgba(0,0,0,.06)", "#888")}>{t("sched.passedTag")}</span>
                    : s.enabled ? <span style={pill("#E1F5EE", GREEN)}>{t("sched.enabled")}</span>
                    : <span style={pill("rgba(0,0,0,.06)", "#888")}>{t("sched.disabled")}</span>}
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  🔁 {recurrenceTextI18n(s, lang)}　📍 {s.location || "—"}　👤 {s.host || "—"}
                </p>
                {(s.startDate || s.endDate) ? (
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>📆 {s.startDate || "…"} – {s.endDate || "…"}</p>
                ) : null}
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  👥 {t("sched.recipients", { n: s.recipientIds?.length || s.roster.length })}　⏰ {t("sched.lead", { lead: (s.leads || []).map((l) => t(`lead.${l}`)).join(lang === "en" ? ", " : "、") })}
                </p>
                {!isPassed ? (
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: ACCENT }}>
                    {t("sched.nextMeeting")}：{occText(s, lang)}　|　{t("sched.scheduledSend")}：{fmtTs(s.nextSendAt, lang)}
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                {!isPassed ? (
                  <button onClick={() => runNow(s.id)} disabled={busyId === s.id} style={{ ...btn(true), height: 34, fontSize: 13 }}>
                    {busyId === s.id ? t("sched.sending") : t("sched.runNow")}
                  </button>
                ) : null}
                {!isPassed ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => toggle(s)} style={{ ...btn(false), height: 30, fontSize: 12 }}>{s.enabled ? t("sched.disable") : t("sched.enable")}</button>
                    <button onClick={() => remove(s.id)} style={{ ...btn(false), height: 30, fontSize: 12, color: RED, borderColor: RED + "55" }}>{t("common.delete")}</button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {schedules.length === 0 ? <p style={{ color: "var(--color-text-tertiary,#999)" }}>{t("sched.none")}</p> : null}
            {active.map((s) => renderCard(s, false))}

            {passed.length ? (
              <div style={card}>
                <button onClick={() => setShowPassed((v) => !v)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", padding: 0 }}>
                  <span>📁 {t("sched.passed")} ({passed.length})</span>
                  <span style={{ color: "var(--color-text-tertiary,#999)" }}>{showPassed ? "▲" : "▼"}</span>
                </button>
                {showPassed ? <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>{passed.map((s) => renderCard(s, true))}</div> : null}
              </div>
            ) : null}

            {/* Deleted meetings: occurrences pulled here when a schedule is deleted */}
            <div style={card}>
              <button onClick={() => setShowDeleted((v) => !v)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", padding: 0 }}>
                <span>🗑 {t("sched.deletedFolder")} ({deleted.length})</span>
                <span style={{ color: "var(--color-text-tertiary,#999)" }}>{showDeleted ? "▲" : "▼"}</span>
              </button>
              {showDeleted ? (
                deleted.length === 0 ? (
                  <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{t("sched.emptyDeleted")}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                    {deleted.map((m) => (
                      <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 12px", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 10, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--color-text-secondary)" }}>{m.title || "（未命名會議）"}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{fmtDateTimeI18n(m.date, m.startTime, m.endTime, lang)}{m.location ? `・${m.location}` : ""}</p>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => actDeleted(() => api.restoreMeeting(m.id))} style={{ ...btn(false), height: 30, fontSize: 12, color: GREEN, borderColor: GREEN + "55" }}>↩ {t("sched.restore")}</button>
                          <button onClick={() => { if (confirm(t("sched.purgeConfirm"))) actDeleted(() => api.purgeMeeting(m.id)); }} style={{ ...btn(false), height: 30, fontSize: 12, color: RED, borderColor: RED + "55" }}>{t("sched.purge")}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          </div>
        );
      })()}

      <CreateForm pool={pool} onCreated={() => { setRunResult(null); load(); }} setError={setError} />
    </div>
  );
}

function CreateForm({ pool, onCreated, setError }) {
  const { t, lang, weekdayFull } = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    title: "", location: "", host: "", startTime: "14:00", endTime: "15:30",
    freq: "weekly", weekday: 5, nth: 1, date: "", startDate: "", endDate: "", leads: [15], topics: "",
  });
  const [recipients, setRecipients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState([]); // [{ url, name, type, size }]
  const [uploading, setUploading] = useState(false);

  useEffect(() => { setRecipients(pool.map((p) => p.id)); }, [pool]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleR = (id) => setRecipients((r) => r.includes(id) ? r.filter((x) => x !== id) : [...r, id]);
  const toggleLead = (v) => setF((prev) => ({ ...prev, leads: prev.leads.includes(v) ? prev.leads.filter((x) => x !== v) : [...prev.leads, v] }));

  const fileToDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });

  // Upload agenda attachments (image / PDF / Word / Excel / …) → stored on server.
  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    setUploading(true);
    try {
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        const att = await api.uploadFile({ name: file.name, type: file.type, dataUrl });
        setAttachments((a) => [...a, att]);
      }
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  }
  const removeAttachment = (url) => setAttachments((a) => a.filter((x) => x.url !== url));

  async function create() {
    if (!f.title.trim()) { setError(t("sched.errTitle")); return; }
    if (f.freq === "once" && !f.date) { setError(t("sched.errDate")); return; }
    if (f.endTime && f.startTime >= f.endTime) { setError(t("sched.errTime")); return; } // start must be before end
    setSaving(true); setError("");
    try {
      await api.createSchedule({
        title: f.title.trim(), location: f.location.trim(), host: f.host.trim(),
        startTime: f.startTime, endTime: f.endTime,
        recurrence: { freq: f.freq, weekday: Number(f.weekday), nth: Number(f.nth), date: f.date },
        startDate: f.freq === "once" ? "" : f.startDate,
        endDate: f.freq === "once" ? "" : f.endDate,
        leads: f.leads.length ? f.leads : [15],
        topics: f.topics.split("\n").map((x) => x.trim()).filter(Boolean),
        attachments,
        roster: pool, recipientIds: recipients,
      });
      setF({ ...f, title: "" }); setAttachments([]); setOpen(false); onCreated();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} style={{ ...btn(true), alignSelf: "flex-start" }}>{t("sched.add")}</button>;
  }

  const selStyle = { ...input, appearance: "auto" };
  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 500 }}>{t("sched.createTitle")}</h3>

      <label style={label}>{t("sched.title")}</label>
      <input style={input} value={f.title} onChange={set("title")} placeholder={t("sched.titlePlaceholder")} />
      <div style={{ height: 14 }} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}><label style={label}>{t("label.location")}</label><input style={input} value={f.location} onChange={set("location")} placeholder={t("sched.locPlaceholder")} /></div>
        <div style={{ flex: "1 1 200px" }}><label style={label}>{t("label.hostFull")}</label><input style={input} value={f.host} onChange={set("host")} placeholder={t("sched.hostPlaceholder")} /></div>
      </div>

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.recurrence")}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...selStyle, flex: "0 0 120px" }} value={f.freq} onChange={set("freq")}>
          <option value="once">{t("freq.once")}</option>
          <option value="weekly">{t("freq.weekly")}</option>
          <option value="monthly">{t("freq.monthly")}</option>
        </select>
        {f.freq === "once" ? (
          <input type="date" style={{ ...selStyle, flex: "1 1 170px" }} value={f.date} onChange={set("date")} />
        ) : (
          <>
            {f.freq === "monthly" ? (
              <select style={{ ...selStyle, flex: "0 0 120px" }} value={f.nth} onChange={set("nth")}>
                {NTHS.map((n) => <option key={n} value={n}>{ordinalText(n, lang)}</option>)}
              </select>
            ) : null}
            <select style={{ ...selStyle, flex: "0 0 130px" }} value={f.weekday} onChange={set("weekday")}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => <option key={i} value={i}>{weekdayFull(i)}</option>)}
            </select>
          </>
        )}
      </div>
      {f.freq !== "once" ? (
        <>
          <div style={{ height: 10 }} />
          <label style={label}>{t("sched.period")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" style={{ ...selStyle, flex: "1 1 150px" }} value={f.startDate} onChange={set("startDate")} />
            <span style={{ color: "var(--color-text-tertiary,#999)" }}>–</span>
            <input type="date" style={{ ...selStyle, flex: "1 1 150px" }} value={f.endDate} onChange={set("endDate")} />
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("sched.periodHint")}</p>
        </>
      ) : null}

      <div style={{ height: 14 }} />
      <label style={label}>{t("label.time")}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="time" style={{ ...selStyle, flex: 1 }} value={f.startTime} onChange={set("startTime")} />
        <span style={{ color: "var(--color-text-tertiary,#999)" }}>–</span>
        <input type="time" style={{ ...selStyle, flex: 1 }} value={f.endTime} onChange={set("endTime")} />
      </div>
      {f.endTime && f.startTime >= f.endTime ? (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: RED }}>⚠ {t("sched.errTime")}</p>
      ) : null}

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.timing")}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {LEADS.map((v) => {
          const on = f.leads.includes(v);
          return (
            <button key={v} onClick={() => toggleLead(v)} style={{ height: 34, padding: "0 12px", fontSize: 13, borderRadius: 999, cursor: "pointer", border: on ? "none" : "0.5px solid rgba(0,0,0,.25)", background: on ? ACCENT : "transparent", color: on ? "#fff" : "var(--color-text-primary)" }}>
              {on ? "✓ " : ""}{t(`lead.${v}`)}
            </button>
          );
        })}
      </div>

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.recipientsLabel", { a: recipients.length, b: pool.length })}</label>
      {pool.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("sched.noMembers")}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {pool.map((p) => {
            const on = recipients.includes(p.id);
            return (
              <button key={p.id} onClick={() => toggleR(p.id)} style={{ height: 34, padding: "0 12px", fontSize: 13, borderRadius: 999, cursor: "pointer", border: on ? "none" : "0.5px solid rgba(0,0,0,.25)", background: on ? ACCENT : "transparent", color: on ? "#fff" : "var(--color-text-primary)" }}>
                {on ? "✓ " : ""}{p.name}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.topicsLabel")}</label>
      <textarea style={{ ...input, height: "auto", minHeight: 70, padding: "10px 12px", lineHeight: 1.5 }} value={f.topics} onChange={set("topics")} placeholder={"住房率與營收回顧\n人力排班\n其他臨時動議"} />

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.attachments")}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <label style={{ ...btn(false), height: 34, fontSize: 13, display: "inline-flex", alignItems: "center", cursor: uploading ? "wait" : "pointer", opacity: uploading ? 0.6 : 1 }}>
          📎 {uploading ? t("sched.uploading") : t("sched.uploadFiles")}
          <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={onFiles} style={{ display: "none" }} disabled={uploading} />
        </label>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("sched.attachHint")}</span>
      </div>
      {attachments.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {attachments.map((a) => <AttachmentChip key={a.url} att={a} onRemove={() => removeAttachment(a.url)} />)}
        </div>
      ) : null}

      <div style={{ height: 18 }} />
      <div style={{ display: "flex", gap: 8 }}>
        {(() => { const badTime = !!f.endTime && f.startTime >= f.endTime; return (
          <button onClick={create} disabled={saving || badTime} style={{ ...btn(true), flex: 1, opacity: saving || badTime ? 0.5 : 1 }}>{saving ? t("sched.creating") : t("sched.create")}</button>
        ); })()}
        <button onClick={() => setOpen(false)} style={{ ...btn(false), flex: "0 0 100px" }}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

export function attIcon(type, name) {
  const s = `${type || ""} ${name || ""}`;
  if (/image\//.test(type || "")) return "🖼";
  if (/pdf/i.test(s)) return "📄";
  if (/word|\.docx?/i.test(s)) return "📝";
  if (/sheet|excel|\.xlsx?|\.csv/i.test(s)) return "📊";
  return "📎";
}

function AttachmentChip({ att, onRemove }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", border: "0.5px solid rgba(0,0,0,.2)", borderRadius: 8, fontSize: 12, maxWidth: 220 }}>
      <span>{attIcon(att.type, att.name)}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
      {onRemove ? <button onClick={onRemove} style={{ border: "none", background: "transparent", cursor: "pointer", color: RED, fontSize: 15, lineHeight: 1 }}>×</button> : null}
    </div>
  );
}
