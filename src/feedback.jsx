// In-app feedback: toasts (replace alert) and a confirm / type-to-confirm
// dialog (replace confirm / prompt).
//
// Why: the browser's native alert/confirm/prompt freeze the page, look like a
// system error, and inside LINE's in-app browser show the site URL as the
// title. These render inside the app, animate in, and never block the page.
//
// Usage (no hooks needed — works from any async handler):
//   toast("已更新")                       → success toast
//   toast("失敗了", "error")
//   if (!(await ask({ message, confirmText, danger: true }))) return;
//   const typed = await ask({ message, input: true });  // string | null

import React, { useEffect, useRef, useState } from "react";
import { ACCENT, GREEN, RED } from "./ui.js";
import { useT } from "./i18n.jsx";

let push = null;            // set by <FeedbackHost/>
let openDialog = null;
let nextId = 1;

export function toast(message, tone = "success") {
  if (push) push({ id: nextId++, message: String(message), tone });
  else window.alert(message); // host not mounted (should not happen)
}

// Resolves true/false, or for { input: true } the typed text / null.
export function ask(opts) {
  if (!openDialog) {
    return Promise.resolve(opts.input ? window.prompt(opts.message) : window.confirm(opts.message));
  }
  return new Promise((resolve) => openDialog({ ...opts, resolve }));
}

const TONE = { success: GREEN, error: RED, info: ACCENT };

export function FeedbackHost() {
  const { t } = useT();
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const okRef = useRef(null);

  useEffect(() => {
    push = (tst) => {
      setToasts((xs) => [...xs.slice(-2), tst]);           // at most 3 on screen
      const ms = Math.min(7000, 2600 + tst.message.length * 40); // longer text stays longer
      setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== tst.id)), ms);
    };
    openDialog = (d) => { setText(""); setDialog(d); };
    return () => { push = null; openDialog = null; };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const el = dialog.input ? inputRef.current : okRef.current;
    if (el) setTimeout(() => el.focus(), 30);
  }, [dialog]);

  const close = (value) => {
    if (!dialog) return;
    dialog.resolve(value);
    setDialog(null);
  };
  const cancelValue = dialog?.input ? null : false;
  const okValue = dialog?.input ? text : true;

  return (
    <>
      <div className="mm-toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className="mm-toast" style={{ borderLeftColor: TONE[x.tone] || GREEN }}
            onClick={() => setToasts((xs) => xs.filter((y) => y.id !== x.id))}>
            <span style={{ color: TONE[x.tone] || GREEN, fontWeight: 700 }}>{x.tone === "error" ? "⚠" : x.tone === "info" ? "ℹ" : "✓"}</span>
            <span style={{ whiteSpace: "pre-line" }}>{x.message}</span>
          </div>
        ))}
      </div>

      {dialog ? (
        <div className="mm-dialog-backdrop" onClick={() => close(cancelValue)}
          onKeyDown={(e) => { if (e.key === "Escape") close(cancelValue); }}>
          <div className="mm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {dialog.title ? <h3 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 600 }}>{dialog.title}</h3> : null}
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-line", color: "var(--color-text-primary)" }}>{dialog.message}</p>
            {dialog.input ? (
              <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") close(okValue); }}
                placeholder={dialog.placeholder || ""}
                style={{ marginTop: 14, width: "100%", height: 40, padding: "0 12px", fontSize: 15, borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => close(cancelValue)}
                style={{ height: 40, padding: "0 18px", fontSize: 14, fontWeight: 500, borderRadius: 8, cursor: "pointer", border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-primary)" }}>
                {dialog.cancelText || t("common.cancel")}
              </button>
              <button ref={okRef} onClick={() => close(okValue)}
                disabled={dialog.input && dialog.mustMatch != null && text.trim() !== String(dialog.mustMatch).trim()}
                style={{ height: 40, padding: "0 18px", fontSize: 14, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: "none", background: dialog.danger ? RED : ACCENT, color: "#fff" }}>
                {dialog.confirmText || t("common.ok")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
