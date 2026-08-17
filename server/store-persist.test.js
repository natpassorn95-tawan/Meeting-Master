// Persistence safety for the file store (see ADR-0028 for the durable fix).
// These cover the failure that can destroy the whole dataset in one moment:
// an interrupted write to data/store.json. Run with `npm test`.
//
// MM_DATA_FILE must be set BEFORE store.js is imported — it is read at module
// load — so each case runs in its own child process against a temp file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// A file:// URL, not a filesystem path: this string is used as an ESM import
// specifier in the child process below, and Node rejects a bare Windows drive
// path there ("C:\..." -> ERR_UNSUPPORTED_ESM_URL_SCHEME). On POSIX the two
// forms happen to be interchangeable, which is why this only failed on Windows.
const STORE = new URL("./store.js", import.meta.url).href;

function tmpStoreFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-store-")), "store.json");
}

// Run a snippet with store.js imported against `file`, and return its stdout.
// Every session loads first, the way server/index.js does at boot.
function session(file, body) {
  const src = `import * as db from ${JSON.stringify(STORE)};\ndb.loadStore();\n${body}`;
  return execFileSync(process.execPath, ["--input-type=module", "-e", src], {
    env: { ...process.env, MM_DATA_FILE: file },
    encoding: "utf8",
  });
}

const addMeeting = (title) => `db.createMeeting({ title: ${JSON.stringify(title)} }); db.saveStore();`;

test("save is atomic: the live file is only ever complete JSON", () => {
  const file = tmpStoreFile();
  session(file, addMeeting("Q3 檢討"));

  const parsed = JSON.parse(fs.readFileSync(file, "utf8")); // throws if truncated
  assert.equal(Object.keys(parsed.meetings).length, 1);
  // The temp file must not survive a successful save.
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test("the previous version is retained as .bak on every save", () => {
  const file = tmpStoreFile();
  session(file, addMeeting("first"));
  session(file, addMeeting("second"));

  const live = JSON.parse(fs.readFileSync(file, "utf8"));
  const bak = JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"));
  assert.equal(Object.keys(live.meetings).length, 2, "live file has both meetings");
  assert.equal(Object.keys(bak.meetings).length, 1, ".bak holds the version before the last save");
});

test("a corrupt store falls back to .bak instead of starting empty", () => {
  const file = tmpStoreFile();
  session(file, addMeeting("keep me"));
  session(file, addMeeting("and me"));

  // Simulate a write cut in half by a crash or power loss.
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").slice(0, 200));

  const out = session(file, `console.log(JSON.stringify({ n: db.listMeetings().length }));`);
  const { n } = JSON.parse(out.trim().split("\n").pop());
  assert.equal(n, 1, "recovered the .bak contents rather than losing everything");
  // The unreadable file is kept for forensics rather than silently replaced.
  assert.equal(fs.existsSync(`${file}.corrupt`), true);
});
