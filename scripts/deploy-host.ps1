<#
.SYNOPSIS
  Deploy a reviewed commit onto the Windows host at D:\meeting_master.

.DESCRIPTION
  Called from the manual `deploy` job in .gitlab-ci.yml. Differs from
  scripts/deploy.ps1 (the PM2/NSSM path) because this host does not run PM2:
  the app is a plain `node server/index.js` tracked by .server.pid, kept alive
  by the MeetingMasterWatchdog scheduled task.

  The live folder is itself a git clone of this repo, so the deploy is a
  checkout of an exact SHA rather than a file copy. That keeps /api/version
  honest (it reads .git/HEAD) and makes "which commit is running" answerable.

  Data safety: data\, uploads\ and .env are gitignored, so a checkout cannot
  touch them. On top of that this takes a backup first and compares row counts
  afterwards, refusing to finish quietly if anything shrank.

.PARAMETER Sha
  The commit to deploy. Pass $CI_COMMIT_SHA so the host runs exactly what CI
  tested, not "whatever main happens to be by the time this runs".

.PARAMETER Force
  Skip the meeting-in-progress check. Only when you know the room is empty.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$AppRoot = "D:\meeting_master",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$WatchdogTask = "MeetingMasterWatchdog"
$DeployLock = Join-Path $AppRoot ".deploy.lock"
$PidFile = Join-Path $AppRoot ".server.pid"
$Port = 8899

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   OK  $m" -ForegroundColor Green }
function Die($m)  { Write-Host "`n   FAILED  $m" -ForegroundColor Red; exit 1 }

# Row counts are the contract: a deploy may add rows (the app is live again and
# taking traffic) but must never lose any.
#
# Counting lives in scripts/store-counts.mjs rather than an inline `node -e`
# snippet: PowerShell strips the double quotes when passing a string to a
# native command, so the inline form arrives as `require(fs)` and throws. That
# made this function return $null, which made the comparison below skip
# itself - a data-loss guard that always said "intact". Failing loudly here is
# the whole point, so a counting error is fatal rather than treated as "empty".
function Get-Counts {
  $store = Join-Path $AppRoot "data\store.json"
  if (-not (Test-Path $store)) { return $null }
  $out = & node (Join-Path $PSScriptRoot "store-counts.mjs") $store
  if ($LASTEXITCODE -ne 0) { Die "could not read row counts from $store - refusing to continue blind" }
  return $out | ConvertFrom-Json
}
function Show($c) { if ($null -eq $c) { "(no store)" } else { "$($c.meetings) meetings / $($c.schedules) schedules / $($c.members) members ($($c.registered) registered)" } }

# Local-only endpoint on purpose: /api/line/status calls the LINE API and
# returns 502 whenever LINE is having a bad day, which would fail a perfectly
# good deploy.
function Test-Health {
  try { return (Invoke-WebRequest -Uri "http://localhost:$Port/api/members" -TimeoutSec 5 -UseBasicParsing).StatusCode -eq 200 }
  catch { return $false }
}

# The server is started as `cmd /c node <AppRoot>\server\index.js > ...` (see
# the Start step for why the cmd wrapper is needed). Killing only the node PID
# leaves that wrapper behind - it does NOT exit with its child - so wrappers
# would pile up one per deploy. Stop both.
#
# Processes are matched on the absolute path to THIS app root appearing in
# their command line, which is why the launcher uses absolute paths: it makes
# the match specific enough that no other Node app on this host (and there are
# others) can be caught by it.
$ServerEntry = Join-Path $AppRoot "server\index.js"
function Stop-AppProcesses {
  $killed = 0
  foreach ($name in @("node.exe", "cmd.exe")) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ServerEntry) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $killed++ }
  }
  # Fall back to the recorded PID for a server started by the older launcher,
  # which used a relative path and so will not match above.
  if (Test-Path $PidFile) {
    $old = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($old) {
      $p = Get-Process -Id $old -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq "node") { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue; $killed++ }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
  return $killed
}

# ── Preflight ──────────────────────────────────────────────────────────
Step "Preflight"
if (-not (Test-Path (Join-Path $AppRoot ".git"))) { Die "$AppRoot is not a git clone" }
if (-not (Test-Path (Join-Path $AppRoot "data"))) { Die "$AppRoot has no data\ - wrong folder?" }
Ok "app root  $AppRoot"
Ok "target    $Sha"

