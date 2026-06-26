import React, { useState, useEffect } from "react";
import { api } from "./api.js";
import { ACCENT, GREEN, RED } from "./ui.js";
import { useT } from "./i18n.jsx";
import HostDashboard from "./components/HostDashboard.jsx";
import Invite from "./components/Invite.jsx";
import Schedules from "./components/Schedules.jsx";
import Members from "./components/Members.jsx";
import Register from "./components/Register.jsx";
import HostCalendar from "./components/HostCalendar.jsx";
import MyMeetings from "./components/MyMeetings.jsx";
import CheckIn from "./components/CheckIn.jsx";

const DEFAULT_MEETING = "M202607";

// Admin pages (compose/schedules/manage/members/host) are only available on the
// operator's own machine/LAN. The public tunnel host (what participants open
// from LINE) is restricted to the participant screens — so users never see the
// admin UI, and the admin nav isn't even rendered for them.
const ADMIN_VIEWS = new Set(["schedules", "members", "host"]);
const PARTICIPANT_VIEWS = new Set(["invite", "register", "mymeetings", "checkin"]);
// Admin passcode — lets the admin unlock the console on any device (e.g. phone).
// Configurable via VITE_ADMIN_CODE; client-side gate (keeps participants out, not
// cryptographic security).
const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE || "aiai";

