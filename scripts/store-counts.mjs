#!/usr/bin/env node
// Print row counts for a store file as JSON. Used by the deploy scripts to
// prove the data survived a deploy.
//
// This exists as a FILE rather than an inline `node -e "..."` snippet because
// PowerShell strips the double quotes when handing a string to a native
// command: `node -e 'const fs=require("fs")'` arrives as `require(fs)` and
// throws. The counting function then returns null, and a guard written as
// `if ($before -ne $null) { compare }` silently does nothing - so a deploy
// that destroyed the dataset would still report "data intact".
//
//   node scripts/store-counts.mjs [path/to/store.json]
//
// Defaults to MM_DATA_FILE, then data/store.json next to the repo root.
// Exits non-zero if the file is missing or unparseable, so a caller that
// checks $LASTEXITCODE cannot mistake a failure for an empty dataset.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = process.argv[2] || process.env.MM_DATA_FILE || path.join(root, "data", "store.json");

if (!fs.existsSync(file)) {
  console.error(`store not found: ${file}`);
  process.exit(2);
}

let d;
try {
  d = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`store is not valid JSON: ${e.message}`);
  process.exit(3);
}

const members = Object.values(d.members || {});
console.log(JSON.stringify({
  meetings: Object.keys(d.meetings || {}).length,
  schedules: Object.keys(d.schedules || {}).length,
  members: members.length,
  registered: members.filter((m) => m.status === "registered").length,
}));
