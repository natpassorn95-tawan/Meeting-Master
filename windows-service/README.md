# Meeting Master — Windows Service (bare-metal, no Docker)

Run Meeting Master (會議大師) as a proper Windows service instead of double-clicking
`啟動會議大師.bat`. This closes three gaps:

- **(a) auto-restart on crash**
- **(b) auto-start on boot**
- **(c) memory-limit restart** (restart if the process grows past 400 MB)

> **Windows-only. This is an ALTERNATIVE to the Docker path** (`../Dockerfile`,
> `../docker-compose.yml`). Both run the same server on **port 8899** — do **not**
> run both at once on the same host/port. Pick one.

The service runs the exact command that already works on this host:
`node server\index.js` (Express API + built web bundle, one process, port 8899).

---

## Prerequisites (both options)

- Node.js **v24** + npm installed and on `PATH`.
- The repo checked out on the Windows host (any folder — the scripts resolve paths
  relative to themselves via `$PSScriptRoot`, so no path editing is needed).
- Run PowerShell **as Administrator**.
- `meeting-master\.env` present with the LINE tokens etc. The server loads it
  itself at startup (`process.loadEnvFile`), so you do **not** have to inject env
  vars into the service — just keep `.env` next to `package.json`.
- The install scripts run `npm ci` + `npm run build` for you (the web bundle in
  `dist\` must exist because the server serves it).

---

## Option 1 — PM2  (recommended for this app)

Gives all three gaps including **(c) the 400 MB memory-limit restart**
(`max_memory_restart` in `ecosystem.config.cjs`). PM2 is registered as a Windows
service via [pm2-installer](https://github.com/jessety/pm2-installer) so the saved
app list resurrects on boot.

**Install** (elevated PowerShell):
```powershell
cd <repo>\meeting-master\windows-service
powershell -ExecutionPolicy Bypass -File .\install-pm2-service.ps1
```

**Verify:**
```powershell
pm2 list                 # meeting-master should be "online"
Get-Service PM2          # the PM2 Windows service (auto-start), Status = Running
pm2 show meeting-master  # details incl. restarts + memory
Invoke-WebRequest http://localhost:8899/api/line/status | Select-Object -Expand Content
```

**Logs:**
```powershell
pm2 logs meeting-master           # live tail
# or the files:
type .\logs\meeting-master.out.log
type .\logs\meeting-master.err.log
```

**Common ops:**
```powershell
pm2 restart meeting-master
pm2 stop    meeting-master
pm2 save                          # persist current state (re-run after changes)
```

**Uninstall:**
```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-pm2-service.ps1
```

---

## Option 2 — NSSM  (simplest; thin wrapper around the node command)

[NSSM](https://nssm.cc/) turns `node.exe server\index.js` into a native Windows
Service. Covers **(a)** and **(b)**. It does **NOT** do **(c)** — NSSM has no
memory-ceiling restart. Use PM2 if you need that.

**Get NSSM first** (it may not be installed):
```powershell
choco install nssm
# or download https://nssm.cc/download , unzip, and drop win64\nssm.exe
# next to these scripts (windows-service\nssm.exe)
```

**Install** (elevated PowerShell):
```powershell
cd <repo>\meeting-master\windows-service
powershell -ExecutionPolicy Bypass -File .\install-nssm-service.ps1
# if nssm isn't on PATH: add  -NssmPath "C:\tools\nssm\nssm.exe"
```

**Verify:**
```powershell
Get-Service MeetingMaster         # Status = Running, StartType = Automatic
nssm status MeetingMaster         # SERVICE_RUNNING
Invoke-WebRequest http://localhost:8899/api/line/status | Select-Object -Expand Content
```

**Logs:**
```powershell
type .\logs\meeting-master.out.log
type .\logs\meeting-master.err.log
```

**Common ops:**
```powershell
Restart-Service MeetingMaster
Stop-Service    MeetingMaster
Start-Service   MeetingMaster
```

**Uninstall:**
```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-nssm-service.ps1
```

---

## Which to pick

- **PM2** — recommended. Only option that covers all three gaps, incl. the 400 MB
  memory-limit restart; nicer log/monitor tooling (`pm2 list`, `pm2 monit`).
- **NSSM** — simplest, closest to the current `node server\index.js`; auto-start +
  auto-restart-on-crash only (no memory-limit restart).
- **Don't run both**, and don't run either alongside the Docker container — all
  three bind port 8899 and write the same `data\store.json`.

## Files
| File | Purpose |
|---|---|
| `ecosystem.config.cjs` | PM2 app definition (name, cwd, autorestart, `max_memory_restart: 400M`, logs) |
| `install-pm2-service.ps1` / `uninstall-pm2-service.ps1` | PM2 + pm2-installer setup / teardown |
| `install-nssm-service.ps1` / `uninstall-nssm-service.ps1` | NSSM service setup / teardown |
| `logs/` | stdout/stderr log files |
