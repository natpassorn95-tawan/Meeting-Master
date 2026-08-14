<!-- owner: elara (AI Documentation) -->

# Changelog — Meeting Master (會議大師)

All notable, human-relevant changes to this module. Entries cite ADR / release
refs rather than free-form prose.

## Unreleased

### Fixed
- **Agenda attachments were invisible to participants.** A file the creator
  attached to a recurring schedule *after* an occurrence had been materialised
  never reached the participant opening that occurrence's agenda: the meeting
  record snapshots `attachments` at materialisation and the single-meeting read
  had no fallback, while 我的會議 did. `GET /api/meetings/:id` now falls back to
  the schedule's attachments (`store.withScheduleAttachments`); a file set on the
  meeting itself still wins. Regression tests in `server/attachments.test.js`.

### Changed
- **The store is now written atomically.** `saveStore()` writes to a temp file,
  `fsync`s, and renames into place, keeping the previous version as
  `data/store.json.bak`; `loadStore()` falls back to that `.bak` when the live
  file is missing or unparseable and preserves the bad file as `.corrupt`
  instead of silently starting empty. Previously a crash mid-write could
  truncate the only copy of the entire dataset. Tests in
  `server/store-persist.test.js`. `MM_DATA_FILE` now overrides the store path.

### Added
- `scripts/backup-store.mjs` — verified, rotating snapshots of `data/store.json`
  plus an attachment mirror (`npm run backup`, `--list`, `--verify`, `--restore`).
- `scripts/migrate-data.mjs` — one-time data move between hosts as a checksummed
  bundle (`--out` / `--check` / `--apply`), refusing unverified or destructive
  installs.
- `scripts/deploy.ps1` — Windows deploy that copies **code only** (`data`,
  `uploads`, `backups`, `.env` excluded), backs up first, health-checks, and
  fails the deploy if row counts shrink. Addresses data loss on redeploy.
- `backups/` added to `.gitignore` and `.dockerignore` (holds the same PII as
  the store).

### Docs
- Add `docs/DATA-AND-DEPLOY.md` — where the data lives, how to deploy without
  wiping it, backup/restore, host migration, and recovery. Cross-links
  [ADR-0021](../my-it-team/state/adr/ADR-0021-meeting-master-production-supervision.md)
  and [ADR-0028](../my-it-team/state/adr/ADR-0028-meeting-master-durable-datastore.md)
  (the durable SQLite + Prisma fix these measures hold the line until).
- Add `DOCKER.md` — operator-to-developer handover for running Meeting Master in
  Docker on a Windows host (Docker Desktop / WSL2): the 3 files, prerequisites,
  run commands, the `8898→8899` port mapping, data persistence, and the Windows
  auto-restart caveat. Cross-links `windows-service/README.md` and
  [ADR-0021](../my-it-team/state/adr/ADR-0021-meeting-master-production-supervision.md)
  (native Windows Service recommended now; Docker deferred, image ready — release
  `meeting-master-container-0.1.0`).
