// ── LIFF (LINE Front-end Framework) integration ───────────────────────
// When VITE_LIFF_ID is configured AND the app is opened from inside LINE,
// these helpers load the LIFF SDK, init it, and return the user's identity —
// so the participant pages run *inside LINE* (layered over the chat) and we
// can auto-identify the user instead of asking them to pick their name.
//
// In a plain browser (no LIFF id / not in LINE) every call resolves to null
// and the app falls back to its normal behaviour.

const LIFF_ID = import.meta.env.VITE_LIFF_ID || "";
let liffPromise = null;

export function liffConfigured() {
  return !!LIFF_ID;
}

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.liff) return resolve(window.liff);
    const s = document.createElement("script");
    s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    s.onload = () => resolve(window.liff);
    s.onerror = () => reject(new Error("LIFF SDK failed to load"));
    document.head.appendChild(s);
  });
}

export function initLiff() {
  if (!LIFF_ID) return Promise.resolve(null);
  if (!liffPromise) {
    liffPromise = (async () => {
      const liff = await loadSdk();
      await liff.init({ liffId: LIFF_ID });
      return liff;
    })().catch(() => null);
  }
  return liffPromise;
}

// Returns { userId, displayName } when running inside LINE and logged in,
// else null. Triggers LIFF login when in the LIFF client but not yet logged in.
export async function getLiffProfile() {
  const liff = await initLiff();
  if (!liff) return null;
  try {
    if (!liff.isLoggedIn()) {
      if (liff.isInClient()) liff.login();
      return null;
    }
    const p = await liff.getProfile();
    return { userId: p.userId, displayName: p.displayName };
  } catch {
    return null;
  }
}
