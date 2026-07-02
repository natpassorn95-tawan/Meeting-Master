import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, AMBER, card, btn, pill, avatar, jobTitleLabel, departmentLabel } from "../ui.js";
import { useT } from "../i18n.jsx";

export default function Members({ go }) {
  const { t, lang } = useT();
  const [members, setMembers] = useState(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await api.listMembers()); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // poll so a registration completed in another tab shows up
  useEffect(() => { const id = setInterval(load, 4000); return () => clearInterval(id); }, [load]);

  async function simulate() {
    setBusy(true); setError("");
    try {
      const r = await api.simulateFollow();
      setLink(r);
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function setActive(userId, active) {
    setError("");
    try { await api.setMemberActive(userId, active); load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>{t("members.heading")}</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{t("members.desc")}</p>
      </div>

      <div style={card}>
        <button onClick={simulate} disabled={busy} style={{ ...btn(true) }}>{t("members.simulate")}</button>
        <span style={{ marginLeft: 10, fontSize: 12, color: "var(--color-text-tertiary,#999)" }}>{t("members.simulateHint")}</span>
        {link ? (
          <div style={{ marginTop: 12, padding: "0.7rem 1rem", background: "#FFF6E5", color: AMBER, borderRadius: 8, fontSize: 14 }}>
            {t("members.statusPending")}: <code style={{ fontSize: 12 }}>{link.member.lineUserId}</code>
            <button onClick={() => go("register", { u: link.member.lineUserId })} style={{ ...btn(false), height: 30, fontSize: 12, marginLeft: 10 }}>{t("members.openForm")}</button>
          </div>
        ) : null}
        {error ? <div style={{ marginTop: 12, color: "#993556", fontSize: 14 }}>⚠ {error}</div> : null}
      </div>

      <div style={card}>
        {members === null ? <p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p> : members.length === 0 ? (
          <p style={{ color: "var(--color-text-tertiary,#999)", margin: 0 }}>{t("members.none")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((m, i) => {
              const a = avatar(m.name || "?", i);
              const reg = m.status === "registered";
              const inactive = m.active === false;
              return (
                <div key={m.lineUserId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i === 0 ? "none" : "0.5px solid rgba(0,0,0,.08)", opacity: inactive ? 0.55 : 1 }}>
                  <div style={a.wrap}>{a.letter}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
                      {m.name || <span style={{ color: "var(--color-text-tertiary,#999)" }}>—</span>}
                      {m.employeeId ? <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>{m.employeeId}</span> : null}
                      {m.department ? <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>{departmentLabel(m.department, lang)}</span> : null}
                      {m.jobTitle ? <span style={{ fontSize: 12, color: ACCENT, marginLeft: 8 }}>{jobTitleLabel(m.jobTitle, lang)}</span> : null}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {m.email || ""}{m.email ? "　·　" : ""}<code style={{ fontSize: 11, color: "var(--color-text-tertiary,#999)" }}>{m.lineUserId}</code>
                    </p>
                  </div>
                  {reg
                    ? <span style={pill("#E1F5EE", GREEN)}>{t("members.statusRegistered")}</span>
                    : <span style={pill("#FFF6E5", AMBER)}>{t("members.statusPending")}</span>}
                  {reg ? (
                    <select
                      value={inactive ? "inactive" : "active"}
                      onChange={(e) => setActive(m.lineUserId, e.target.value === "active")}
                      title={t("members.employmentStatus")}
                      style={{ height: 30, fontSize: 12, padding: "0 8px", borderRadius: 8, appearance: "auto", cursor: "pointer", border: "0.5px solid rgba(0,0,0,.25)", background: "#fff", color: inactive ? "#993556" : "var(--color-text-primary)" }}
                    >
                      <option value="active">🟢 {t("members.active")}</option>
                      <option value="inactive">⚫ {t("members.inactive")}</option>
                    </select>
                  ) : (
                    <button onClick={() => go("register", { u: m.lineUserId })} style={{ ...btn(false), height: 28, fontSize: 11, padding: "0 10px" }}>{t("members.openForm")}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