if ($Force) {
  Write-Host "   WARN  --force: skipping the meeting-in-progress check" -ForegroundColor Yellow
} else {
  # Run the checker from THIS checkout (new code) against the LIVE store.
  $env:MM_DATA_FILE = Join-Path $AppRoot "data\store.json"
  & node (Join-Path $PSScriptRoot "check-meeting-window.mjs")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`n   Deploy stopped: a meeting is running. Nothing was changed." -ForegroundColor Yellow
    exit 1
  }
  Remove-Item Env:\MM_DATA_FILE -ErrorAction SilentlyContinue
  Ok "no meeting in progress"
}

$before = Get-Counts
Ok "data before: $(Show $before)"

# ── Backup ─────────────────────────────────────────────────────────────
Step "Backup"
& node (Join-Path $AppRoot "scripts\backup-store.mjs")
if ($LASTEXITCODE -ne 0) { Die "backup failed - refusing to deploy over data that cannot be backed up" }

# ── Hold off the watchdog ──────────────────────────────────────────────
# A lock file rather than disabling the scheduled task: if this job is killed
# half way, a disabled task would stay disabled and nothing would be watching
# the server. The watchdog ignores a lock older than 15 minutes, so the worst
# case here self-heals.
Step "Pause watchdog"
Set-Content -Path $DeployLock -Value (Get-Date -Format 's') -Encoding ascii
Ok "deploy lock placed"

try {
  # ── Stop ─────────────────────────────────────────────────────────────
  Step "Stop server"
  $stopped = Stop-AppProcesses
  Start-Sleep -Seconds 1
  Ok "stopped $stopped process(es)"

  # ── Code ─────────────────────────────────────────────────────────────
  # reset --hard only rewrites tracked files. data\, uploads\ and .env are
  # gitignored; the host's ops scripts are untracked. None can be touched.
  Step "Update code to $Sha"
  & git -C $AppRoot fetch origin --quiet
  if ($LASTEXITCODE -ne 0) { Die "git fetch failed" }
  & git -C $AppRoot reset --hard $Sha --quiet
  if ($LASTEXITCODE -ne 0) { Die "git reset to $Sha failed" }
  $now = (& git -C $AppRoot rev-parse --short HEAD).Trim()
  Ok "checked out $now"

  # ── Build ────────────────────────────────────────────────────────────
  # Never `npm ci --omit=dev`: express is a devDependency in this project.
  Step "Install + build"
  Push-Location $AppRoot
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { Die "npm ci failed" }
    # esbuild's postinstall is gated by allowScripts; without it vite build
    # dies on a missing binary.
    & npm approve-scripts esbuild 2>&1 | Out-Null
    & npm run build
    if ($LASTEXITCODE -ne 0) { Die "npm run build failed" }
  } finally { Pop-Location }
  Ok "dist rebuilt"

  # ── Start ────────────────────────────────────────────────────────────
  Step "Start server"
  New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot "logs") | Out-Null
  # NOT Start-Process: it creates the child with handle inheritance on, so the
  # long-lived server keeps the CI job's stdout pipe open and the job hangs
  # after the deploy has actually finished. Win32_Process.Create starts a
  # genuinely detached process, and cmd handles the redirection.
  # Absolute paths so Stop-AppProcesses can identify these processes as ours.
  $outLog = Join-Path $AppRoot "logs\server.out.log"
  $errLog = Join-Path $AppRoot "logs\server.err.log"
  $cmd = "cmd.exe /c node `"$ServerEntry`" >> `"$outLog`" 2>> `"$errLog`""
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $AppRoot }
  if ($r.ReturnValue -ne 0) { Die "could not start the server (Win32_Process.Create returned $($r.ReturnValue))" }

  $healthy = $false
  foreach ($i in 1..15) { Start-Sleep -Seconds 2; if (Test-Health) { $healthy = $true; break } }

  # Record the node PID, not the cmd wrapper's: .server.pid is what
  # stop-meeting-master.ps1 and the watchdog act on. Resolve it from whoever
  # actually holds the port.
  if ($healthy) {
    $owner = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($owner) {
      $owner | Out-File -FilePath $PidFile -Encoding ascii
      Ok "started PID $owner"
    } else {
      Write-Host "   WARN  server is up but the PID could not be resolved; .server.pid not written" -ForegroundColor Yellow
    }
  }
  if (-not $healthy) {
    Write-Host "`n   Server did not answer. Last log lines:" -ForegroundColor Red
    Get-Content (Join-Path $AppRoot "logs\server.err.log") -Tail 20 -ErrorAction SilentlyContinue
    Die "health check failed"
  }
  Ok "server healthy"
}
finally {
  # Always hand the watchdog back, even if something above threw.
  Remove-Item $DeployLock -Force -ErrorAction SilentlyContinue
  Write-Host "   OK  watchdog resumed" -ForegroundColor Green
}

# ── Prove the data survived ────────────────────────────────────────────
Step "Verify data"
$after = Get-Counts
Write-Host "   before: $(Show $before)"
Write-Host "   after:  $(Show $after)"
if ($null -ne $before) {
  if ($null -eq $after) { Die "THE STORE IS GONE. Restore: node scripts\backup-store.mjs --list then --restore <newest>" }
  if ($after.meetings -lt $before.meetings -or $after.schedules -lt $before.schedules -or $after.members -lt $before.members) {
    Die "DATA LOSS DETECTED. Restore: node scripts\backup-store.mjs --list then --restore <newest>"
  }
}
Ok "data intact"

$running = (Invoke-WebRequest -Uri "http://localhost:$Port/api/version" -TimeoutSec 5 -UseBasicParsing).Content
Write-Host "`nDeployed. /api/version -> $running`n" -ForegroundColor Green
