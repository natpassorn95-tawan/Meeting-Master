import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, AMBER, card, label, input, btn, pill, softBtn } from "../ui.js";
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

// Recurring-schedule list (active + passed folder), with run-now / enable /
// disable / delete. Self-loads its own schedules; reloads when `reloadToken`
// changes (e.g. after the parent creates a new schedule) and calls `onMutated`
// after any change so the parent calendar/trash can refresh too.
export function ScheduleList({ go, reloadToken, onMutated }) {
  const { t, lang } = useT();
  const [schedules, setSchedules] = useState(null);
  const [error, setError] = useState("");
  const [runResult, setRunResult] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showPassed, setShowPassed] = useState(false);

  const load = useCallback(async () => {
    try { setSchedules(await api.listSchedules()); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load, reloadToken]);

  const notify = () => { if (onMutated) onMutated(); };
  async function runNow(id) {
    setBusyId(id); setRunResult(null); setError("");
    try { setRunResult(await api.runSchedule(id)); }
    catch (e) { setError(e.message); }
    finally { setBusyId(null); load(); notify(); }
  }
  async function toggle(s) {
    try { await api.updateSchedule(s.id, { enabled: !s.enabled }); load(); notify(); } catch (e) { setError(e.message); }
  }
  async function remove(id) {
    try { await api.deleteSchedule(id); load(); notify(); } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 500 }}>{t("sched.heading")}</h2>
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
                  🔁 {recurrenceTextI18n(s, lang)}　📍 {s.location || "—"}{s.onlineUrl ? "　🔗 線上 Online" : ""}　👤 {s.host || "—"}
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
                    <button onClick={() => remove(s.id)} style={{ ...softBtn(RED), height: 30 }}>{t("common.delete")}</button>
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
          </div>
        );
      })()}
    </div>
  );
}

