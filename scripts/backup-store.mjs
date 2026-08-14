#!/usr/bin/env node
// ── Meeting Master — backup / restore for the file store ────────────────
//
// The whole dataset is one file (data/store.json) plus the agenda attachments
// in uploads/. Until the module moves to a real database (ADR-0028) this script
// IS the disaster-recovery story, so it is deliberately dependency-free: Node
// stdlib only, runs identically on the Windows production host and on macOS.
//
//   node scripts/backup-store.mjs              create a backup + rotate old ones
//   node scripts/backup-store.mjs --list       show what is held, newest first
//   node scripts/backup-store.mjs --verify     check the live store parses
//   node scripts/backup-store.mjs --restore <file>   put a backup back
//
// Options: --keep <n> (default 30) · --dir <path> (or MM_BACKUP_DIR)
//          --no-uploads  skip the attachment mirror
//
// Backups land OUTSIDE data/ so a "delete the data folder" mistake cannot take
// the backups with it. They are still on the same disk — copy them off-host on
// a schedule (see docs/DATA-AND-DEPLOY.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STORE_FILE = path.join(APP_ROOT, "data", "store.json");
const UPLOADS_DIR = path.join(APP_ROOT, "uploads");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const BACKUP_DIR = path.resolve(value("--dir", process.env.MM_BACKUP_DIR || path.join(APP_ROOT, "backups")));
const KEEP = Math.max(1, Number(value("--keep", 30)) || 30);
const SNAPSHOT_RE = /^store-(.+)\.json$/;

// ── Reading + describing a store file ──────────────────────────────────
// Counting rows is what makes a backup verifiable. A backup you have never
// parsed is a guess, so every write and every restore goes through this.
function describe(file) {
  const raw = fs.readFileSync(file, "utf8");
  const d = JSON.parse(raw);
  const members = Object.values(d.members || {});
  return {
    bytes: Buffer.byteLength(raw),
    members: members.length,
    registered: members.filter((m) => m.status === "registered").length,
    pending: members.filter((m) => m.status === "pending").length,
    meetings: Object.keys(d.meetings || {}).length,
    schedules: Object.keys(d.schedules || {}).length,
  };
}

const summarise = (s) =>
  `${s.meetings} meetings · ${s.schedules} schedules · ${s.members} members (${s.registered} registered, ${s.pending} pending) · ${(s.bytes / 1024).toFixed(0)} KB`;

// ── Attachment mirror ──────────────────────────────────────────────────
// Uploaded files are written once under a unique name and never edited, so a
// copy-if-missing mirror stays complete without duplicating 3.5 MB per run.
function mirrorUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) return { copied: 0, total: 0 };
  const dest = path.join(BACKUP_DIR, "uploads-mirror");
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  const names = fs.readdirSync(UPLOADS_DIR).filter((n) => fs.statSync(path.join(UPLOADS_DIR, n)).isFile());
  for (const name of names) {
    const target = path.join(dest, name);
    const source = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(source).size) continue;
    fs.copyFileSync(source, target);
    copied++;
  }
  return { copied, total: names.length };
}

// ── Commands ───────────────────────────────────────────────────────────
function listSnapshots() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => SNAPSHOT_RE.test(n))
    .map((n) => ({ name: n, file: path.join(BACKUP_DIR, n), mtime: fs.statSync(path.join(BACKUP_DIR, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function cmdList() {
  const snaps = listSnapshots();
  console.log(`Backups in ${BACKUP_DIR}\n`);
  if (!snaps.length) return console.log("  (none yet — run `npm run backup`)");
  for (const s of snaps) {
    let detail;
    try { detail = summarise(describe(s.file)); }
    catch (e) { detail = `⚠ UNREADABLE — ${e.message}`; }
    console.log(`  ${s.name}  ${detail}`);
  }
  console.log(`\n  ${snaps.length} snapshot(s), keeping ${KEEP}`);
}

function cmdVerify() {
  if (!fs.existsSync(STORE_FILE)) {
    console.error(`✗ no store at ${STORE_FILE}`);
    process.exit(1);
  }
  const s = describe(STORE_FILE); // throws → non-zero exit, which is the point
  console.log(`✓ store is valid JSON — ${summarise(s)}`);
}

function cmdBackup() {
  if (!fs.existsSync(STORE_FILE)) {
    console.error(`✗ nothing to back up: ${STORE_FILE} does not exist`);
    process.exit(1);
  }
  // Parse before writing. Copying a corrupt file over the rotation window is
  // how you end up with 30 useless backups and no way to tell.
  const stats = describe(STORE_FILE);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const target = path.join(BACKUP_DIR, `store-${stamp}.json`);
  fs.copyFileSync(STORE_FILE, target);

  // Re-read the copy: proves the bytes that landed are the bytes we meant.
  const check = describe(target);
  if (check.bytes !== stats.bytes) {
    console.error(`✗ copy mismatch (${stats.bytes} → ${check.bytes} bytes) — backup NOT trusted`);
    process.exit(1);
  }
  console.log(`✓ ${path.basename(target)} — ${summarise(check)}`);

  if (!flag("--no-uploads")) {
    const up = mirrorUploads();
    console.log(`✓ uploads mirror — ${up.copied} new, ${up.total} total`);
  }

  const snaps = listSnapshots();
  for (const old of snaps.slice(KEEP)) {
    fs.unlinkSync(old.file);
    console.log(`  rotated out ${old.name}`);
  }
  console.log(`\nBackup dir: ${BACKUP_DIR}`);
}

function cmdRestore(file) {
  const source = path.resolve(file);
  if (!fs.existsSync(source)) {
    console.error(`✗ no such backup: ${source}`);
    process.exit(1);
  }
  const incoming = describe(source); // refuse to restore something unreadable

  // Never overwrite the live store without keeping what was there — a restore
  // of the wrong snapshot is itself a data-loss event.
  if (fs.existsSync(STORE_FILE)) {
    const aside = path.join(BACKUP_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "")}.json`);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(STORE_FILE, aside);
    let was = "unreadable";
    try { was = summarise(describe(STORE_FILE)); } catch { /* keep 'unreadable' */ }
    console.log(`  current store set aside → ${path.basename(aside)} (${was})`);
  }

  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.copyFileSync(source, STORE_FILE);
  console.log(`✓ restored ${path.basename(source)} — ${summarise(incoming)}`);
  console.log("\nRestart the service so it reloads from disk:  pm2 restart meeting-master");
}

// ── Entry ──────────────────────────────────────────────────────────────
try {
  if (flag("--list")) cmdList();
  else if (flag("--verify")) cmdVerify();
  else if (flag("--restore")) cmdRestore(value("--restore"));
  else cmdBackup();
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
