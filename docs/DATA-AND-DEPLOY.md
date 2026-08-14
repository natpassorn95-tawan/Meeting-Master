<!-- owner: buzz (AI DevOps) · review: elara -->

# Meeting Master — data, deployment and backup

Why this document exists: Meeting Master keeps its **entire dataset in one
file**, `data/store.json`, and that file is listed in both `.gitignore` and
`.dockerignore`. So a "deploy" that copies or unzips the whole folder over the
live one replaces the app *and wipes the data*. That is not a bug in the deploy
— it is what the app currently is. The durable fix is
[ADR-0028](../../my-it-team/state/adr/ADR-0028-meeting-master-durable-datastore.md)
(move to SQLite + Prisma). Everything below is what keeps production safe until
then.

## The three rules

1. **Never copy a release folder over the live app folder.** Use
   `scripts/deploy.ps1`, which copies code only.
2. **Back up before every deploy.** `deploy.ps1` does it for you and refuses to
   continue if the backup fails.
3. **`data/` and `uploads/` belong to the host, not to the release.** Nothing in
   a release should ever contain them.

## Where the data lives

| Path | What | Survives redeploy? |
|---|---|---|
| `data/store.json` | meetings, schedules, members, responses, check-ins | only if you don't overwrite it |
| `data/store.json.bak` | previous version, rotated on every save | automatic |
| `uploads/` | agenda attachments (PDF/images) | only if you don't overwrite it |
| `backups/` | timestamped snapshots + attachment mirror | created by the backup script |
| `.env` | LINE tokens, `PUBLIC_BASE_URL` | host-owned, never in a release |

`MM_DATA_FILE` overrides the store location if you need it on another disk.

## Deploying (Windows host, PM2 — the ADR-0021 path)

```powershell
cd C:\apps\meeting-master
.\scripts\deploy.ps1 -Source C:\releases\meeting-master-2026-08-14
```

It runs: preflight → backup → stop service → copy **code only** (`data`,
`uploads`, `backups`, `node_modules`, `.env` excluded) → `npm ci` +
`npm run build` → start → health check → **compare row counts before and after**
and fail loudly if anything shrank.

Add `-Service nssm` if the host uses the NSSM install, `-SkipBuild` if the
release already ships `dist\`.

> Never run `npm ci --omit=dev` here — `express` is a devDependency in this
> project, so omitting dev dependencies breaks the server at runtime.

## Which build is a host running?

```
http://<host>:8899/api/version   →  {"version":"0.1.0","commit":"5aba60e","startedAt":"…"}
```

Compare `commit` with `git log -1 --format=%h` on your machine. If they differ,
that host has not been deployed — which is the usual reason a fix that passes
locally "still doesn't work" in production. `startedAt` shows when the process
last restarted; a deploy that didn't restart the service leaves the old code
running.

The commit is read from `.git/HEAD`. A Docker image has no `.git`, so pass
`MM_COMMIT` at build/run time there.

## Backups

```bash
npm run backup           # snapshot + mirror attachments + rotate (keeps 30)
npm run backup:list      # what's held, with row counts
node scripts/backup-store.mjs --verify           # is the live store readable?
node scripts/backup-store.mjs --restore <file>   # put one back
```

Every snapshot is parsed and re-read after copying, so a backup that lists in
`--list` with counts is one you can actually restore. A restore always sets the
current store aside first.

Schedule it daily with Task Scheduler:

```powershell
schtasks /create /tn "MeetingMaster Backup" /tr "node C:\apps\meeting-master\scripts\backup-store.mjs" /sc daily /st 02:00 /ru SYSTEM
```

**`backups/` is on the same disk as the data.** Copy it off-host on a schedule —
a disk failure otherwise takes the data and every backup with it. The backups
contain staff PII (names, employee IDs, emails, LINE user ids), so treat the
destination as PII storage; Duke owns that call (ADR-0028, D-4).

## Moving the data to a new host (one-time)

On the machine that currently holds the live data:

```bash
node scripts/migrate-data.mjs --out ../meeting-master-data-2026-08-14
```

Copy the folder across (zip it if you like), then on the production host:

```powershell
node scripts\migrate-data.mjs --check <folder>   # verify, change nothing
node scripts\migrate-data.mjs --apply <folder>   # install
```

The bundle carries a SHA-256 for every file plus the row counts. `--apply`
refuses a bundle that fails verification, and refuses to overwrite a host that
already has data unless you pass `--force`.

## If the store is lost or corrupt

1. The server recovers by itself where it can: on boot it falls back to
   `data/store.json.bak` and keeps the unreadable file as `.corrupt`. Check the
   log for `recovered from store.json.bak`.
2. Otherwise: `node scripts/backup-store.mjs --list`, pick the newest good
   snapshot, `--restore` it, then restart the service.
3. Attachments live in `uploads/`; restore them from `backups/uploads-mirror/`.

## Crash safety

Saves are atomic — the store is written to a temp file, `fsync`ed, and renamed
into place, with the previous version kept as `.bak`. A crash or power cut can
lose the last write, never the whole dataset. Covered by
`server/store-persist.test.js` (`npm test`).

## Known limits until ADR-0028 lands

- Single writer only. Do not run two instances against one `data/` folder, and
  do not cluster PM2 (`exec_mode: fork` is deliberate).
- The store is plaintext JSON containing staff PII; file-system ACLs are the
  only protection.
- Backup rotation keeps 30 snapshots on the same disk. Off-host copying is
  manual until Buzz automates it.
