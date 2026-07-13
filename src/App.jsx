import React, { useState, useEffect } from "react";
import { api } from "./api.js";
import { ACCENT, GREEN, RED, avatar } from "./ui.js";
import { useT } from "./i18n.jsx";
import HostDashboard from "./components/HostDashboard.jsx";
import Invite from "./components/Invite.jsx";
import Members from "./components/Members.jsx";
import Register from "./components/Register.jsx";
import HostCalendar from "./components/HostCalendar.jsx";
import MyMeetings from "./components/MyMeetings.jsx";
import CheckIn from "./components/CheckIn.jsx";

const DEFAULT_MEETING = "M202607";

// Admin pages (members/host) are only available on the operator's own
// machine/LAN. The public tunnel host (what participants open from LINE) is
// restricted to the participant screens — so users never see the admin UI, and
// the admin nav isn't even rendered for them. (Scheduling now lives inside the
// Host calendar page, so there's no separate Schedules view.)
const ADMIN_VIEWS = new Set(["members", "host"]);
const PARTICIPANT_VIEWS = new Set(["invite", "register", "mymeetings", "checkin"]);

function readUrl() {
  const q = new URLSearchParams(window.location.search);
  // "schedules" used to be its own page; it now lives inside the Host calendar.
  const rawView = q.get("view") || "host";
  return {
    view: rawView === "schedules" ? "host" : rawView,
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
  // Console identity: who is using the console (chosen from the member list).
  // Their lineUserId scopes what they see (private meetings) and can edit.
  const [user, setUser] = useState(() => {
    try {
      const id = localStorage.getItem("mm_user");
      return id ? { id, name: localStorage.getItem("mm_user_name") || id } : null;
    } catch { return null; }
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

  // The console requires a chosen identity; participants never log in.
  const admin = !!user;
  const view = route.view;
  const isParticipant = PARTICIPANT_VIEWS.has(view);
  const showNav = admin && !isParticipant;
  const narrow = isParticipant || !admin; // participant + picker screens are narrow
  const switchUser = () => {
    try { localStorage.removeItem("mm_user"); localStorage.removeItem("mm_user_name"); } catch { /* ignore */ }
    setUser(null);
  };
  const pickUser = (m) => {
    try { localStorage.setItem("mm_user", m.lineUserId); localStorage.setItem("mm_user_name", m.name || m.lineUserId); } catch { /* ignore */ }
    setUser({ id: m.lineUserId, name: m.name || m.lineUserId });
  };

  return (
    <div style={{ maxWidth: narrow ? 520 : 880, margin: "0 auto", padding: "0.5rem 0 2rem" }}>
      <Header status={status} view={view} go={go} showNav={showNav} userName={admin ? user.name : ""} onSwitch={switchUser} />
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
          {view === "members" && <Members go={go} />}
          {view === "host" && (route.board ? <HostDashboard meetingId={route.m} go={go} /> : <HostCalendar go={go} />)}
        </>
      ) : (
        <IdentityPicker onPick={pickUser} />
      )}
    </div>
  );
}

// Console sign-in: pick your name from the registered members (their LINE
// userId becomes the identity token). Not cryptographic — an internal-tool gate.
function IdentityPicker({ onPick }) {
  const { t } = useT();
  const [members, setMembers] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.listMembers()
      .then((ms) => setMembers(ms.filter((m) => m.status === "registered" && m.active !== false)))
      .catch(() => setMembers([]));
  }, []);
  const query = q.trim().toLowerCase();
  const list = (members || []).filter((m) => !query || `${m.name} ${m.employeeId || ""}`.toLowerCase().includes(query));
  return (
    <div style={{ maxWidth: 420, margin: "8vh auto 0" }}>
      <div style={{ background: "#fff", border: "0.5px solid rgba(0,0,0,.12)", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 600 }}>{t("identity.title")}</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>{t("identity.desc")}</p>
        {members === null ? (
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>
        ) : members.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--color-text-tertiary,#999)" }}>{t("identity.none")}</p>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("identity.search")}
              style={{ width: "100%", height: 40, padding: "0 12px", fontSize: 15, borderRadius: 8, border: "0.5px solid rgba(0,0,0,.3)", boxSizing: "border-box", marginBottom: 10 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
              {list.map((m) => (
                <button key={m.lineUserId} onClick={() => onPick(m)}
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "10px 14px", borderRadius: 8, border: "0.5px solid rgba(0,0,0,.18)", background: "#fff", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{[m.employeeId, m.department].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Header({ status, view, go, showNav, userName, onSwitch }) {
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
            {navBtn("host", t("nav.host"))}
            {navBtn("members", t("nav.members"))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LineDot status={status} />
            {userName ? (
              <button onClick={onSwitch} title={t("identity.switch")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px 0 6px", fontSize: 13, fontWeight: 500, borderRadius: 999, border: "0.5px solid rgba(0,0,0,.12)", background: "#fff", cursor: "pointer", color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
                <span style={{ ...avatar(userName).wrap, width: 24, height: 24, fontSize: 12 }}>{avatar(userName).letter}</span>
                {userName}
              </button>
            ) : null}
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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 999, background: "#fff", border: "0.5px solid rgba(0,0,0,.12)", fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: GREEN, flexShrink: 0 }} />
        {status.displayName}
        <span style={{ color: "var(--color-text-tertiary,#999)" }}>{status.basicId}</span>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 999, background: "#fff", border: `0.5px solid ${RED}33`, fontSize: 12, color: RED, whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: RED, flexShrink: 0 }} />
      {t("line.notConnected")}
    </span>
  );
}
