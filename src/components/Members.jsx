import React, { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, AMBER, card, btn, softBtn, pill, avatar, jobTitleLabel, departmentLabel } from "../ui.js";
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

  // Export the member list to a CSV the operator can open in Excel / Sheets.
  // Built entirely client-side (no push, no server round-trip). A UTF-8 BOM keeps
  // Chinese names readable in Excel; localized headers + department/title/status.
  function exportCsv() {
    if (!members || !members.length) return;
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      t("members.colName"), t("members.colEmp"), t("members.colDept"),
      t("members.colTitle"), t("members.colEmail"), t("members.colStatus"),
      t("members.employmentStatus"), t("members.colUserId"),
    ];
    const rows = members.map((m) => [
      m.name || "",
      m.employeeId || "",
      m.department ? departmentLabel(m.department, lang) : "",
      m.jobTitle ? jobTitleLabel(m.jobTitle, lang) : "",
      m.email || "",
      m.status === "registered" ? t("members.statusRegistered") : t("members.statusPending"),
      m.status === "registered" ? (m.active === false ? t("members.inactive") : t("members.active")) : "",
      m.lineUserId || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>{t("members.heading")}</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{t("members.desc")}</p>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: (members && members.length) || link || error ? 12 : 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-secondary)" }}>
            {members && members.length > 0 ? t("members.count", { n: members.length }) : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {members && members.length > 0 ? (
              <button onClick={exportCsv} style={{ ...btn(false), height: 34, fontSize: 13 }}>⤓ {t("members.export")}</button>
            ) : null}
            <button onClick={simulate} disabled={busy} style={{ ...btn(true), height: 34, fontSize: 13, opacity: busy ? 0.5 : 1 }}>{t("members.simulate")}</button>
          </div>
        </div>
        {link ? (
          <div style={{ marginBottom: 12, padding: "0.7rem 1rem", background: "#FFF6E5", color: AMBER, borderRadius: 8, fontSize: 14 }}>
            {t("members.statusPending")}: <code style={{ fontSize: 12 }}>{link.member.lineUserId}</code>
            <button onClick={() => go("register", { u: link.member.lineUserId })} style={{ ...btn(false), height: 30, fontSize: 12, marginLeft: 10 }}>{t("members.openForm")}</button>
          </div>
        ) : null}
        {error ? <div style={{ marginBottom: 12, color: "#993556", fontSize: 14 }}>⚠ {error}</div> : null}
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
                    <button
                      onClick={() => setActive(m.lineUserId, inactive)}
                      title={t("members.employmentStatus")}
                      style={{ ...softBtn(inactive ? RED : GREEN), height: 30 }}
                    >
                      {inactive ? `⚫ ${t("members.inactive")}` : `🟢 ${t("members.active")}`}
                    </button>
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
