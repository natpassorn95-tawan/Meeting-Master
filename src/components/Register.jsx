import React, { useState, useEffect } from "react";
import { api } from "../api.js";
import { ACCENT, GREEN, RED, card, label, input, btn, JOB_TITLES, jobTitleLabel } from "../ui.js";
import { useT } from "../i18n.jsx";
import { liffConfigured, getLiffProfile } from "../liff.js";

// First-time onboarding form, opened from the LINE welcome message.
// userId comes from the URL (?view=register&u=...) or, inside LINE, from LIFF.
export default function Register({ userId: userIdProp }) {
  const { t, lang } = useT();
  const [userId, setUserId] = useState(userIdProp || "");
  const [member, setMember] = useState(null);
  const [f, setF] = useState({ name: "", employeeId: "", email: "", jobTitle: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [alreadyReg, setAlreadyReg] = useState(false);
  const [error, setError] = useState("");

  // Inside LINE without an explicit ?u= → get the userId from LIFF.
  useEffect(() => {
    if (userIdProp || !liffConfigured()) return;
    getLiffProfile().then((p) => { if (p) setUserId(p.userId); });
  }, [userIdProp]);

  useEffect(() => {
    if (!userId) return;
    api.getMember(userId).then((m) => {
      setMember(m);
      if (m.status === "registered") {
        // Prefill but keep the form editable so they can change their name/details.
        setF({ name: m.name, employeeId: m.employeeId, email: m.email, jobTitle: m.jobTitle || "" });
        setAlreadyReg(true);
      }
    }).catch(() => {});
  }, [userId]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const emailOk = /\S+@\S+\.\S+/.test(f.email);
  const canSubmit = f.name.trim() && f.employeeId.trim() && emailOk && f.jobTitle.trim() && !busy;

  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.registerMember(userId, f);
      // Remember identity so the meeting buttons know the user (no name picker).
      localStorage.setItem("mm_name", f.name.trim());
      localStorage.setItem("mm_emp", f.employeeId.trim());
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 440, margin: "0 auto" }}>
      <div style={{ borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,.1)", background: "#fff" }}>
        <div style={{ background: ACCENT, color: "#fff", padding: "18px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.9 }}>🦁 {t("register.welcome")}</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{t("register.heading")}</div>
        </div>
        <div style={{ padding: "20px" }}>
          {done ? (
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E1F5EE", color: GREEN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px" }}>✓</div>
              <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 500 }}>{alreadyReg ? t("register.already") : t("register.done")}</p>
              <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{f.name}・{f.employeeId}{f.jobTitle ? `・${jobTitleLabel(f.jobTitle, lang)}` : ""}</p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>{f.email}</p>
            </div>
          ) : (
            <>
              <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{alreadyReg ? t("register.updateHint") : t("register.desc")}</p>
              <label style={label}>{t("register.name")}</label>
              <input style={input} value={f.name} onChange={set("name")} placeholder={t("register.namePlaceholder")} />
              <div style={{ height: 14 }} />
              <label style={label}>{t("register.employeeId")}</label>
              <input style={input} value={f.employeeId} onChange={set("employeeId")} placeholder={t("register.employeeIdPlaceholder")} />
              <div style={{ height: 14 }} />
              <label style={label}>{t("register.jobTitle")}</label>
              <select style={{ ...input, appearance: "auto" }} value={f.jobTitle} onChange={set("jobTitle")}>
                <option value="" disabled>{t("register.jobTitlePlaceholder")}</option>
                {JOB_TITLES.map((j) => <option key={j.zh} value={j.zh}>{lang === "en" ? j.en : j.zh}</option>)}
              </select>
              <div style={{ height: 14 }} />
              <label style={label}>{t("register.email")}</label>
              <input style={input} value={f.email} onChange={set("email")} placeholder={t("register.emailPlaceholder")} inputMode="email" />
              {f.email && !emailOk ? <p style={{ margin: "6px 0 0", fontSize: 12, color: RED }}>{t("register.errEmail")}</p> : null}
              <div style={{ height: 20 }} />
              <button onClick={submit} disabled={!canSubmit} style={{ ...btn(true), width: "100%", opacity: canSubmit ? 1 : 0.4 }}>
                {busy ? t("register.submitting") : (alreadyReg ? t("register.update") : t("register.submit"))}
              </button>
              {error ? <div style={{ marginTop: 12, color: RED, fontSize: 14 }}>⚠ {error}</div> : null}
            </>
          )}
        </div>
      </div>
      <p style={{ textAlign: "center", margin: "12px 0 0", fontSize: 11, color: "var(--color-text-tertiary,#999)" }}>{userId}</p>
    </div>
  );
}
