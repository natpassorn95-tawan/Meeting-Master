#!/usr/bin/env node
// ── Meeting Master — move the live data onto another host ───────────────
//
// One-time migration helper for taking the dataset from the machine that has
// been serving production (data/store.json + uploads/) onto the real
// production host. Deliberately dependency-free so it runs on both ends.
//
//   node scripts/migrate-data.mjs --out <dir>     build a bundle to carry over
//   node scripts/migrate-data.mjs --apply <dir>   install a bundle on this host
//   node scripts/migrate-data.mjs --check <dir>   verify a bundle, change nothing
//
// The bundle records a SHA-256 for every file plus the row counts, and --apply
// refuses to install anything whose checksums do not match. That is the whole
// point: a migration you cannot verify is a migration you cannot trust.
//
// --apply never destroys what is already on the target — the existing store is
// copied aside first, and it refuses to overwrite a non-empty store unless you
// pass --force.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STORE_FILE = path.join(APP_ROOT, "data", "store.json");
const UPLOADS_DIR = path.join(APP_ROOT, "uploads");
const MANIFEST = "MANIFEST.json";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function counts(storeFile) {
  const d = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  const members = Object.values(d.members || {});
  return {
    members: members.length,
    registered: members.filter((m) => m.status === "registered").length,
    pending: members.filter((m) => m.status === "pending").length,
    meetings: Object.keys(d.meetings || {}).length,
    schedules: Object.keys(d.schedules || {}).length,
  };
}

const show = (c) => `${c.meetings} meetings · ${c.schedules} schedules · ${c.members} members (${c.registered} registered, ${c.pending} pending)`;

function listUploads(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
}

// ── Build ──────────────────────────────────────────────────────────────
function cmdOut(dest) {
  if (!dest) { console.error("✗ --out needs a target directory"); process.exit(1); }
  if (!fs.existsSync(STORE_FILE)) { console.error(`✗ no store at ${STORE_FILE}`); process.exit(1); }

  const bundle = path.resolve(dest);
  fs.mkdirSync(path.join(bundle, "uploads"), { recursive: true });

  fs.copyFileSync(STORE_FILE, path.join(bundle, "store.json"));
  const files = { "store.json": sha256(STORE_FILE) };

  for (const name of listUploads(UPLOADS_DIR)) {
    const from = path.join(UPLOADS_DIR, name);
    fs.copyFileSync(from, path.join(bundle, "uploads", name));
    files[`uploads/${name}`] = sha256(from);
  }

  const stats = counts(STORE_FILE);
  fs.writeFileSync(
    path.join(bundle, MANIFEST),
    JSON.stringify({ createdAt: new Date().toISOString(), source: APP_ROOT, counts: stats, files }, null, 2),
  );

  console.log(`✓ bundle written to ${bundle}`);
  console.log(`  ${show(stats)}`);
  console.log(`  ${Object.keys(files).length - 1} uploaded file(s)`);
  console.log("\nCarry the whole folder to the production host, then run there:");
  console.log("  node scripts\\migrate-data.mjs --apply <folder>");
}

// ── Verify ─────────────────────────────────────────────────────────────
function verify(bundle) {
  const manifestPath = path.join(bundle, MANIFEST);
  if (!fs.existsSync(manifestPath)) throw new Error(`no ${MANIFEST} in ${bundle} — not a bundle`);
  const man = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const bad = [];
  for (const [rel, expected] of Object.entries(man.files)) {
    const file = path.join(bundle, rel);
    if (!fs.existsSync(file)) { bad.push(`${rel} — missing`); continue; }
    if (sha256(file) !== expected) bad.push(`${rel} — checksum mismatch`);
  }
  const live = counts(path.join(bundle, "store.json"));
  for (const k of Object.keys(man.counts)) {
    if (live[k] !== man.counts[k]) bad.push(`${k}: manifest says ${man.counts[k]}, file has ${live[k]}`);
  }
  return { man, bad, live };
}

function cmdCheck(dir) {
  if (!dir) { console.error("✗ --check needs a bundle directory"); process.exit(1); }
  const { man, bad, live } = verify(path.resolve(dir));
  console.log(`Bundle built ${man.createdAt}`);
  console.log(`  ${show(live)}`);
  console.log(`  ${Object.keys(man.files).length} file(s) checksummed`);
  if (bad.length) {
    console.error(`\n✗ ${bad.length} problem(s):`);
    for (const b of bad) console.error(`   ${b}`);
    process.exit(1);
  }
  console.log("\n✓ bundle is intact");
}

// ── Install ────────────────────────────────────────────────────────────
function cmdApply(dir) {
  if (!dir) { console.error("✗ --apply needs a bundle directory"); process.exit(1); }
  const bundle = path.resolve(dir);
  const { bad, live } = verify(bundle);
  if (bad.length) {
    console.error("✗ refusing to install a bundle that failed verification:");
    for (const b of bad) console.error(`   ${b}`);
    process.exit(1);
  }

  // Guard against overwriting a host that is already carrying real data.
  if (fs.existsSync(STORE_FILE)) {
    let existing = null;
    try { existing = counts(STORE_FILE); } catch { /* unreadable — treat as occupied */ }
    const occupied = !existing || existing.meetings > 0 || existing.members > 0;
    if (occupied && !flag("--force")) {
      console.error(`✗ this host already has data — ${existing ? show(existing) : "(unreadable store)"}`);
      console.error("   Installing would replace it. Re-run with --force if that is what you want.");
      process.exit(1);
    }
    const aside = `${STORE_FILE}.replaced-${new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "")}`;
    fs.copyFileSync(STORE_FILE, aside);
    console.log(`  existing store kept as ${path.basename(aside)}`);
  }

  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.copyFileSync(path.join(bundle, "store.json"), STORE_FILE);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  let copied = 0;
  for (const name of listUploads(path.join(bundle, "uploads"))) {
    fs.copyFileSync(path.join(bundle, "uploads", name), path.join(UPLOADS_DIR, name));
    copied++;
  }

  const after = counts(STORE_FILE);
  console.log(`✓ installed — ${show(after)}`);
  console.log(`✓ ${copied} uploaded file(s) restored`);
  console.log("\nStart the service, then confirm the counts in the app:  pm2 start meeting-master");
}

try {
  if (flag("--out")) cmdOut(value("--out"));
  else if (flag("--apply")) cmdApply(value("--apply"));
  else if (flag("--check")) cmdCheck(value("--check"));
  else {
    console.log("usage: node scripts/migrate-data.mjs --out <dir> | --apply <dir> [--force] | --check <dir>");
    process.exit(1);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
