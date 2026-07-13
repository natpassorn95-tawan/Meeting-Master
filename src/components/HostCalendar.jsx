import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, BROWN, AMBER, card, btn, pill, softBtn } from "../ui.js";
import { useT, fmtDateTimeI18n } from "../i18n.jsx";
import { CreateForm } from "./Schedules.jsx";

// Removed meetings auto-purge after this long untouched (mirrors the server's
// REMOVED_TTL_MS in server/store.js). Used only to render the countdown.
const REMOVED_TTL_MS = 10 * 24 * 60 * 60 * 1000; // 10 days

const WD = { zh: ["日", "一", "二", "三", "四", "五", "六"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Expand an inclusive [a, b] date range (YYYY-MM-DD) into individual days.
function expandRange(a, b) {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const out = [];
  const d = new Date(`${s}T00:00:00`);
  const end = new Date(`${e}T00:00:00`);
  while (d <= end) { out.push(ymd(d.getFullYear(), d.getMonth(), d.getDate())); d.setDate(d.getDate() + 1); }
  return out;
}

// Host page — the single admin operations surface. A month calendar of meetings
// (created instances + projected occurrences of recurring schedules). Click a
// day to select it, or press-and-drag across several days to select a range.
// The day panel shows the selected day(s)' events — each can be edited or opened
// (attendee dashboard; cancel/delete live inside the dashboard) — and a
// "Schedule" button opens a popup that creates a meeting on the selected day
// (or one on each day of a multi-day selection). Below sit the
// recurring-schedule manager and the Cancelled + Deleted folders.
export default function HostCalendar({ go }) {
  const { t, lang } = useT();
  const [events, setEvents] = useState(null);
  const [cancelled, setCancelled] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDates, setCreateDates] = useState([]);
  const [editMeeting, setEditMeeting] = useState(null); // { id, meeting } for the edit popup
  const today = new Date();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const [cur, setCur] = useState({ y: today.getFullYear(), m: today.getMonth() });
  // Selected range (start === end for a single day) + live drag state.
  const [range, setRange] = useState({ start: todayStr, end: todayStr });
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async () => {
    // Fetch a wide window once: last month → +12 months.
    const from = ymd(today.getFullYear(), today.getMonth() - 1, 1);
    const to = ymd(today.getFullYear() + 1, today.getMonth(), 28);
    try {
      const [evs, canc, del] = await Promise.all([
        api.getCalendar(from, to),
        api.listCancelledMeetings().catch(() => []),
        api.listDeletedMeetings().catch(() => []),
      ]);
      setEvents(evs);
      setCancelled(canc);
      setDeleted(del);
      return evs;
    } catch (e) { setError(e.message); return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load().then((evs) => {
      if (!evs || !evs.length) return;
      const upcoming = evs.map((e) => e.date).filter((d) => d >= todayStr).sort()[0] || evs.map((e) => e.date).sort().pop();
      if (upcoming) {
        const [y, mo] = upcoming.split("-").map(Number);
        setCur({ y, m: mo - 1 });
        setRange({ start: upcoming, end: upcoming });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // End a drag wherever the pointer is released (even off the grid).
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDragging(false);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => { window.removeEventListener("mouseup", end); window.removeEventListener("touchend", end); };
  }, [dragging]);

  async function open(ev) {
    if (ev.type === "meeting") return go("host", { m: ev.id, board: "1" });
    setBusy(true);
    try {
      const m = await api.materialize(ev.scheduleId, ev.occKey);
      go("host", { m: m.id, board: "1" });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function act(fn) {
    setBusy(true); setError("");
    try { await fn(); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // A projected schedule occurrence has no meeting id yet — materialise it first
  // so it can be edited as a concrete meeting.
  async function meetingIdOf(ev) {
    if (ev.type === "meeting") return ev.id;
    const m = await api.materialize(ev.scheduleId, ev.occKey);
    return m.id;
  }

  async function editEvent(ev) {
    setBusy(true); setError("");
    try {
      const id = await meetingIdOf(ev);
      const m = await api.getMeeting(id);
      setEditMeeting({ id, meeting: m });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // Drag-select handlers (mouse + touch).
  function dayDown(ds) { setDragging(true); setRange({ start: ds, end: ds }); }
  function dayEnter(ds) { if (dragging) setRange((r) => ({ ...r, end: ds })); }
  function gridTouchMove(e) {
    if (!dragging) return;
    const tch = e.touches[0];
    if (!tch) return;
    const el = document.elementFromPoint(tch.clientX, tch.clientY);
    const dayEl = el && el.closest ? el.closest("[data-day]") : null;
    if (dayEl) setRange((r) => ({ ...r, end: dayEl.getAttribute("data-day") }));
  }

  if (error && events === null) return <p style={{ color: RED }}>⚠ {error}</p>;
  if (events === null) return <p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>;

  const byDate = {};
  for (const e of events) (byDate[e.date] ||= []).push(e);

  const first = new Date(cur.y, cur.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = new Date(cur.y, cur.m, 1).toLocaleDateString(lang === "en" ? "en-US" : "zh-TW", { year: "numeric", month: "long" });
  const shift = (delta) => { const d = new Date(cur.y, cur.m + delta, 1); setCur({ y: d.getFullYear(), m: d.getMonth() }); };

  const rs = range.start <= range.end ? range.start : range.end;
  const re = range.start <= range.end ? range.end : range.start;
  const inRange = (ds) => ds >= rs && ds <= re;
  const selectedDates = expandRange(rs, re);
  const multiSel = selectedDates.length > 1;
  const dayEvents = events.filter((e) => inRange(e.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Cancelled + deleted merged into one "removed" list, tagged by origin so
  // Restore hits the right endpoint. Most-recently-dated first.
  const removed = [
    ...cancelled.map((m) => ({ ...m, _kind: "cancelled" })),
    ...deleted.map((m) => ({ ...m, _kind: "deleted" })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  function openCreate() { setCreateDates(selectedDates); setCreateOpen(true); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>📅 {t("hostcal.title")}</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{t("hostcal.desc")}</p>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: ACCENT + "26", border: `1px solid ${ACCENT}` }} /> {t("hostcal.legendUpcoming")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: BROWN + "26", border: `1px solid ${BROWN}` }} /> {t("hostcal.legendPassed")}
          </span>
        </p>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={() => shift(-1)} style={{ ...btn(false), height: 32, width: 36, fontSize: 16, padding: 0 }}>‹</button>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{monthLabel}</div>
          <button onClick={() => shift(1)} style={{ ...btn(false), height: 32, width: 36, fontSize: 16, padding: 0 }}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
          {WD[lang].map((w, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-tertiary,#999)", padding: "4px 0" }}>{w}</div>
          ))}
        </div>
        <div
          onTouchMove={gridTouchMove}
          style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, touchAction: "none", userSelect: "none" }}
        >
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const ds = ymd(cur.y, cur.m, d);
            const evs = byDate[ds] || [];
            const has = evs.length > 0;
            const tone = ds < todayStr ? BROWN : ACCENT; // passed (brown) vs current/upcoming (purple)
            const isSel = inRange(ds);
            const isToday = ds === todayStr;
            return (
              <button
                key={i}
                data-day={ds}
                onMouseDown={(e) => { e.preventDefault(); dayDown(ds); }}
                onMouseEnter={() => dayEnter(ds)}
                onTouchStart={() => dayDown(ds)}
                style={{
                  aspectRatio: "1 / 1", border: isToday ? `1.5px solid ${ACCENT}` : "0.5px solid rgba(0,0,0,.08)",
                  borderRadius: 8, cursor: "pointer",
                  background: isSel ? tone : (has ? tone + "26" : "transparent"),
                  color: isSel ? "#fff" : (has ? tone : "var(--color-text-primary)"),
                  fontWeight: has ? 600 : 400,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                }}
              >
                <span style={{ fontSize: 14 }}>{d}</span>
                {evs.length > 1 ? (
                  <span style={{
                    fontSize: 10, lineHeight: 1, fontWeight: 700, marginTop: 1,
                    padding: "1px 5px", borderRadius: 999,
                    background: isSel ? "rgba(255,255,255,.3)" : tone,
                    color: "#fff",
                  }}>{evs.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("hostcal.dragHint")}</p>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
            {multiSel
              ? `${rs} → ${re} · ${t("hostcal.daysSelected", { n: selectedDates.length })}`
              : `${rs}${rs === todayStr ? ` · ${t("attendee.today")}` : ""}`}
          </h3>
          <button onClick={openCreate} disabled={busy} style={{ ...btn(true), height: 32, fontSize: 12 }}>
            {multiSel ? t("hostcal.scheduleOnDays", { n: selectedDates.length }) : t("hostcal.scheduleOnDay")}
          </button>
        </div>
        {error ? <p style={{ margin: "0 0 10px", fontSize: 13, color: RED }}>⚠ {error}</p> : null}
        {dayEvents.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{events.length ? t("attendee.noMeetingsDay") : t("attendee.selectDay")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dayEvents.map((ev, idx) => (
              <EventRow key={idx} ev={ev} past={ev.date < todayStr} t={t} lang={lang} busy={busy} onOpen={open} onEdit={editEvent} />
            ))}
          </div>
        )}
      </div>

      {/* Folder: removed meetings — cancelled + deleted merged, one Restore each */}
      <div style={card}>
        <FolderHeader label={t("hostcal.removedFolder")} count={removed.length} tone={BROWN} open={showRemoved} onToggle={() => setShowRemoved((v) => !v)} />
        {showRemoved ? (
          removed.length === 0 ? (
            <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{t("hostcal.emptyRemoved")}</p>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>ⓘ {t("hostcal.removedNote")}</p>
              {removed.map((m) => (
                <TrashRow key={`${m._kind}-${m.id}`} m={m} t={t} lang={lang} busy={busy}
                  onRestore={() => act(() => m._kind === "cancelled" ? api.restoreCancelled(m.id) : api.restoreMeeting(m.id))} />
              ))}
            </div>
          )
        ) : null}
      </div>

      {/* Schedule popup */}
      {createOpen ? (
        <div
          onClick={() => setCreateOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 12px", zIndex: 1000, overflowY: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "100%", maxWidth: 560, margin: 0 }}>
            <CreateForm
              dates={createDates}
              onCreated={load}
              onClose={() => setCreateOpen(false)}
              setError={setError}
            />
          </div>
        </div>
      ) : null}

      {/* Edit popup */}
      {editMeeting ? (
        <div onClick={() => setEditMeeting(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 12px", zIndex: 1000, overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "100%", maxWidth: 560, margin: 0 }}>
            <CreateForm editMeeting={editMeeting.meeting} editId={editMeeting.id} onCreated={load} onClose={() => setEditMeeting(null)} setError={setError} />
          </div>
        </div>
      ) : null}
    </div>
  );
}


function FolderHeader({ label, count, tone, open, onToggle }) {
  return (
    <button onClick={onToggle} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", padding: 0 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {label}
        <span style={{ ...pill(tone + "16", tone), minWidth: 22, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      </span>
      <span style={{ color: "var(--color-text-tertiary,#999)", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
    </button>
  );
}

function TrashRow({ m, t, lang, busy, onRestore }) {
  const kind = m._kind === "cancelled"
    ? { label: t("hostcal.tagCancelled"), tone: RED }
    : { label: t("hostcal.tagDeleted"), tone: BROWN };
  // Auto-purge countdown: 10 days from when it was removed.
  const removedAt = m.cancelledAt || m.deletedAt || 0;
  const msLeft = removedAt + REMOVED_TTL_MS - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);
  const purgeLabel = daysLeft <= 1 ? t("hostcal.autoPurgeSoon") : t("hostcal.autoPurgeIn", { n: daysLeft });
  const purgeTone = daysLeft <= 3 ? RED : AMBER;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 12px", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 10, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {m.title || "（未命名會議）"}
          <span style={pill(kind.tone + "16", kind.tone)}>{kind.label}</span>
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-tertiary,#999)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{fmtDateTimeI18n(m.date, m.startTime, m.endTime, lang)}{m.location ? `・${m.location}` : ""}</span>
          {removedAt ? <span style={pill(purgeTone + "16", purgeTone)}>⏳ {purgeLabel}</span> : null}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onRestore} disabled={busy} style={{ ...softBtn(GREEN), opacity: busy ? 0.5 : 1 }}>↩ {t("hostcal.restore")}</button>
      </div>
    </div>
  );
}

function EventRow({ ev, past, t, lang, busy, onOpen, onEdit }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 12px", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 10, flexWrap: "wrap", background: "#fff" }}>
      <button onClick={() => onOpen(ev)} disabled={busy} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{ev.title || "（未命名會議）"}</span>
          {past
            ? <span style={pill(BROWN + "22", BROWN)}>{t("hostcal.legendPassed")}</span>
            : <span style={pill(ACCENT + "1F", ACCENT)}>{t("hostcal.legendUpcoming")}</span>}
        </span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {fmtDateTimeI18n(ev.date, ev.startTime, ev.endTime, lang)}{ev.location ? `・${ev.location}` : ""}
          {"  "}<span style={{ ...pill("#EDEBF7", ACCENT), marginLeft: 6 }}>{ev.count} 人</span>
        </span>
      </button>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!past ? (
          <button onClick={() => onEdit(ev)} disabled={busy} style={{ ...softBtn(ACCENT), opacity: busy ? 0.5 : 1 }}>{t("hostcal.editEvent")}</button>
        ) : null}
        <span onClick={() => !busy && onOpen(ev)} style={{ ...btn(true), height: 32, fontSize: 13, display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer" }}>{t("hostcal.open")}</span>
      </div>
    </div>
  );
}