// Create a recurring schedule (or one-time meetings). Rendered as the body of a
// modal popup by the host calendar. `dates` is the set of YYYY-MM-DD days the
// admin selected on the calendar (drag for a range): one date → a single meeting
// (freq still switchable to weekly/monthly); multiple dates → a one-time meeting
// is created on each selected day. Self-loads its recipient pool from Members.
export function CreateForm({ dates = [], editMeeting = null, editId = null, onCreated, onClose, setError }) {
  const { t, lang, weekdayFull } = useT();
  const editing = !!editMeeting;
  const multi = !editing && dates.length > 1;
  const [pool, setPool] = useState([]);
  const [f, setF] = useState(editing ? {
    title: editMeeting.title || "", location: editMeeting.location || "", onlineUrl: editMeeting.onlineUrl || "", host: editMeeting.host || "",
    startTime: editMeeting.startTime || "14:00", endTime: editMeeting.endTime || "15:30",
    freq: "once", weekday: 5, nth: 1, date: editMeeting.date || "", startDate: "", endDate: "", leads: [15],
    topics: (editMeeting.topics || []).map((tp) => tp.title).join("\n"),
    visibility: editMeeting.visibility || "public",
  } : {
    title: "", location: "", onlineUrl: "", host: "", startTime: "14:00", endTime: "15:30",
    freq: "weekly", weekday: 5, nth: 1, date: "", startDate: "", endDate: "", leads: [15], topics: "",
    visibility: "public",
  });
  const [recipients, setRecipients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState(editMeeting?.attachments || []); // [{ url, name, type, size }]
  const [uploading, setUploading] = useState(false);
  const [conflicts, setConflicts] = useState([]); // [{ name, conflicts:[{date,title,startTime,endTime}] }]
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  // Conflict dates: a one-time meeting's date, an edit's date, or every day of a
  // multi-day batch. Recurring (weekly/monthly) is skipped — too many occurrences
  // to warn on usefully.
  const conflictDates = editing ? [f.date]
    : multi ? dates
    : (f.freq === "once" && f.date ? [f.date] : []);

  // Live, debounced conflict check as the creator picks time / recipients / date.
  useEffect(() => {
    const names = pool.filter((p) => recipients.includes(p.id)).map((p) => p.name);
    const dayList = conflictDates.filter(Boolean);
    if (!dayList.length || !f.startTime || !names.length) { setConflicts([]); setCheckingConflicts(false); return; }
    setCheckingConflicts(true);
    const h = setTimeout(async () => {
      try {
        const r = await api.checkConflicts({ dates: dayList, startTime: f.startTime, endTime: f.endTime, names, excludeMeetingId: editing ? editId : undefined });
        setConflicts(Array.isArray(r) ? r : []);
      } catch { setConflicts([]); }
      finally { setCheckingConflicts(false); }
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictDates.join(","), f.startTime, f.endTime, recipients.join(","), pool.length]);

  // Recipient pool = registered Members (aligned with the Members page).
  useEffect(() => {
    api.listMembers()
      .then((ms) => {
        const p = ms.filter((m) => m.status === "registered" && m.active !== false).map((m) => ({
          id: m.lineUserId, name: m.name, dept: m.employeeId || "—", lineUserId: m.lineUserId,
        }));
        setPool(p);
        if (editing) setRecipients((editMeeting.roster || []).map((r) => r.lineUserId).filter(Boolean));
        else setRecipients(p.map((x) => x.id));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A single clicked date → default to a one-time meeting on that date.
  useEffect(() => {
    if (!editing && dates.length === 1) setF((prev) => ({ ...prev, freq: "once", date: dates[0] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.join(",")]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
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
    if (f.endTime && f.startTime >= f.endTime) { setError(t("sched.errTime")); return; } // start must be before end
    if (editing) {
      setSaving(true); setError("");
      try {
        await api.updateMeta(editId, { title: f.title.trim(), location: f.location.trim(), onlineUrl: f.onlineUrl.trim(), host: f.host.trim(), date: f.date, startTime: f.startTime, endTime: f.endTime, visibility: f.visibility, attachments });
        await api.setTopics(editId, f.topics.split("\n").map((x) => x.trim()).filter(Boolean).map((title) => ({ title })));
        await api.setRoster(editId, pool.filter((p) => recipients.includes(p.id)).map((p) => ({ name: p.name, dept: p.dept, lineUserId: p.lineUserId })));
        const r = await api.notifyUpdate(editId).catch(() => ({ pushed: 0 }));
        onCreated(); onClose();
        alert(t("hostcal.editDone", { pushed: r?.pushed || 0 }));
      } catch (e) { setError(e.message); }
      finally { setSaving(false); }
      return;
    }
    if (!multi && f.freq === "once" && !f.date) { setError(t("sched.errDate")); return; }
    setSaving(true); setError("");
    const base = {
      title: f.title.trim(), location: f.location.trim(), onlineUrl: f.onlineUrl.trim(), host: f.host.trim(),
      startTime: f.startTime, endTime: f.endTime,
      leads: f.leads.length ? f.leads : [15],
      topics: f.topics.split("\n").map((x) => x.trim()).filter(Boolean),
      attachments,
      roster: pool, recipientIds: recipients,
      visibility: f.visibility,
    };
    try {
      let notified = 0;
      if (multi) {
        // One one-time meeting per selected day, created SILENTLY, then a single
        // consolidated notice for the whole batch (not one per day).
        const ids = [];
        for (const d of dates) {
          const r = await api.createSchedule({ ...base, recurrence: { freq: "once", weekday: 0, nth: 1, date: d }, startDate: "", endDate: "", silent: true });
          if (r?.id) ids.push(r.id);
        }
        const nb = await api.notifyBatch(ids).catch(() => null);
        notified = nb?.pushed || 0;
      } else {
        const r = await api.createSchedule({
          ...base,
          recurrence: { freq: f.freq, weekday: Number(f.weekday), nth: Number(f.nth), date: f.date },
          startDate: f.freq === "once" ? "" : f.startDate,
          endDate: f.freq === "once" ? "" : f.endDate,
        });
        notified = r?.notify?.count || 0;
      }
      setF({ ...f, title: "" }); setAttachments([]);
      alert(notified > 0 ? t("sched.notified", { count: notified }) : t("sched.notifyNone"));
      onCreated(); onClose();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const selStyle = { ...input, appearance: "auto" };
  return (
    <div>
      <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 500 }}>{editing ? t("hostcal.editTitle") : multi ? t("sched.createTitleMulti", { n: dates.length }) : t("sched.createTitle")}</h3>

      <label style={label}>{t("sched.title")}</label>
      <input style={input} value={f.title} onChange={set("title")} placeholder={t("sched.titlePlaceholder")} autoFocus />
      <div style={{ height: 14 }} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}><label style={label}>{t("label.location")}</label><input style={input} value={f.location} onChange={set("location")} placeholder={t("sched.locPlaceholder")} /></div>
        <div style={{ flex: "1 1 200px" }}><label style={label}>{t("label.hostFull")}</label><input style={input} value={f.host} onChange={set("host")} placeholder={t("sched.hostPlaceholder")} /></div>
      </div>
      <div style={{ height: 14 }} />
      <label style={label}>🔗 {t("label.online")}</label>
      <input style={input} type="url" inputMode="url" value={f.onlineUrl} onChange={set("onlineUrl")} placeholder={t("sched.onlinePlaceholder")} />

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.visibility")}</label>
      <div style={{ display: "flex", gap: 8 }}>
        {[["public", t("sched.public")], ["private", t("sched.private")]].map(([val, lbl]) => {
          const on = f.visibility === val;
          return (
            <button key={val} type="button" onClick={() => setF((p) => ({ ...p, visibility: val }))}
              style={{ flex: 1, height: 38, fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: "pointer", border: on ? "none" : "0.5px solid rgba(0,0,0,.25)", background: on ? ACCENT : "transparent", color: on ? "#fff" : "var(--color-text-primary)" }}>
              {val === "private" ? "🔒 " : "🌐 "}{lbl}
            </button>
          );
        })}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{f.visibility === "private" ? t("sched.privateHint") : t("sched.publicHint")}</p>

      <div style={{ height: 14 }} />
      {editing ? (
        <>
          <label style={label}>{t("hostcal.editDate")}</label>
          <input type="date" style={{ ...selStyle }} value={f.date} onChange={set("date")} />
        </>
      ) : multi ? (
        <>
          <label style={label}>{t("sched.selectedDates", { n: dates.length })}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {dates.map((d) => (
              <span key={d} style={{ padding: "4px 10px", fontSize: 13, borderRadius: 999, background: ACCENT + "1A", color: ACCENT, fontWeight: 500 }}>{d}</span>
            ))}
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

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

      {!editing ? (
        <>
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
        </>
      ) : null}

      <div style={{ height: 14 }} />
      <label style={label}>{t("sched.recipientsLabel", { a: recipients.length, b: pool.length })}</label>
      <RecipientPicker pool={pool} recipients={recipients} setRecipients={setRecipients} />

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

      {conflicts.length ? (
        <>
          <div style={{ height: 14 }} />
          <div style={{ padding: "12px 14px", borderRadius: 10, background: AMBER + "12", border: `0.5px solid ${AMBER}44` }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: AMBER }}>⚠ {t("sched.conflictTitle")}</p>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-secondary)" }}>{t("sched.conflictDesc")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {conflicts.map((c) => (
                <div key={c.name} style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 2 }}>
                    {c.conflicts.map((x, i) => (
                      <span key={i} style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        ・{x.title || "（未命名會議）"}　<span style={{ color: AMBER, fontWeight: 500 }}>{multi || editing ? `${x.date} ` : ""}{x.startTime}{x.endTime ? `–${x.endTime}` : ""}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("sched.conflictNote")}</p>
          </div>
        </>
      ) : checkingConflicts ? (
        <><div style={{ height: 10 }} /><p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("sched.conflictChecking")}</p></>
      ) : null}

      <div style={{ height: 18 }} />
      <div style={{ display: "flex", gap: 8 }}>
        {(() => { const badTime = !!f.endTime && f.startTime >= f.endTime; return (
          <button onClick={create} disabled={saving || badTime} style={{ ...btn(true), flex: 1, opacity: saving || badTime ? 0.5 : 1 }}>
            {editing ? (saving ? t("hostcal.editSaving") : t("hostcal.editSave")) : saving ? t("sched.creating") : multi ? t("sched.createMulti", { n: dates.length }) : t("sched.create")}
          </button>
        ); })()}
        <button onClick={onClose} style={{ ...btn(false), flex: "0 0 100px" }}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

// Recipient multi-select shown as a dropdown: a summary button that expands an
// inline, searchable checklist with select-all / clear. Scales to many members
// (scrolls) far better than a flat row of toggle chips.
export function RecipientPicker({ pool, recipients, setRecipients }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  if (pool.length === 0) {
    return <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("sched.noMembers")}</p>;
  }

  const sel = recipients.length;
  const all = pool.length;
  const query = q.trim().toLowerCase();
  const filtered = query ? pool.filter((p) => `${p.name} ${p.dept}`.toLowerCase().includes(query)) : pool;
  const toggle = (id) => setRecipients((r) => r.includes(id) ? r.filter((x) => x !== id) : [...r, id]);
  const summary = sel === 0 ? t("sched.recipientsNone")
    : sel === all ? t("sched.recipientsAll", { n: all })
    : pool.filter((p) => recipients.includes(p.id)).map((p) => p.name).join("、");

  const rowCheck = (on) => ({
    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
    border: on ? "none" : "1px solid rgba(0,0,0,.3)", background: on ? ACCENT : "transparent",
    color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12,
  });

  return (
    <div>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...input, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel ? "var(--color-text-primary)" : "var(--color-text-tertiary,#999)" }}>{summary}</span>
        <span style={{ flexShrink: 0, fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{sel}/{all} {open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div style={{ marginTop: 6, border: "0.5px solid rgba(0,0,0,.2)", borderRadius: 10, background: "#fff", overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, padding: 8, borderBottom: "0.5px solid rgba(0,0,0,.1)", alignItems: "center" }}>
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("sched.searchRecipients")}
              style={{ ...input, height: 34, flex: 1 }}
            />
            <button type="button" onClick={() => setRecipients(pool.map((p) => p.id))} style={{ ...btn(false), height: 34, fontSize: 12, whiteSpace: "nowrap" }}>{t("sched.selectAll")}</button>
            <button type="button" onClick={() => setRecipients([])} style={{ ...btn(false), height: 34, fontSize: 12, whiteSpace: "nowrap" }}>{t("sched.clearAll")}</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <p style={{ margin: 0, padding: "12px", fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("sched.noMatch")}</p>
            ) : filtered.map((p) => {
              const on = recipients.includes(p.id);
              return (
                <button
                  key={p.id} type="button" onClick={() => toggle(p.id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "none", borderTop: "0.5px solid rgba(0,0,0,.06)", background: on ? ACCENT + "0F" : "transparent", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={rowCheck(on)}>{on ? "✓" : ""}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                    {p.dept && p.dept !== "—" ? <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>{p.dept}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
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
