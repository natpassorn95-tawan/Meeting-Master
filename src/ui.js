// Shared inline-style helpers for Meeting Master (matches the app's lean,
// dependency-free styling approach).

export const ACCENT = "#534AB7";
export const GREEN = "#0F6E56";
export const RED = "#993556";
export const AMBER = "#854F0B";

export const card = {
  background: "var(--color-background-primary, #fff)",
  border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,.15))",
  borderRadius: 12,
  padding: "1.25rem 1.5rem",
};

export const label = {
  fontSize: 13,
  color: "var(--color-text-secondary, #666)",
  marginBottom: 6,
  display: "block",
};

export const input = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  fontSize: 15,
  border: "0.5px solid var(--color-border-secondary, rgba(0,0,0,.3))",
  borderRadius: 8,
  background: "var(--color-background-primary, #fff)",
  color: "var(--color-text-primary, #111)",
  boxSizing: "border-box",
};

export const textarea = {
  ...input,
  height: "auto",
  minHeight: 64,
  padding: "10px 12px",
  resize: "vertical",
  lineHeight: 1.5,
};

export const btn = (primary) => ({
  height: 42,
  padding: "0 20px",
  fontSize: 15,
  fontWeight: 500,
  borderRadius: 8,
  cursor: "pointer",
  border: primary ? "none" : "0.5px solid var(--color-border-secondary, rgba(0,0,0,.3))",
  background: primary ? ACCENT : "transparent",
  color: primary ? "#fff" : "var(--color-text-primary, #111)",
});

export const pill = (bg, fg) => ({
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 500,
  background: bg,
  color: fg,
});

export function avatar(name, i = 0) {
  const colors = ["#534AB7", "#0F6E56", "#993C1D", "#993556", "#185FA5", "#854F0B"];
  const c = colors[i % colors.length];
  return {
    wrap: {
      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
      background: c + "22", color: c,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 14, fontWeight: 500,
    },
    letter: (name || "?").slice(0, 1),
  };
}

// Format structured date/time parts into the display string the rest of the
// app uses, e.g. ("2026-07-03","14:00","15:30") → "2026/07/03 (四) 14:00–15:30".
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
export function fmtDatetime(date, start, end) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const dateStr = `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")} (${wd})`;
  const time = start ? (end ? `${start}–${end}` : start) : "";
  return time ? `${dateStr} ${time}` : dateStr;
}

export const LEAVE_TYPES = ["出差", "時間衝突", "個人事由", "其他"];

// Job titles (職位名稱) for member registration — from Aiai's title list.
// Stored value is the Chinese title; `en` is shown in English mode.
export const JOB_TITLES = [
  { zh: "人資專員", en: "HR Specialist" },
  { zh: "個案管理師", en: "Case Manager" },
  { zh: "副理", en: "Deputy Manager" },
  { zh: "副組長", en: "Deputy Team Leader" },
  { zh: "助理", en: "Assistant" },
  { zh: "司機", en: "Driver" },
  { zh: "司機人員", en: "Driver (Staff)" },
  { zh: "室內設計師", en: "Interior Designer" },
  { zh: "整合行銷專員", en: "Integrated Marketing Specialist" },
  { zh: "日照主任", en: "Day-Care Director" },
  { zh: "會計人員", en: "Accountant" },
  { zh: "東明主任", en: "Dongming Site Director" },
  { zh: "櫃台人員", en: "Front Desk / Receptionist" },
  { zh: "照服人員-印籍", en: "Care Worker (Indonesian)" },
  { zh: "照服人員-台籍", en: "Care Worker (Taiwanese)" },
  { zh: "照護督導", en: "Care Supervisor" },
  { zh: "營養師", en: "Dietitian" },
  { zh: "生活管理員", en: "Residential Care Officer" },
  { zh: "社工員", en: "Social Worker" },
  { zh: "社工督導", en: "Social Work Supervisor" },
  { zh: "秘書長", en: "Secretary-General" },
  { zh: "管理師", en: "Management Specialist" },
  { zh: "系統應用管理師", en: "System Application Manager" },
  { zh: "系統應用組專員", en: "System Application Team Specialist" },
  { zh: "系統組長", en: "Systems Team Leader" },
  { zh: "組長", en: "Team Leader" },
  { zh: "經理", en: "Manager" },
  { zh: "總務專員", en: "General Affairs Specialist" },
  { zh: "總務管理師", en: "General Affairs Manager" },
  { zh: "總務組長", en: "General Affairs Team Leader" },
  { zh: "職能治療師", en: "Occupational Therapist" },
  { zh: "膳食人員", en: "Dietary / Catering Staff" },
  { zh: "行政主任", en: "Administrative Director" },
  { zh: "行政人員", en: "Administrative Staff" },
  { zh: "行政助理", en: "Administrative Assistant" },
  { zh: "行政專員", en: "Administrative Specialist" },
  { zh: "行政膳食人員", en: "Administrative Dietary Staff" },
  { zh: "課長", en: "Section Chief" },
  { zh: "護理師", en: "Nurse" },
  { zh: "財會組長", en: "Finance & Accounting Team Leader" },
  { zh: "資訊系統管理師", en: "Information Systems Manager" },
  { zh: "運務組長", en: "Logistics Team Leader" },
  { zh: "院長", en: "Superintendent" },
  { zh: "陪醫人員", en: "Medical Escort" },
  { zh: "其他", en: "Other" },
];

// Localized label for a stored (Chinese) job-title value.
export function jobTitleLabel(zh, lang) {
  const j = JOB_TITLES.find((x) => x.zh === zh);
  return lang === "en" ? (j?.en || zh) : zh;
}

export const STANCE_META = {
  none: { label: "無意見", icon: "✅", color: GREEN },
  comment: { label: "有意見", icon: "🗨", color: ACCENT },
  question: { label: "提問", icon: "❓", color: AMBER },
};
