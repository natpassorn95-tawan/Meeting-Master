<#
.SYNOPSIS
  Deploy new Meeting Master code onto the Windows production host WITHOUT
  touching the data.

.DESCRIPTION
  The module keeps its entire dataset in data\store.json and its agenda
  attachments in uploads\ — and both are excluded from git and from the Docker
  image (.gitignore / .dockerignore). So "deploy" by unzipping or copying the
  whole folder over the live one replaces the app AND wipes the data. That is
  the failure this script exists to make impossible.

  It copies CODE ONLY, and it proves the data survived by counting rows before
  and after. A count mismatch is a hard failure with the restore command shown.

  Runs on the ADR-0021 native Windows service path (PM2 by default). It does not
  use Docker; see ..\DOCKER.md if the host ever moves to containers.

.PARAMETER Source
  Folder holding the NEW code (the unzipped release / a git checkout).

.PARAMETER AppRoot
  The live app folder on this host. Defaults to the parent of this script.

.PARAMETER Service
  'pm2' (default) or 'nssm' — matches windows-service\install-*-service.ps1.

.PARAMETER SkipBuild
  Skip npm ci + npm run build (only when the release already ships dist\).

.EXAMPLE
  .\deploy.ps1 -Source C:\releases\meeting-master-2026-08-14
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$AppRoot = (Split-Path -Parent $PSScriptRoot),
  [ValidateSet('pm2', 'nssm')][string]$Service = 'pm2',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'meeting-master'
$HealthUrl = 'http://localhost:8899/api/line/status'

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
function Die($msg) { Write-Host "`n   FAILED  $msg" -ForegroundColor Red; exit 1 }

# Row counts are the contract: whatever the deploy does, these must not change.
function Get-StoreCounts([string]$root) {
  $store = Join-Path $root 'data\store.json'
  if (-not (Test-Path $store)) { return $null }
  $js = @'
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const m=Object.values(d.members||{});
console.log(JSON.stringify({members:m.length,registered:m.filter(x=>x.status==="registered").length,
meetings:Object.keys(d.meetings||{}).length,schedules:Object.keys(d.schedules||{}).length}));
'@
  return (& node -e $js $store) | ConvertFrom-Json
}

function Format-Counts($c) {
  if ($null -eq $c) { return '(no store — first deploy)' }
  "$($c.meetings) meetings / $($c.schedules) schedules / $($c.members) members ($($c.registered) registered)"
}

# ── Preflight ──────────────────────────────────────────────────────────
Step 'Preflight'
if (-not (Test-Path (Join-Path $Source 'server\index.js'))) { Die "$Source does not look like a Meeting Master release (no server\index.js)" }
if (-not (Test-Path (Join-Path $AppRoot 'package.json'))) { Die "$AppRoot is not the app root (no package.json)" }
if (-not (Test-Path (Join-Path $AppRoot '.env'))) { Write-Host '   WARN  no .env in the app root — LINE will start disconnected' -ForegroundColor Yellow }
Ok "source  $Source"
Ok "target  $AppRoot"

$before = Get-StoreCounts $AppRoot
Ok "data before: $(Format-Counts $before)"

# ── Backup BEFORE anything is stopped or copied ────────────────────────
Step 'Backup'
if ($null -ne $before) {
  & node (Join-Path $AppRoot 'scripts\backup-store.mjs')
  if ($LASTEXITCODE -ne 0) { Die 'backup failed — refusing to deploy over data that cannot be backed up' }
} else {
  Ok 'nothing to back up yet'
}

# ── Stop ───────────────────────────────────────────────────────────────
Step "Stop service ($Service)"
if ($Service -eq 'pm2') { & pm2 stop $ServiceName } else { & nssm stop $ServiceName }
Start-Sleep -Seconds 2
Ok 'stopped'

# ── Copy CODE ONLY ─────────────────────────────────────────────────────
# /E copies subdirectories (adds + updates) but, unlike /MIR, never deletes
# anything already on the target — so an excluded folder can't be cleaned away.
# Everything holding state or secrets is excluded by name.
Step 'Copy code (data, uploads, backups and .env excluded)'
$excludeDirs = @('data', 'uploads', 'backups', 'node_modules', '.git', 'windows-service\logs')
$xd = $excludeDirs | ForEach-Object { Join-Path $AppRoot $_ }
& robocopy $Source $AppRoot /E /NFL /NDL /NJH /NJS /NP /XD @xd /XF '.env'
# robocopy exit codes < 8 are success (0 = no change, 1 = files copied, …).
if ($LASTEXITCODE -ge 8) { Die "robocopy failed with exit code $LASTEXITCODE" }
$global:LASTEXITCODE = 0
Ok 'code copied'

# ── Build ──────────────────────────────────────────────────────────────
# NOTE: never `npm ci --omit=dev` here — express is a devDependency in this
# project, so omitting dev deps breaks the server at runtime (see Dockerfile).
if (-not $SkipBuild) {
  Step 'Install + build'
  Push-Location $AppRoot
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { Die 'npm ci failed' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { Die 'npm run build failed' }
  } finally { Pop-Location }
  Ok 'dist\ rebuilt'
}

# ── Start ──────────────────────────────────────────────────────────────
Step "Start service ($Service)"
if ($Service -eq 'pm2') {
  & pm2 start (Join-Path $AppRoot 'windows-service\ecosystem.config.cjs')
  & pm2 save
} else {
  & nssm start $ServiceName
}

$healthy = $false
foreach ($i in 1..15) {
  Start-Sleep -Seconds 2
  try {
    if ((Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
}
if (-not $healthy) { Die "service did not answer $HealthUrl — check: pm2 logs $ServiceName" }
Ok 'service healthy'

# ── Prove the data survived ────────────────────────────────────────────
Step 'Verify data'
$after = Get-StoreCounts $AppRoot
Write-Host "   before: $(Format-Counts $before)"
Write-Host "   after:  $(Format-Counts $after)"

if ($null -ne $before) {
  if ($null -eq $after) { Die "THE STORE IS GONE. Restore now:`n     node scripts\backup-store.mjs --list`n     node scripts\backup-store.mjs --restore <newest>" }
  # Counts may legitimately grow (the app is live again and taking traffic);
  # they must never shrink.
  if ($after.meetings -lt $before.meetings -or $after.schedules -lt $before.schedules -or $after.members -lt $before.members) {
    Die "DATA LOSS DETECTED. Restore now:`n     node scripts\backup-store.mjs --list`n     node scripts\backup-store.mjs --restore <newest>"
  }
}
Ok 'data intact'
Write-Host "`nDeploy complete.`n" -ForegroundColor Green
