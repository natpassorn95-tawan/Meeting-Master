import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, card, label, input, textarea, btn, pill, avatar, LEAVE_TYPES, STANCE_META } from "../ui.js";
import { useT } from "../i18n.jsx";
import { liffConfigured, getLiffProfile } from "../liff.js";

const pidKey = (m) => `mm_pid_${m}`;
const NAME_KEY = "mm_name"; // remembered identity across meetings (set once)

export default function Invite({ meetingId, participantId, intent, go }) {
  const { t } = useT();
  const [meeting, setMeeting] = useState(null);
  const [pid, setPid] = useState(participantId || null);
  const [resp, setResp] = useState(null);
  const [tab, setTab] = useState(intent || "confirm");
  const [error, setError] = useState("");
  const [needsRegister, setNeedsRegister] = useState(null); // userId needing registration
  const [pickerOpen, setPickerOpen] = useState(false); // name picker shown on demand (at submit)

  useEffect(() => {
    if (participantId) { setPid(participantId); localStorage.setItem(pidKey(meetingId), participantId); return; }
    const saved = localStorage.getItem(pidKey(meetingId));
    if (saved) setPid(saved);
  }, [participantId, meetingId]);

  // Already identified once (registration or an earlier pick)? Resolve them to
  // this meeting by name — and if they're not on the roster yet (e.g. they just
  // registered), auto-enroll them — so they never have to pick a name.
  useEffect(() => {
    if (pid || participantId || !meeting) return;
    const name = localStorage.getItem(NAME_KEY);
    if (!name) return;
    const match = meeting.roster.find((p) => p.name === name);
    if (match) {
      setPid(match.id);
      localStorage.setItem(pidKey(meetingId), match.id);
      return;
    }
    api.enroll(meetingId, { name, employeeId: localStorage.getItem("mm_emp") || "" })
      .then((p) => {
        setPid(p.id);
        localStorage.setItem(pidKey(meetingId), p.id);
        setMeeting((m) => (m && !m.roster.some((x) => x.id === p.id) ? { ...m, roster: [...m.roster, p] } : m));
      })
      .catch(() => {});
  }, [meeting, pid, participantId, meetingId]);

  // Inside LINE (LIFF): identify the user automatically and resolve them to a
  // roster participant via their registered member profile.
  useEffect(() => {
    if (participantId || !meeting || !liffConfigured()) return;
    let cancelled = false;
    (async () => {
      const prof = await getLiffProfile();
      if (!prof || cancelled) return;
      const member = await api.getMember(prof.userId).catch(() => null);
      if (cancelled) return;
      if (member && member.status === "registered") {
        const match = meeting.roster.find((p) => p.name === member.name);
        if (match) { setPid(match.id); localStorage.setItem(pidKey(meetingId), match.id); return; }
      } else {
        setNeedsRegister(prof.userId); // first-time → must register first
      }
    })();
    return () => { cancelled = true; };
  }, [meeting, participantId, meetingId]);

  useEffect(() => {
    api.getMeeting(meetingId).then(setMeeting).catch((e) => setError(e.message));
  }, [meetingId]);

  const loadResp = useCallback(async () => {
    if (!pid) return;
    try { const d = await api.getParticipant(meetingId, pid); setResp(d.response); }
    catch (e) { setError(e.message); }
  }, [meetingId, pid]);
  useEffect(() => { loadResp(); }, [loadResp]);

  function choose(p) {
    setPid(p.id);
    localStorage.setItem(pidKey(meetingId), p.id);
    localStorage.setItem(NAME_KEY, p.name); // remember for next time / other meetings
    setPickerOpen(false);
  }

  if (error) return <Shell><p style={{ color: RED }}>⚠ {error}</p></Shell>;
  if (!meeting) return <Shell><p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p></Shell>;

  const focused = ["confirm", "leave", "agenda"].includes(intent);

  // Inside LINE but not yet a registered member → must onboard first.
  if (!pid && needsRegister) {
    return (
      <Shell>
        <NoticeCard meeting={meeting} t={t} />
        <div style={{ ...card, marginTop: 16, textAlign: "center" }}>
          <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("invite.needRegister")}</p>
          <button onClick={() => go("register", { u: needsRegister })} style={{ ...btn(true), width: "100%" }}>{t("register.submit")}</button>
        </div>
      </Shell>
    );
  }

  // Full-page picker only for the admin "扮演" hub (no intent). When opened from
  // a LINE button, land on the action page directly — the name is asked on submit.
  if (!pid && !focused) {
    return (
      <Shell>
        <NoticeCard meeting={meeting} t={t} />
        <div style={{ ...card, marginTop: 16 }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("invite.pickName")}</p>
          <RosterList roster={meeting.roster} onPick={choose} />
        </div>
      </Shell>
    );
  }

  const me = meeting.roster.find((p) => p.id === pid);
  const active = focused ? intent : tab;
  const requireIdentity = () => setPickerOpen(true);
  const tabBtn = (key, text) => (
    <button onClick={() => setTab(key)} style={{ flex: 1, height: 38, fontSize: 13, fontWeight: 500, border: "none", borderRadius: 8, cursor: "pointer", background: active === key ? ACCENT : "transparent", color: active === key ? "#fff" : "var(--color-text-secondary)" }}>{text}</button>
  );

  return (
    <Shell>
      <NoticeCard meeting={meeting} me={me} resp={resp} t={t} />
      {focused ? <div style={{ height: 16 }} /> : (
        <div style={{ display: "flex", gap: 6, margin: "16px 0", padding: 4, borderRadius: 10, background: "#fff", border: "0.5px solid rgba(0,0,0,.12)" }}>
          {tabBtn("confirm", t("tab.confirm"))}
          {tabBtn("leave", t("tab.leave"))}
          {tabBtn("agenda", t("tab.agenda"))}
        </div>
      )}
      {active === "confirm" && <ConfirmSection {...{ meetingId, pid, resp, reload: loadResp, t, focused, requireIdentity }} />}
      {active === "leave" && <LeaveSection {...{ meetingId, pid, resp, reload: loadResp, t, requireIdentity }} />}
      {active === "agenda" && <AgendaSection {...{ meetingId, pid, meeting, resp, reload: loadResp, t, requireIdentity }} />}
      {pid ? (
        <button onClick={() => { localStorage.removeItem(pidKey(meetingId)); localStorage.removeItem(NAME_KEY); setPid(null); setResp(null); }} style={{ ...btn(false), width: "100%", height: 32, fontSize: 12, marginTop: 16 }}>{t("invite.switchId")}</button>
      ) : null}
      {pickerOpen ? <PickerOverlay roster={meeting.roster} t={t} onPick={choose} onClose={() => setPickerOpen(false)} /> : null}
    </Shell>
  );
}

