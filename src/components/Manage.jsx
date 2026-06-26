import React, { useState, useEffect } from "react";
import { api } from "../api.js";
import { card, label, input, textarea, btn, GREEN, RED } from "../ui.js";
import { useT } from "../i18n.jsx";

export default function Manage({ meetingId, go }) {
  const { t } = useT();
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getMeeting(meetingId).then(setMeeting).catch((e) => setError(e.message));
  }, [meetingId]);

  if (error) return <p style={{ color: RED }}>⚠ {error}</p>;
  if (!meeting) return <p style={{ color: "var(--color-text-secondary)" }}>{t("common.loading")}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 500 }}>{t("manage.heading")}</h2>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{meeting.title}　·　{t("manage.desc")}</p>
          </div>
          <button onClick={() => go("host", { m: meetingId })} style={{ ...btn(false), height: 34, fontSize: 13 }}>{t("manage.toHost")}</button>
        </div>
      </div>
      <TopicsEditor meetingId={meetingId} topics={meeting.topics} />
      <RosterEditor meetingId={meetingId} roster={meeting.roster} />
    </div>
  );
}

function TopicsEditor({ meetingId, topics }) {
  const { t } = useT();
  const [rows, setRows] = useState(topics.map((x) => ({ id: x.id, title: x.title, description: x.description || "" })));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const upd = (i, k, v) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const add = () => setRows((r) => [...r, { title: "", description: "" }]);
  const del = (i) => setRows((r) => r.filter((_, j) => j !== i));
  const move = (i, dir) => setRows((r) => {
    const j = i + dir;
    if (j < 0 || j >= r.length) return r;
    const next = r.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  async function save() {
    setSaving(true); setSaved(false); setError("");
    try {
      const m = await api.setTopics(meetingId, rows.filter((x) => x.title.trim()));
      setRows(m.topics.map((x) => ({ id: x.id, title: x.title, description: x.description || "" })));
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{t("manage.agendaTitle")}</h3>
        <button onClick={add} style={{ ...btn(false), height: 32, fontSize: 12 }}>{t("manage.addTopic")}</button>
      </div>
      {rows.length === 0 ? <p style={{ color: "var(--color-text-tertiary,#999)", fontSize: 14 }}>{t("manage.noTopics")}</p> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 12, borderBottom: "0.5px solid rgba(0,0,0,.08)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
              <span style={{ fontSize: 13, color: "var(--color-text-tertiary,#999)", textAlign: "center" }}>{i + 1}</span>
              <button onClick={() => move(i, -1)} style={arrowBtn} title="↑">↑</button>
              <button onClick={() => move(i, 1)} style={arrowBtn} title="↓">↓</button>
            </div>
            <div style={{ flex: 1 }}>
              <input style={input} value={row.title} onChange={(e) => upd(i, "title", e.target.value)} placeholder={t("manage.topicTitle")} />
              <div style={{ height: 8 }} />
              <textarea style={{ ...textarea, minHeight: 44 }} value={row.description} onChange={(e) => upd(i, "description", e.target.value)} placeholder={t("manage.topicDesc")} />
            </div>
            <button onClick={() => del(i)} style={{ ...btn(false), height: 30, fontSize: 12, color: RED, borderColor: RED + "55", marginTop: 4 }}>{t("common.delete")}</button>
          </div>
        ))}
      </div>
      <SaveRow saving={saving} saved={saved} error={error} onSave={save} saveLabel={t("manage.saveAgenda")} savedLabel={t("manage.savedAgenda")} />
    </div>
  );
}

function RosterEditor({ meetingId, roster }) {
  const { t } = useT();
  const [rows, setRows] = useState(roster.map((x) => ({ id: x.id, name: x.name, dept: x.dept })));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const upd = (i, k, v) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const add = () => setRows((r) => [...r, { name: "", dept: "" }]);
  const del = (i) => setRows((r) => r.filter((_, j) => j !== i));
  async function save() {
    setSaving(true); setSaved(false); setError("");
    try {
      const m = await api.setRoster(meetingId, rows.filter((x) => x.name.trim()));
      setRows(m.roster.map((x) => ({ id: x.id, name: x.name, dept: x.dept })));
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{t("manage.rosterTitle")}</h3>
        <button onClick={add} style={{ ...btn(false), height: 32, fontSize: 12 }}>{t("manage.addPerson")}</button>
      </div>
      {rows.length === 0 ? <p style={{ color: "var(--color-text-tertiary,#999)", fontSize: 14 }}>{t("manage.noPeople")}</p> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...input, flex: "1 1 140px" }} value={row.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder={t("manage.name")} />
            <input style={{ ...input, flex: "1 1 140px" }} value={row.dept} onChange={(e) => upd(i, "dept", e.target.value)} placeholder={t("manage.dept")} />
            <button onClick={() => del(i)} style={{ ...btn(false), height: 36, fontSize: 12, color: RED, borderColor: RED + "55" }}>{t("common.delete")}</button>
          </div>
        ))}
      </div>
      <SaveRow saving={saving} saved={saved} error={error} onSave={save} saveLabel={t("manage.saveRoster")} savedLabel={t("manage.savedRoster")} />
    </div>
  );
}

const arrowBtn = {
  width: 24, height: 20, fontSize: 11, lineHeight: 1, borderRadius: 5, cursor: "pointer",
  border: "0.5px solid rgba(0,0,0,.2)", background: "transparent",
};

function SaveRow({ saving, saved, error, onSave, saveLabel, savedLabel }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
      <button onClick={onSave} disabled={saving} style={{ ...btn(true), opacity: saving ? 0.5 : 1 }}>{saving ? "…" : saveLabel}</button>
      {saved ? <span style={{ fontSize: 13, color: GREEN }}>{savedLabel}</span> : null}
      {error ? <span style={{ fontSize: 13, color: RED }}>⚠ {error}</span> : null}
    </div>
  );
}