function isAdminHost() {
  if (typeof window === "undefined") return true;
  const h = window.location.hostname;
  return (
    h === "localhost" || h === "127.0.0.1" || h === "::1" ||
    /^192\.168\./.test(h) || /^10\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function readUrl() {
  const q = new URLSearchParams(window.location.search);
  return {
    view: q.get("view") || "schedules",
    m: q.get("m") || DEFAULT_MEETING,
    p: q.get("p") || "",
    intent: q.get("intent") || "",
    u: q.get("u") || "",
    board: q.get("board") || "",
  };
}

export default function App() {
  const [route, setRoute] = useState(readUrl);
  const [status, setStatus] = useState(null);
  const [authed, setAuthed] = useState(() => {
    try { return localStorage.getItem("mm_admin") === "1"; } catch { return false; }
  });

  useEffect(() => {
    api.lineStatus().then(setStatus).catch(() => setStatus({ connected: false }));
    const onPop = () => setRoute(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(view, params = {}) {
    const q = new URLSearchParams({ view, m: params.m || route.m });
    if (params.p) q.set("p", params.p);
    if (params.intent) q.set("intent", params.intent);
    if (params.u) q.set("u", params.u);
    if (params.board) q.set("board", params.board);
    window.history.pushState({}, "", `/?${q.toString()}`);
    setRoute(readUrl());
  }

  // Admin console is available on the operator's own machine/LAN, or on any
  // device (phone) once unlocked with the passcode. Participants never log in.
  const admin = isAdminHost() || authed;
  const view = route.view;
  const isParticipant = PARTICIPANT_VIEWS.has(view);
  const showNav = admin && !isParticipant;
  const narrow = isParticipant || !admin; // participant + login screens are narrow
  const logout = () => { try { localStorage.removeItem("mm_admin"); } catch { /* ignore */ } setAuthed(false); };

  return (
    <div style={{ maxWidth: narrow ? 520 : 880, margin: "0 auto", padding: "0.5rem 0 2rem" }}>
      <Header status={status} view={view} go={go} showNav={showNav} canLogout={authed && !isAdminHost()} onLogout={logout} />
      {isParticipant ? (
        view === "invite"
          ? <Invite meetingId={route.m} participantId={route.p} intent={route.intent} go={go} />
          : view === "mymeetings"
            ? <MyMeetings userId={route.u} />
            : view === "checkin"
            ? <CheckIn meetingId={route.m} userId={route.u} />
            : <Register userId={route.u} />
      ) : admin ? (
        <>
          {view === "schedules" && <Schedules go={go} />}
          {view === "members" && <Members go={go} />}
          {view === "host" && (route.board ? <HostDashboard meetingId={route.m} go={go} /> : <HostCalendar go={go} />)}
        </>
      ) : (
        <AdminLogin onAuthed={() => setAuthed(true)} />
      )}
    </div>
  );
}

function AdminLogin({ onAuthed }) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [err, setErr] = useState(false);
  function submit() {
    if (code === ADMIN_CODE) {
      try { localStorage.setItem("mm_admin", "1"); } catch { /* ignore */ }
      onAuthed();
    } else { setErr(true); }
  }
  return (
    <div style={{ maxWidth: 360, margin: "10vh auto 0" }}>
      <div style={{ background: "#fff", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 600 }}>{t("admin.loginTitle")}</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>{t("admin.loginDesc")}</p>
        <input
          type="password" value={code} autoFocus
          onChange={(e) => { setCode(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("admin.passcode")}
          style={{ width: "100%", height: 44, padding: "0 12px", fontSize: 16, borderRadius: 8, border: "0.5px solid rgba(0,0,0,.3)", boxSizing: "border-box" }}
        />
        {err ? <p style={{ margin: "8px 0 0", fontSize: 13, color: "#993556" }}>⚠ {t("admin.wrong")}</p> : null}
        <button onClick={submit} style={{ marginTop: 16, width: "100%", height: 44, fontSize: 15, fontWeight: 500, border: "none", borderRadius: 8, background: ACCENT, color: "#fff", cursor: "pointer" }}>{t("admin.login")}</button>
      </div>
    </div>
  );
}

function Header({ status, view, go, showNav, canLogout, onLogout }) {
  const { t, lang, setLang } = useT();
  const navBtn = (key, text) => (
    <button onClick={() => go(key)} style={{
      height: 34, padding: "0 14px", fontSize: 13, fontWeight: 500, borderRadius: 8,
      cursor: "pointer", border: "none",
      background: view === key ? ACCENT : "transparent",
      color: view === key ? "#fff" : "var(--color-text-secondary)",
    }}>{text}</button>
  );
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showNav ? 14 : 0 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: ACCENT, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🦁</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>會議大師 <span style={{ fontWeight: 400, color: "var(--color-text-secondary)" }}>Meeting Master</span></h1>
          {showNav ? <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{t("app.subtitle")}</p> : null}
        </div>
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      {showNav ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, padding: 4, borderRadius: 10, background: "#fff", border: "0.5px solid rgba(0,0,0,.12)", flexWrap: "wrap" }}>
            {navBtn("schedules", t("nav.schedules"))}
            {navBtn("members", t("nav.members"))}
            {navBtn("host", t("nav.host"))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LineDot status={status} />
            {canLogout ? <button onClick={onLogout} style={{ height: 30, padding: "0 10px", fontSize: 12, borderRadius: 7, border: "0.5px solid rgba(0,0,0,.2)", background: "transparent", cursor: "pointer", color: "var(--color-text-secondary)" }}>{t("admin.logout")}</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LangToggle({ lang, setLang }) {
  const opt = (val, text) => (
    <button onClick={() => setLang(val)} style={{
      height: 30, padding: "0 12px", fontSize: 13, fontWeight: 500, borderRadius: 7,
      cursor: "pointer", border: "none",
      background: lang === val ? ACCENT : "transparent",
      color: lang === val ? "#fff" : "var(--color-text-secondary)",
    }}>{text}</button>
  );
  return (
    <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 9, background: "#fff", border: "0.5px solid rgba(0,0,0,.12)", flexShrink: 0 }}>
      {opt("zh", "中文")}
      {opt("en", "EN")}
    </div>
  );
}

function LineDot({ status }) {
  const { t } = useT();
  if (status === null) return <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{t("line.checking")}</span>;
  if (status.connected) {
    return (
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        <span style={{ color: GREEN }}>●</span> {status.displayName} {status.basicId}
      </span>
    );
  }
  return <span style={{ fontSize: 12, color: RED }}>{t("line.notConnected")}</span>;
}