function RosterList({ roster, onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {roster.map((p, i) => {
        const a = avatar(p.name, i);
        return (
          <button key={p.id} onClick={() => onPick(p)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", border: "0.5px solid rgba(0,0,0,.15)", borderRadius: 10, background: "#fff", cursor: "pointer", textAlign: "left" }}>
            <div style={a.wrap}>{a.letter}</div>
            <div><div style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{p.dept}</div></div>
          </button>
        );
      })}
    </div>
  );
}

// Bottom-sheet name picker shown only when an action needs to know who you are.
function PickerOverlay({ roster, t, onPick, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: "16px 16px 0 0", padding: 18, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 -4px 24px rgba(0,0,0,.2)" }}>
        <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 500 }}>{t("invite.pickName")}</p>
        <RosterList roster={roster} onPick={onPick} />
      </div>
    </div>
  );
}

function Shell({ children }) {
  return <div style={{ maxWidth: 460, margin: "0 auto" }}>{children}</div>;
}

function NoticeCard({ meeting, me, resp, t }) {
  const row = (k, v) => (
    <div style={{ display: "flex", gap: 8, fontSize: 14, lineHeight: 1.6 }}>
      <span style={{ color: "#999", flex: "0 0 56px" }}>{k}</span>
      <span style={{ color: "#111", flex: 1 }}>{v || "—"}</span>
    </div>
  );
  return (
    <div style={{ borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,.1)", background: "#fff" }}>
      <div style={{ background: ACCENT, color: "#fff", padding: "16px 18px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9 }}>{t("notice.header")}</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{meeting.title}</div>
      </div>
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
        {row(t("label.time"), meeting.datetime)}
        {row(t("label.location"), meeting.location)}
        {row(t("label.host"), meeting.host)}
        {me ? (
          <div style={{ marginTop: 8, paddingTop: 10, borderTop: "0.5px solid rgba(0,0,0,.08)", display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ color: "var(--color-text-secondary)" }}>{t("invite.greeting", { name: me.name, dept: me.dept })}</span>
            {resp?.rsvp === "yes" ? <span style={pill("#E1F5EE", GREEN)}>{t("invite.confirmed")}</span> : null}
            {resp?.rsvp === "leave" ? <span style={pill("#F7E4EC", RED)}>{t("invite.onLeave")}</span> : null}
            {resp?.agendaReadAt ? <span style={pill("#EDEBF7", ACCENT)}>{t("invite.readBadge")}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConfirmSection({ meetingId, pid, resp, reload, t, focused, requireIdentity }) {
  const [busy, setBusy] = useState(false);
  const fired = useRef(false);
  async function confirm() {
    if (!pid) return requireIdentity(); // ask who's confirming
    setBusy(true);
    try { await api.rsvp(meetingId, pid, "yes"); await reload(); } finally { setBusy(false); }
  }
  // Focused + identity known → confirm immediately, once.
  useEffect(() => {
    if (focused && pid && resp && !fired.current && resp.rsvp !== "yes") {
      fired.current = true;
      confirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, pid, resp]);

  const done = resp?.rsvp === "yes";

  if (focused) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "2rem 1.5rem" }}>
        {done ? (
          <>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E1F5EE", color: GREEN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 14px" }}>✓</div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 500 }}>{t("invite.confirmed")}</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{t("confirm.thanks")}</p>
          </>
        ) : pid ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{t("confirm.recording")}</p>
        ) : (
          <>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 500 }}>{t("confirm.heading")}</h3>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("confirm.desc")}</p>
            <button onClick={confirm} style={{ ...btn(true), width: "100%" }}>{t("confirm.btn")}</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 500 }}>{t("confirm.heading")}</h3>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("confirm.desc")}</p>
      <button onClick={confirm} disabled={busy} style={{ ...btn(true), width: "100%", opacity: busy ? 0.5 : 1 }}>
        {done ? t("confirm.done") : t("confirm.btn")}
      </button>
    </div>
  );
}

