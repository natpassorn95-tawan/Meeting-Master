<#
    install-nssm-service.ps1
    Install Meeting Master (會議大師) as a native Windows Service using NSSM
    (the Non-Sucking Service Manager). NSSM wraps the EXACT command that already
    works on this host — `node.exe server\index.js` — as a real service:
      (a) auto-restart on crash  -> AppExit Default = Restart + throttling
      (b) auto-start on boot     -> Start = SERVICE_AUTO_START
      (c) memory-limit restart   -> NOT supported by NSSM. See note at the end;
                                    use the PM2 path if you need max_memory_restart.

    RUN AS ADMINISTRATOR.
    Usage:
        powershell -ExecutionPolicy Bypass -File .\install-nssm-service.ps1
        # optional: point at a specific nssm.exe
        powershell -ExecutionPolicy Bypass -File .\install-nssm-service.ps1 -NssmPath "C:\tools\nssm\nssm.exe"
#>

param(
    [string]$NssmPath,
    [string]$ServiceName = 'MeetingMaster'
)

$ErrorActionPreference = 'Stop'

# --- 0. Must be elevated ---------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "This script must be run as Administrator (needed to create a Windows Service)." }

# --- Paths (resolve relative to this script) -------------------------------
$ScriptDir = $PSScriptRoot
$AppRoot   = Split-Path -Parent $ScriptDir           # …\meeting-master
$LogDir    = Join-Path $ScriptDir 'logs'
$Server    = Join-Path $AppRoot 'server\index.js'
$OutLog    = Join-Path $LogDir 'meeting-master.out.log'
$ErrLog    = Join-Path $LogDir 'meeting-master.err.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $Server)) { throw "Cannot find server entry point: $Server" }

# --- 1. Locate node.exe (absolute path — services have no user PATH) --------
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw "node.exe not found in PATH. Install Node.js (v24) first." }
$NodeExe = $node.Source
Write-Host "node.exe : $NodeExe"
Write-Host "server   : $Server"
Write-Host "app root : $AppRoot"

# --- 2. Locate nssm.exe ----------------------------------------------------
if (-not $NssmPath) {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { $NssmPath = $cmd.Source }
    elseif (Test-Path (Join-Path $ScriptDir 'nssm.exe')) { $NssmPath = Join-Path $ScriptDir 'nssm.exe' }
}
if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    Write-Warning "nssm.exe not found. Obtain it, then re-run (or pass -NssmPath):"
    Write-Warning "  Option A (Chocolatey):  choco install nssm"
    Write-Warning "  Option B (manual):      download https://nssm.cc/download , unzip,"
    Write-Warning "                          and copy win64\nssm.exe next to this script."
    throw "nssm.exe is required."
}
Write-Host "nssm     : $NssmPath"

# --- 3. Build the app (ensures dist/ exists for the server to serve) --------
Push-Location $AppRoot
try {
    if (-not (Test-Path (Join-Path $AppRoot 'node_modules'))) {
        Write-Host "Installing dependencies (npm ci — full tree; express is a devDependency)…"
        if (Test-Path (Join-Path $AppRoot 'package-lock.json')) { npm ci } else { npm install }
    }
    Write-Host "Building web bundle (npm run build)…"
    npm run build
} finally {
    Pop-Location
}

# --- 4. Remove any prior service of the same name --------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing service '$ServiceName' found — removing it first…"
    & $NssmPath stop   $ServiceName confirm 2>$null
    & $NssmPath remove $ServiceName confirm
    Start-Sleep -Seconds 2
}

# --- 5. Install + configure the service ------------------------------------
Write-Host "Installing service '$ServiceName'…"
& $NssmPath install $ServiceName "$NodeExe" "server\index.js"

& $NssmPath set $ServiceName AppDirectory  "$AppRoot"           # cwd so ../.env, ../dist, ../data resolve
& $NssmPath set $ServiceName DisplayName   "Meeting Master (會議大師)"
& $NssmPath set $ServiceName Description    "Meeting Master API + web (Express, port 8899)."
& $NssmPath set $ServiceName Start          SERVICE_AUTO_START  # (b) auto-start on boot

# (a) Restart on any exit, with throttling to avoid tight crash-loops.
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 2000   # wait 2s before restarting
& $NssmPath set $ServiceName AppThrottle     1500   # a start faster than 1.5s counts as a crash-loop

# Logging: redirect stdout/stderr to files, with rotation.
& $NssmPath set $ServiceName AppStdout $OutLog
& $NssmPath set $ServiceName AppStderr $ErrLog
& $NssmPath set $ServiceName AppStdoutCreationDisposition 4   # append
& $NssmPath set $ServiceName AppStderrCreationDisposition 4   # append
& $NssmPath set $ServiceName AppRotateFiles   1
& $NssmPath set $ServiceName AppRotateOnline  1
& $NssmPath set $ServiceName AppRotateBytes   10485760        # rotate at 10 MB

# Environment. The app self-loads .env via process.loadEnvFile, so these are just
# defaults; anything in meeting-master\.env still wins for keys the app reads.
& $NssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "PORT=8899"

# --- 6. Start it -----------------------------------------------------------
Write-Host "Starting service…"
& $NssmPath start $ServiceName

Start-Sleep -Seconds 2
& $NssmPath status $ServiceName
Write-Host ""
Write-Host "Done. Verify with:"
Write-Host "  Get-Service $ServiceName"
Write-Host "  nssm status $ServiceName"
Write-Host "  Invoke-WebRequest http://localhost:8899/api/line/status"
Write-Host "Logs: $LogDir"
Write-Host ""
Write-Host "NOTE: NSSM has no memory-ceiling restart (gap 'c'). If you need the"
Write-Host "      400 MB max_memory_restart behaviour, use the PM2 path instead."
