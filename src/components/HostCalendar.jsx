import React, { useState, useEffect } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, AMBER, card, btn, pill } from "../ui.js";
import { useT, fmtDateTimeI18n } from "../i18n.jsx";

const WD = { zh: ["日", "一", "二", "三", "四", "五", "六"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Host page: month calendar of meetings — both created instances and projected
// upcoming occurrences of recurring schedules. Clicking one opens its Host
// dashboard (materialising a scheduled occurrence on demand).
export default function HostCalendar({ go }) {
  const { t, lang } = useT();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const [cur, setCur] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(todayStr);

  useEffect(() => {
    // Fetch a wide window once: last month → +12 months.
    const from = ymd(today.getFullYear(), today.getMonth() - 1, 1);
    const to = ymd(today.getFullYear() + 1, today.getMonth(), 28);
    api.getCalendar(from, to)
      .then((evs) => {
        setEvents(evs);
        const upcoming = evs.map((e) => e.date).filter((d) => d >= todayStr).sort()[0] || evs.map((e) => e.date).sort().pop();
        if (upcoming) {
          const [y, mo] = upcoming.split("-").map(Number);
          setCur({ y, m: mo - 1 });
          setSelected(upcoming);
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(ev) {
    if (ev.type === "meeting") return go("host", { m: ev.id, board: "1" });
    setBusy(true);
    try {
      const m = await api.materialize(ev.scheduleId, ev.occKey);
      go("host", { m: m.id, board: "1" });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error) return <p style={{ color: RED }}>⚠ {error}</p>;
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

  const dayEvents = byDate[selected] || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>📅 {t("hostcal.title")}</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{t("hostcal.desc")}</p>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: ACCENT + "26", border: `1px solid ${ACCENT}` }} /> {t("hostcal.legendMeeting")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: AMBER + "26", border: `1px solid ${AMBER}` }} /> {t("hostcal.legendScheduled")}
          </span>
        </p>
      </div>

      {events.length === 0 ? (
        <div style={card}><p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{t("hostcal.none")}</p></div>
      ) : null}

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const ds = ymd(cur.y, cur.m, d);
            const evs = byDate[ds] || [];
            const created = evs.filter((e) => e.type === "meeting").length;
            const has = evs.length > 0;
            const tone = created ? ACCENT : AMBER; // created (purple) dominates a mixed day
            const isSel = ds === selected;
            const isToday = ds === todayStr;
            return (
              <button
                key={i}
                onClick={() => setSelected(ds)}
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
                  <span style={{ display: "flex", gap: 2, marginTop: 1, height: 4 }}>
                    {evs.slice(0, 5).map((e, k) => (
                      <span key={k} style={{ width: 4, height: 4, borderRadius: "50%", background: isSel ? "#fff" : (e.type === "meeting" ? ACCENT : AMBER) }} />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 500 }}>{selected}{selected === todayStr ? ` · ${t("attendee.today")}` : ""}</h3>
        {dayEvents.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{events.length ? t("attendee.noMeetingsDay") : t("attendee.selectDay")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dayEvents.map((ev, idx) => (
              <button key={idx} onClick={() => open(ev)} disabled={busy} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 12px", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 10, flexWrap: "wrap", background: "#fff", cursor: "pointer", textAlign: "left", width: "100%" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{ev.title || "（未命名會議）"}</p>
                    {ev.type === "scheduled"
                      ? <span style={pill("#FFF6E5", AMBER)}>{t("hostcal.tagScheduled")}</span>
                      : <span style={pill("#E1F5EE", GREEN)}>{t("hostcal.tagCreated")}</span>}
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {fmtDateTimeI18n(ev.date, ev.startTime, ev.endTime, lang)}{ev.location ? `・${ev.location}` : ""}
                    {"  "}<span style={{ ...pill("#EDEBF7", ACCENT), marginLeft: 6 }}>{ev.count} 人</span>
                  </p>
                </div>
                <span style={{ ...btn(true), height: 32, fontSize: 12, display: "inline-flex", alignItems: "center" }}>{t("hostcal.open")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
