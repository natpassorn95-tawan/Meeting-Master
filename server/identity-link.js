// ── OPAL central identity service — best-effort mirror ─────────────────
// When a member finishes registration (name + email + LINE userId), we also
// push {email, provider:"line", external_id:userId} to the central identity
// service so other OPAL apps can resolve this person by their LINE account.
//
// Registration must NEVER fail because the identity service is down. Every
// call is fire-and-forget; failures are logged (with the email MASKED) and
// parked in a small on-disk retry queue that a background sweep drains.
//
// Off by default: only active when IDENTITY_SERVICE_URL + IDENTITY_SERVICE_KEY
// are set in .env. Uses Node's global fetch (no new dependency).

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const IDENTITY_URL = (process.env.IDENTITY_SERVICE_URL || "").replace(/\/+$/, "");
const IDENTITY_KEY = process.env.IDENTITY_SERVICE_KEY || "";
const CONFIGURED = !!(IDENTITY_URL && IDENTITY_KEY);

const QUEUE_FILE = fileURLToPath(new URL("../data/identity-retry.json", import.meta.url));

// Mask an email for logs: 'monica@aiai.org.tw' -> 'mo***@aiai.org.tw'.
function mask(email) {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return e ? "***" : "";
  const keep = at <= 2 ? 1 : 2;
  return `${e.slice(0, keep)}***${e.slice(at)}`;
}

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveQueue(q) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(q));
  } catch (e) {
    console.error("[identity] retry-queue save failed:", e.message);
  }
}

// POST one link. Throws on network error or non-2xx so callers can retry.
async function postLink({ email, lineUserId, displayName }) {
  const res = await fetch(`${IDENTITY_URL}/v1/identities/link`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${IDENTITY_KEY}` },
    body: JSON.stringify({
      email,
      provider: "line",
      external_id: lineUserId,
      display_name: displayName || undefined,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// Park a failed link for later. Dedup by lineUserId — keep the newest email.
function enqueue(payload) {
  const q = loadQueue().filter((x) => x.lineUserId !== payload.lineUserId);
  q.push({ ...payload, queuedAt: Date.now() });
  saveQueue(q);
}

// Fire-and-forget: mirror a registered member into the identity service.
// Never throws; safe to call from a request handler after responding.
export function linkMemberIdentity(member) {
  if (!CONFIGURED || !member) return;
  const payload = {
    email: String(member.email || "").trim().toLowerCase(),
    lineUserId: String(member.lineUserId || "").trim(),
    displayName: member.name || "",
  };
  if (!payload.email || !payload.lineUserId) return;
  postLink(payload).catch((e) => {
    console.error(`[identity] link failed for ${mask(payload.email)} — queued for retry:`, e.message);
    enqueue(payload);
  });
}

// Drain the retry queue once. Items that still fail stay queued.
export async function drainIdentityQueue() {
  if (!CONFIGURED) return;
  const q = loadQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      await postLink(item);
      console.log(`[identity] retry succeeded for ${mask(item.email)}`);
    } catch {
      remaining.push(item);
    }
  }
  if (remaining.length !== q.length) saveQueue(remaining);
}

// Start the background retry sweep (and drain once on boot). No-op if the
// integration isn't configured.
export function startIdentitySync(intervalMs = 60_000) {
  if (!CONFIGURED) {
    console.log("[identity] sync OFF (set IDENTITY_SERVICE_URL + IDENTITY_SERVICE_KEY to enable)");
    return;
  }
  console.log(`[identity] sync ON → ${IDENTITY_URL}`);
  drainIdentityQueue().catch((e) => console.error("[identity]", e.message));
  const t = setInterval(() => drainIdentityQueue().catch((e) => console.error("[identity]", e.message)), intervalMs);
  t.unref?.();
}
