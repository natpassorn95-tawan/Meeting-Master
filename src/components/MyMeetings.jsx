import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, card, label, input, btn, pill, LEAVE_TYPES } from "../ui.js";
import { useT, fmtDateTimeI18n } from "../i18n.jsx";
import { liffConfigured, getLiffProfile } from "../liff.js";
import { attIcon } from "./Schedules.jsx";

const NAME_KEY = "mm_name";
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Participant self-service: review upcoming meetings (including recurring
// occurrences) and confirm attendance or take leave per day.
// `userId` (from the LINE keyword link ?u=…) lets us resolve their name
// automatically so they're never asked to pick it.
export default function MyMeetings({ userId }) {
  const { t, lang } = useT();
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } });
  const [draft, setDraft] = useState("");

  // Resolve identity from the LINE userId (link param) or LIFF → member name.
  useEffect(() => {
    if (name) return;
    const useUserId = async (uid) => {
      if (!uid) return;
      const m = await api.getMember(uid).catch(() => null);
      if (m && m.name) { try { localStorage.setItem(NAME_KEY, m.name); } catch { /* ignore */ } setName(m.name); }
    };
    if (userId) useUserId(userId);
    else if (liffConfigured()) getLiffProfile().then((p) => p && useUserId(p.userId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [summary, setSummary] = useState(null);
  const todayStr = localToday();
  // Date-range filter. Default to TODAY (the LINE "我的會議" entry lands here); a
  // multi-day range is supported via the two date inputs; "All" clears both.
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(todayStr);
  // Label for the stats period: a month when "All", a single date, or a range.
  const periodLabel = !from ? todayStr.slice(0, 7) : (to && to !== from ? `${from} → ${to}` : from);

  const load = useCallback(async () => {
    if (!name) return;
    try {
      const d = from ? await api.myMeetings(name, from, to || from) : await api.myMeetings(name);
      setItems(d.items);
    } catch (e) { setError(e.message); }
  }, [name, from, to]);
  useEffect(() => { load(); }, [load]);
  // Poll so check-in status / cancellations reflect without a manual refresh.
  useEffect(() => { const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);

  // Performance over the selected window (range), or the current month when "All".
  useEffect(() => {
    if (!name) return;
    const p = from ? api.mySummaryRange(name, from, to || from) : api.mySummary(name, todayStr.slice(0, 7));
    p.then(setSummary).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, from, to, items]);

  const keyOf = (it) => it.meetingId || `${it.scheduleId}__${it.occKey}`;

  async function setRsvp(it, value, leaveReason) {
    setBusyKey(keyOf(it)); setError("");
    try {
      await api.myMeetingsRsvp({ name, value, leaveReason, meetingId: it.meetingId, scheduleId: it.scheduleId, occKey: it.occKey });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusyKey(""); }
  }

  async function checkout(it) {
    setBusyKey(keyOf(it)); setError("");
    try {
      let mid = it.meetingId;
      if (!mid && it.scheduleId && it.occKey) { const m = await api.materialize(it.scheduleId, it.occKey); mid = m.id; }
      if (mid) { await api.checkout(mid, name); await load(); }
    } catch (e) { setError(e.message); }
    finally { setBusyKey(""); }
  }

  function commit() {
    const n = draft.trim();
    if (!n) return;
    try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
    setName(n);
  }

  if (!name) {
    return (
      <Shell>
        <div style={card}>
          <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 500 }}>🗓 {t("mymeetings.title")}</h2>
          <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("mymeetings.whoAreYou")}</p>
          <input style={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("manage.name")} onKeyDown={(e) => e.key === "Enter" && commit()} />
          <div style={{ height: 12 }} />
          <button onClick={commit} disabled={!draft.trim()} style={{ ...btn(true), width: "100%", opacity: draft.trim() ? 1 : 0.4 }}>{t("mymeetings.continue")}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>🗓 {t("mymeetings.title")}</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
          {t("mymeetings.desc")}
          <span style={{ marginLeft: 8 }}>· {name}</span>
          <button onClick={() => { try { localStorage.removeItem(NAME_KEY); } catch { /* ignore */ } setName(""); setItems(null); }} style={{ marginLeft: 8, fontSize: 12, border: "none", background: "transparent", color: ACCENT, cursor: "pointer" }}>{t("invite.switchId")}</button>
        </p>
      </div>

      {/* Date filter — single day or a multi-day range (drives the list + stats) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{t("mymeetings.filter")}</span>
        <button onClick={() => { setFrom(""); setTo(""); }} style={{ height: 32, padding: "0 14px", fontSize: 13, borderRadius: 999, cursor: "pointer", border: from ? "0.5px solid rgba(0,0,0,.25)" : "none", background: from ? "transparent" : ACCENT, color: from ? "var(--color-text-primary)" : "#fff" }}>{t("mymeetings.all")}</button>
        <input type="date" value={from} onChange={(e) => { const v = e.target.value; setFrom(v); if (v && (!to || to < v)) setTo(v); }} style={{ ...input, width: "auto", height: 32, appearance: "auto" }} />
        <span style={{ color: "var(--color-text-tertiary,#999)" }}>–</span>
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} disabled={!from} style={{ ...input, width: "auto", height: 32, appearance: "auto", opacity: from ? 1 : 0.5 }} />
      </div>

      {error ? <div style={{ ...card, marginBottom: 12, borderColor: RED, color: RED, fontSize: 14 }}>⚠ {error}</div> : null}

      {items === null ? (
        <p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div style={card}><p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{t("mymeetings.none")}</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((it) => <Row key={keyOf(it)} it={it} t={t} lang={lang} busy={busyKey === keyOf(it)} onSet={setRsvp} onCheckout={checkout} userId={userId} />)}
        </div>
      )}

      {/* Monthly performance dashboard — at the bottom (resets per month; pick any month) */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>📊 {t("perf.title")}</h3>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{periodLabel}</span>
        </div>
        {summary ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            <Stat n={summary.sessions} label={t("perf.sessions")} color={ACCENT} />
            <Stat n={`${summary.hours}h`} label={t("perf.hours")} color={summary.overWarning ? RED : "#0F6E56"} sub={summary.overWarning ? t("perf.overWarning", { h: summary.warningHours }) : null} />
            <Stat n={`${summary.attendanceRate}%`} label={t("perf.attendance")} color={ACCENT} />
            <Stat n={summary.absentNoLeave} label={t("perf.absentNoLeave")} color={summary.absentNoLeave > 0 ? RED : "#888"} />
          </div>
        ) : <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("common.loading")}</p>}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return <div style={{ maxWidth: 480, margin: "0 auto" }}>{children}</div>;
}

function Stat({ n, label, color, sub }) {
  return (
    <div style={{ background: "var(--color-background-secondary,#f6f6f7)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.3 }}>{label}</div>
      {sub ? <div style={{ fontSize: 11, color, marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

function Row({ it, t, lang, busy, onSet, onCheckout, userId }) {
  const isLeave = it.rsvp === "leave";
  const isYes = it.rsvp === "yes";
  const [reason, setReason] = useState(it.leaveReason?.type || LEAVE_TYPES[0]);
  const [going, setGoing] = useState(false);
  // Cancelled / deleted meetings are shown (locked) so they stay aligned with the
  // calendar; permanently-deleted ones are already filtered out server-side.
  const cancelled = it.status === "cancelled";
  const deleted = it.status === "deleted";
  const removed = cancelled || deleted;
  const checkedIn = !!it.checkedInAt; // already checked in (via any path)
  const checkedOut = !!it.checkedOutAt;
  // Meeting phase: upcoming (before start) → confirm/leave; ongoing (start→end) →
  // check-in only; ended (after end) → locked, no edits.
  const startMs = Date.parse(`${it.date}T${it.startTime || "00:00"}:00`);
  const endMs = it.endTime ? Date.parse(`${it.date}T${it.endTime}:00`) : (Number.isFinite(startMs) ? startMs + 2 * 3600 * 1000 : NaN);
  const now = Date.now();
  const ongoing = Number.isFinite(startMs) && now >= startMs && Number.isFinite(endMs) && now <= endMs;
  const ended = Number.isFinite(endMs) && now > endMs;
  // Check-out stays open until end + 1 hour; requires having checked in.
  const canCheckout = checkedIn && !checkedOut && Number.isFinite(startMs) && now >= startMs && Number.isFinite(endMs) && now <= endMs + 60 * 60 * 1000;

  // Open the check-in page (materialise the occurrence first if needed).
  async function goCheckin() {
    setGoing(true);
    let mid = it.meetingId;
    if (!mid && it.scheduleId && it.occKey) {
      try { const m = await api.materialize(it.scheduleId, it.occKey); mid = m.id; } catch { setGoing(false); return; }
    }
    if (mid) window.location.href = `/?view=checkin&m=${encodeURIComponent(mid)}${userId ? `&u=${encodeURIComponent(userId)}` : ""}`;
    else setGoing(false);
  }

  // Once a choice is made, its button is disabled (already selected); the other
  // stays clickable so they can still switch before the meeting.
  const optBtn = (active, color, text, onClick) => (
    <button onClick={onClick} disabled={busy || active} style={{ flex: 1, height: 38, fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: (busy || active) ? "default" : "pointer", border: active ? "none" : "0.5px solid rgba(0,0,0,.2)", background: active ? color : "transparent", color: active ? "#fff" : "var(--color-text-primary)", opacity: busy ? 0.6 : 1 }}>{text}</button>
  );
  return (
    <div style={{ ...card, ...((ended || removed) ? { opacity: 0.7 } : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 500, ...(removed ? { textDecoration: "line-through", color: "var(--color-text-secondary)" } : {}) }}>{it.title || "（未命名會議）"}</p>
        {cancelled ? <span style={pill("#F7E4EC", RED)}>{t("mymeetings.cancelledTag")}</span> : null}
        {deleted ? <span style={pill("rgba(0,0,0,.06)", "#888")}>{t("mymeetings.deletedTag")}</span> : null}
        {!removed && ended ? <span style={pill("rgba(0,0,0,.06)", "#888")}>{t("mymeetings.passedTag")}</span> : null}
        {!removed && ongoing ? <span style={pill(ACCENT + "1F", ACCENT)}>{t("mymeetings.ongoingTag")}</span> : null}
        {!removed && checkedOut ? <span style={pill("#EDEBF7", ACCENT)}>👋 {t("mymeetings.checkedOut")}</span> : null}
        {!removed && !checkedOut && checkedIn ? <span style={pill("#E1F5EE", GREEN)}>✓ {t("mymeetings.checkedIn")}</span> : null}
        {!removed && !checkedIn && isYes ? <span style={pill("#E1F5EE", GREEN)}>{t("mymeetings.confirmed")}</span> : null}
        {!removed && isLeave ? <span style={pill("#F7E4EC", RED)}>{t("mymeetings.onLeave")}</span> : null}
      </div>
      <p style={{ margin: "2px 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        {fmtDateTimeI18n(it.date, it.startTime, it.endTime, lang)}
        {!removed && it.recurring ? <span style={{ marginLeft: 6, fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>🔁 {t("mymeetings.nextOccurrence")}</span> : null}
      </p>
      {!removed && (it.topics?.length || it.attachments?.length) ? (
        <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--color-background-secondary,#f6f6f7)", borderRadius: 8 }}>
          {it.topics?.length ? (
            <>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>📋 {t("mymeetings.agenda")}</p>
              {it.topics.map((tp, i) => (
                <p key={i} style={{ margin: "0 0 3px", fontSize: 13, lineHeight: 1.45 }}>
                  {i + 1}. {tp.title}
                  {tp.description ? <span style={{ color: "var(--color-text-secondary)" }}>　{tp.description}</span> : null}
                </p>
              ))}
            </>
          ) : null}
          {it.attachments?.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: it.topics?.length ? 8 : 0 }}>
              {it.attachments.map((a) => (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 220, padding: "4px 9px", fontSize: 12, borderRadius: 8, border: "0.5px solid rgba(0,0,0,.18)", background: "#fff", color: "var(--color-text-primary)", textDecoration: "none" }}>
                  <span>{attIcon(a.type, a.name)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {removed ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>🚫 {cancelled ? t("mymeetings.cancelledNote") : t("mymeetings.deletedNote")}</p>
      ) : checkedOut ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 8, background: "#EDEBF7", color: ACCENT, fontSize: 15, fontWeight: 600 }}>✓ {t("mymeetings.checkedIn")}・👋 {t("mymeetings.checkedOut")}</div>
      ) : canCheckout ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 32, marginBottom: 8, borderRadius: 8, background: "#E1F5EE", color: GREEN, fontSize: 14, fontWeight: 600 }}>✓ {t("mymeetings.checkedIn")}</div>
          <button onClick={() => onCheckout(it)} disabled={busy} style={{ width: "100%", height: 46, fontSize: 15, fontWeight: 600, borderRadius: 8, border: "none", cursor: busy ? "default" : "pointer", background: ACCENT, color: "#fff", opacity: busy ? 0.6 : 1 }}>👋 {t("checkin.checkout")}</button>
        </>
      ) : checkedIn ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 8, background: "#E1F5EE", color: GREEN, fontSize: 15, fontWeight: 600 }}>✓ {t("mymeetings.checkedIn")}</div>
      ) : ongoing ? (
        <>
          <button onClick={goCheckin} disabled={going} style={{ width: "100%", height: 48, fontSize: 16, fontWeight: 600, borderRadius: 8, border: "none", cursor: going ? "default" : "pointer", background: GREEN, color: "#fff", opacity: going ? 0.6 : 1 }}>🙋 {t("checkin.button")}</button>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)", textAlign: "center" }}>{t("mymeetings.checkinHint")}</p>
        </>
      ) : ended ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("mymeetings.passed")}</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            {optBtn(isYes, GREEN, t("mymeetings.attend"), () => onSet(it, "yes"))}
            {optBtn(isLeave, RED, t("mymeetings.leave"), () => onSet(it, "leave", { type: reason, text: "" }))}
          </div>
          {isLeave ? (
            <div style={{ marginTop: 10 }}>
              <label style={label}>{t("leave.heading")}</label>
              <select style={{ ...input, appearance: "auto" }} value={reason} onChange={(e) => { setReason(e.target.value); onSet(it, "leave", { type: e.target.value, text: "" }); }}>
                {LEAVE_TYPES.map((ty) => <option key={ty} value={ty}>{t(`leaveType.${ty}`)}</option>)}
              </select>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