function LeaveSection({ meetingId, pid, resp, reload, t, requireIdentity }) {
  const cur = resp?.rsvp === "leave" ? resp.leaveReason : null;
  const [type, setType] = useState(cur?.type || LEAVE_TYPES[0]);
  const [text, setText] = useState(cur?.text || "");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  async function submit() {
    if (!pid) return requireIdentity(); // ask who's requesting leave
    setBusy(true); setOk(false);
    try { await api.rsvp(meetingId, pid, "leave", { type, text: text.trim() }); await reload(); setOk(true); }
    finally { setBusy(false); }
  }
  const isOther = type === "其他";
  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 500 }}>{t("leave.heading")}</h3>
      <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--color-text-secondary)" }}>{t("leave.desc")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {LEAVE_TYPES.map((ty) => (
          <button key={ty} onClick={() => setType(ty)} style={{ height: 34, padding: "0 14px", fontSize: 13, borderRadius: 999, cursor: "pointer", border: type === ty ? "none" : "0.5px solid rgba(0,0,0,.25)", background: type === ty ? ACCENT : "transparent", color: type === ty ? "#fff" : "var(--color-text-primary)" }}>{t(`leaveType.${ty}`)}</button>
        ))}
      </div>
      <label style={label}>{t("leave.note")}{isOther ? t("leave.required") : t("leave.optional")}</label>
      <textarea style={textarea} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("leave.placeholder")} />
      <div style={{ height: 14 }} />
      <button onClick={submit} disabled={busy || (isOther && !text.trim())} style={{ ...btn(true), width: "100%", opacity: busy || (isOther && !text.trim()) ? 0.5 : 1 }}>
        {busy ? t("leave.submitting") : t("leave.submit")}
      </button>
      {ok ? <div style={{ marginTop: 12, padding: "0.7rem 1rem", background: "#E1F5EE", color: GREEN, borderRadius: 8, fontSize: 14 }}>{t("leave.done", { type: t(`leaveType.${type}`) })}</div> : null}
    </div>
  );
}

