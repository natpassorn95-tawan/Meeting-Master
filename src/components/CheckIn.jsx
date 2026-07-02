import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, card, input, btn, pill, avatar } from "../ui.js";
import { useT } from "../i18n.jsx";
import { liffConfigured, getLiffProfile } from "../liff.js";

const NAME_KEY = "mm_name";
const fmtTime = (ms) => new Date(ms).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

// Meeting check-in (報到): the attendee taps to check in, and sees a live list
// of who has joined. Opened from the check-in button sent at meeting start.
export default function CheckIn({ meetingId, userId }) {
  const { t } = useT();
  const [meeting, setMeeting] = useState(null);
  const [data, setData] = useState(null); // /responses
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Resolve identity from the LINE userId (link) or LIFF → member name.
  useEffect(() => {
    if (name) return;
    const resolve = async (uid) => {
      if (!uid) return;
      const m = await api.getMember(uid).catch(() => null);
      if (m && m.name) { try { localStorage.setItem(NAME_KEY, m.name); } catch { /* ignore */ } setName(m.name); }
    };
    if (userId) resolve(userId);
    else if (liffConfigured()) getLiffProfile().then((p) => p && resolve(p.userId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => { api.getMeeting(meetingId).then(setMeeting).catch((e) => setError(e.message)); }, [meetingId]);

  const load = useCallback(async () => {
    try { setData(await api.getResponses(meetingId)); } catch (e) { setError(e.message); }
  }, [meetingId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 3000); return () => clearInterval(id); }, [load]); // real-time

  async function doCheckIn() {
    setBusy(true); setError("");
    try { await api.checkin(meetingId, name); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error) return <Shell><p style={{ color: RED }}>⚠ {error}</p></Shell>;
  if (!meeting) return <Shell><p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p></Shell>;

  const me = data?.responses?.find((r) => r.name === name);
  const checkedIn = (data?.responses || []).filter((r) => r.checkedInAt).sort((a, b) => a.checkedInAt - b.checkedInAt);
  const total = data?.roster?.length || 0;
  // Check-in is only open during the meeting period (start → end); locked otherwise.
  const startMs = Date.parse(`${meeting.date}T${meeting.startTime || "00:00"}:00`);
  const endMs = meeting.endTime ? Date.parse(`${meeting.date}T${meeting.endTime}:00`) : (Number.isFinite(startMs) ? startMs + 2 * 3600 * 1000 : NaN);
  const now = Date.now();
  const notStarted = Number.isFinite(startMs) && now < startMs;
  const ended = Number.isFinite(endMs) && now > endMs;
  const open = !notStarted && !ended;

  return (
    <Shell>
      <div style={{ borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,.1)", background: "#fff", marginBottom: 16 }}>
        <div style={{ background: ACCENT, color: "#fff", padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9 }}>🙋 {t("checkin.title")}</div>
          <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{meeting.title || "（未命名會議）"}</div>
          <div style={{ fontSize: 13, opacity: 0.95, marginTop: 4 }}>{meeting.datetime}{meeting.location ? `・${meeting.location}` : ""}</div>
        </div>
        <div style={{ padding: "18px" }}>
          {(ended || notStarted) && !me?.checkedInAt ? (
            <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(0,0,0,.06)", color: "#888", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 12px" }}>🔒</div>
              <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 500 }}>{ended ? t("checkin.closed") : t("checkin.notOpen")}</p>
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{meeting.datetime}</p>
            </div>
          ) : !name ? (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("checkin.whoAreYou")}</p>
              {data?.roster?.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {data.roster.map((p) => (
                    <button key={p.id} onClick={() => { try { localStorage.setItem(NAME_KEY, p.name); } catch { /* ignore */ } setName(p.name); }}
                      style={{ height: 38, padding: "0 16px", fontSize: 14, fontWeight: 500, borderRadius: 999, cursor: "pointer", border: "0.5px solid rgba(0,0,0,.25)", background: "transparent", color: "var(--color-text-primary)" }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("checkin.notListed")}</p>
              <input style={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("manage.name")} onKeyDown={(e) => { if (e.key === "Enter") { const n = draft.trim(); if (n) { localStorage.setItem(NAME_KEY, n); setName(n); } } }} />
              <div style={{ height: 12 }} />
              <button onClick={() => { const n = draft.trim(); if (n) { localStorage.setItem(NAME_KEY, n); setName(n); } }} disabled={!draft.trim()} style={{ ...btn(true), width: "100%", opacity: draft.trim() ? 1 : 0.4 }}>{t("mymeetings.continue")}</button>
            </>
          ) : me?.checkedInAt ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E1F5EE", color: GREEN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 12px" }}>✓</div>
              <p style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 500 }}>{t("checkin.done")}</p>
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{name}・{fmtTime(me.checkedInAt)}</p>
            </div>
          ) : (
            <>
              <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("checkin.greeting", { name })}</p>
              <button onClick={doCheckIn} disabled={busy} style={{ ...btn(true), width: "100%", height: 48, fontSize: 16, opacity: busy ? 0.5 : 1 }}>{busy ? t("checkin.checking") : t("checkin.button")}</button>
            </>
          )}
          {error ? <p style={{ margin: "10px 0 0", fontSize: 13, color: RED }}>⚠ {error}</p> : null}
        </div>
      </div>

      {/* Real-time join list */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{t("checkin.liveTitle")}</h3>
          <span style={{ fontSize: 22, fontWeight: 600, color: ACCENT }}>{checkedIn.length}<span style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 400 }}> / {total}</span></span>
        </div>
        {checkedIn.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{t("checkin.none")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {checkedIn.map((r, i) => {
              const a = avatar(r.name, i);
              return (
                <div key={r.participantId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderTop: i === 0 ? "none" : "0.5px solid rgba(0,0,0,.08)" }}>
                  <div style={a.wrap}>{a.letter}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{r.name}{r.name === name ? <span style={{ ...pill("#EDEBF7", ACCENT), marginLeft: 6 }}>{t("checkin.you")}</span> : null}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{r.dept}</p>
                  </div>
                  <span style={{ fontSize: 13, color: GREEN }}>🙋 {fmtTime(r.checkedInAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return <div style={{ maxWidth: 480, margin: "0 auto" }}>{children}</div>;
}
