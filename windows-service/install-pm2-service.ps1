<#
    install-pm2-service.ps1
    Install Meeting Master (會議大師) as a PM2-managed process that auto-starts on
    Windows boot, auto-restarts on crash, and restarts on a 400 MB memory ceiling.

    Uses the pm2-installer approach (https://github.com/jessety/pm2-installer):
    it registers PM2 itself as a Windows Service, so `pm2 resurrect` runs on boot
    and brings the saved app list (our ecosystem) back up automatically.

    RUN AS ADMINISTRATOR (right-click > Run with PowerShell as Admin, or an
    elevated shell). Node.js (v24 on this host) and npm must already be installed.

    Usage:
        powershell -ExecutionPolicy Bypass -File .\install-pm2-service.ps1
#>

$ErrorActionPreference = 'Stop'

# --- 0. Must be elevated ---------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "This script must be run as Administrator (needed to register the PM2 Windows service)."
}

# --- Paths (resolve relative to this script, not a hard-coded location) -----
$ScriptDir = $PSScriptRoot
$AppRoot   = Split-Path -Parent $ScriptDir   # …\meeting-master
$LogDir    = Join-Path $ScriptDir 'logs'
$Ecosystem = Join-Path $ScriptDir 'ecosystem.config.cjs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "App root : $AppRoot"
Write-Host "Ecosystem: $Ecosystem"
Write-Host ""

# --- 1. Node / npm present? ------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node.exe not found in PATH." }
if (-not (Get-Command npm  -ErrorAction SilentlyContinue)) { throw "npm not found in PATH." }
Write-Host ("node: " + (node -v) + "  npm: " + (npm -v))

# --- 2. Install app dependencies (production) ------------------------------
Push-Location $AppRoot
try {
    Write-Host "Installing app dependencies (npm ci)…"
    # express is a devDependency of this app, so install the FULL tree (not --omit=dev).
    if (Test-Path (Join-Path $AppRoot 'package-lock.json')) { npm ci } else { npm install }

    Write-Host "Building web bundle (npm run build)…"
    npm run build
} finally {
    Pop-Location
}

# --- 3. Install PM2 globally ----------------------------------------------
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "Installing PM2 globally…"
    npm install -g pm2
} else {
    Write-Host ("PM2 already installed: " + (pm2 -v))
}

# --- 4. Register PM2 as a Windows service via pm2-installer ----------------
# pm2-installer sets a machine-wide PM2_HOME and installs a "PM2" Windows service
# that runs `pm2 resurrect` at boot. It is distributed as a GitHub repo you run
# `npm run setup` inside. We fetch the latest source zip and run its setup.
$Pm2InstallerDir = Join-Path $env:TEMP 'pm2-installer'
if (Test-Path $Pm2InstallerDir) { Remove-Item -Recurse -Force $Pm2InstallerDir }

Write-Host "Downloading pm2-installer…"
$Zip = Join-Path $env:TEMP 'pm2-installer.zip'
try {
    Invoke-WebRequest -Uri 'https://codeload.github.com/jessety/pm2-installer/zip/refs/heads/main' -OutFile $Zip
    Expand-Archive -Path $Zip -DestinationPath $env:TEMP -Force
    Rename-Item -Path (Join-Path $env:TEMP 'pm2-installer-main') -NewName 'pm2-installer' -Force
} catch {
    Write-Warning "Could not download pm2-installer automatically: $($_.Exception.Message)"
    Write-Warning "Manual fallback: download https://github.com/jessety/pm2-installer, unzip, and run 'npm run setup' in an elevated shell, then re-run steps 5-6 below."
    throw
}

Push-Location $Pm2InstallerDir
try {
    Write-Host "Running pm2-installer setup (installs the PM2 Windows service + sets PM2_HOME)…"
    npm run setup
    # Allow the service to accept commands from the local service account.
    npm run configure        2>$null
    npm run configure-policy 2>$null
} finally {
    Pop-Location
}

# pm2-installer sets PM2_HOME machine-wide (e.g. C:\ProgramData\pm2). Load it into
# THIS session so the following pm2 commands talk to the service's PM2 instance.
$machinePm2Home = [Environment]::GetEnvironmentVariable('PM2_HOME', 'Machine')
if ($machinePm2Home) {
    $env:PM2_HOME = $machinePm2Home
    Write-Host "PM2_HOME = $env:PM2_HOME"
}

# --- 5. Start the app from the ecosystem file -----------------------------
Write-Host "Starting meeting-master from ecosystem…"
pm2 start "$Ecosystem"

# --- 6. Persist the process list so it resurrects on boot -----------------
pm2 save
Write-Host ""
Write-Host "Done. Verify with:  pm2 list    and    Get-Service PM2"
Write-Host "Logs: $LogDir  (or 'pm2 logs meeting-master')"
Write-Host ""
Write-Host "NOTE: PM2_HOME was set machine-wide. In any NEW shell, that env var will"
Write-Host "already be present; if 'pm2 list' looks empty there, run: `$env:PM2_HOME='$machinePm2Home'"