function AgendaSection({ meetingId, pid, meeting, resp, reload, t, requireIdentity }) {
  // Opening the agenda marks it read (once identity is known) and pops up the
  // agenda overlay first.
  const [showAgenda, setShowAgenda] = useState(true);
  useEffect(() => {
    if (pid) api.markAgendaRead(meetingId, pid).then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, pid]);

  const [drafts, setDrafts] = useState({});
  useEffect(() => { if (resp) setDrafts(resp.comments || {}); }, [resp]);
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);

  function setDraft(topicId, patch) {
    setDrafts((d) => ({ ...d, [topicId]: { stance: "none", text: "", ...d[topicId], ...patch } }));
  }
  async function save(topicId) {
    if (!pid) return requireIdentity(); // ask who's commenting
    const d = drafts[topicId] || { stance: "none", text: "" };
    setSavingId(topicId); setSavedId(null);
    try { await api.setComment(meetingId, pid, topicId, d.stance, d.text); await reload(); setSavedId(topicId); }
    finally { setSavingId(null); }
  }

  return (
    <div style={card}>
      {showAgenda ? <AgendaModal meeting={meeting} t={t} onClose={() => setShowAgenda(false)} /> : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{t("agenda.heading")}</h3>
        <button onClick={() => setShowAgenda(true)} style={{ ...btn(false), height: 30, fontSize: 12, padding: "0 12px" }}>{t("agenda.reopen")}</button>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: pid ? GREEN : "var(--color-text-tertiary,#999)" }}>{pid ? t("agenda.readNote") : t("agenda.viewOnly")}</p>
      <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>{t("agenda.prefillHeading")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {meeting.topics.map((tp) => {
          const d = drafts[tp.id] || { stance: "none", text: "" };
          return (
            <div key={tp.id} style={{ paddingBottom: 14, borderBottom: "0.5px solid rgba(0,0,0,.08)" }}>
              <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 500 }}>{tp.order}. {tp.title}</p>
              {tp.description ? <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{tp.description}</p> : <div style={{ height: 6 }} />}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {Object.entries(STANCE_META).map(([key, m]) => (
                  <button key={key} onClick={() => setDraft(tp.id, { stance: key })} style={{ flex: 1, height: 32, fontSize: 12, borderRadius: 8, cursor: "pointer", border: d.stance === key ? "none" : "0.5px solid rgba(0,0,0,.2)", background: d.stance === key ? m.color : "transparent", color: d.stance === key ? "#fff" : "var(--color-text-primary)" }}>{m.icon} {t(`stance.${key}`)}</button>
                ))}
              </div>
              {(d.stance === "comment" || d.stance === "question") ? (
                <textarea style={{ ...textarea, minHeight: 48 }} value={d.text} onChange={(e) => setDraft(tp.id, { text: e.target.value })} placeholder={d.stance === "question" ? t("agenda.questionPlaceholder") : t("agenda.commentPlaceholder")} />
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <button onClick={() => save(tp.id)} disabled={savingId === tp.id} style={{ ...btn(false), height: 30, fontSize: 12, padding: "0 14px" }}>{savingId === tp.id ? t("common.saving") : t("common.save")}</button>
                {savedId === tp.id ? <span style={{ fontSize: 12, color: GREEN }}>{t("common.saved")}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Pops up the full meeting agenda (read-only) over the screen when 查看議程 is tapped.
function AgendaModal({ meeting, t, onClose }) {
  const row = (k, v) => v ? (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.6 }}>
      <span style={{ color: "#999", flex: "0 0 56px" }}>{k}</span>
      <span style={{ color: "#111", flex: 1 }}>{v}</span>
    </div>
  ) : null;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, maxHeight: "86vh", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", background: "#fff", boxShadow: "0 8px 40px rgba(0,0,0,.3)" }}
      >
        <div style={{ background: ACCENT, color: "#fff", padding: "16px 18px", flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9 }}>📋 {t("agenda.popupTitle")}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{meeting.title}</div>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 14, borderBottom: "0.5px solid rgba(0,0,0,.1)", marginBottom: 14 }}>
            {row(t("label.time"), meeting.datetime)}
            {row(t("label.location"), meeting.location)}
            {row(t("label.host"), meeting.host)}
          </div>
          {meeting.topics.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>—</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {meeting.topics.map((tp) => (
                <div key={tp.id} style={{ display: "flex", gap: 10 }}>
                  <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: ACCENT + "1a", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>{tp.order}</div>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{tp.title}</p>
                    {tp.description ? <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{tp.description}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {meeting.attachments?.length ? (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "0.5px solid rgba(0,0,0,.1)" }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>{t("agenda.attachments")}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {meeting.attachments.map((a, i) => <AttachmentView key={i} att={a} />)}
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ padding: "12px 18px", flexShrink: 0, borderTop: "0.5px solid rgba(0,0,0,.1)" }}>
          <button onClick={onClose} style={{ ...btn(true), width: "100%" }}>{t("agenda.continue")}</button>
        </div>
      </div>
    </div>
  );
}

function attIcon(type, name) {
  const s = `${type || ""} ${name || ""}`;
  if (/image\//.test(type || "")) return "🖼";
  if (/pdf/i.test(s)) return "📄";
  if (/word|\.docx?/i.test(s)) return "📝";
  if (/sheet|excel|\.xlsx?|\.csv/i.test(s)) return "📊";
  return "📎";
}

// Read-only attachment in the participant agenda popup (image thumbnail or link).
function AttachmentView({ att }) {
  const isImg = /image\//.test(att.type || "");
  return (
    <a href={att.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#111", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 10, padding: 8 }}>
      {isImg
        ? <img src={att.url} alt={att.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
        : <span style={{ fontSize: 24, flexShrink: 0 }}>{attIcon(att.type, att.name)}</span>}
      <span style={{ fontSize: 13, wordBreak: "break-all" }}>{att.name}</span>
    </a>
  );
}
