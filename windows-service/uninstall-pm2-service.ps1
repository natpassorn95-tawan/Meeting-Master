<#
    uninstall-pm2-service.ps1
    Stop + remove the Meeting Master app from PM2, and (optionally) remove the
    PM2 Windows service installed by pm2-installer.

    RUN AS ADMINISTRATOR.
    Usage:
        powershell -ExecutionPolicy Bypass -File .\uninstall-pm2-service.ps1
#>

$ErrorActionPreference = 'Continue'  # keep going even if a step is already gone

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run as Administrator." }

# Talk to the machine-wide PM2 instance if pm2-installer configured one.
$machinePm2Home = [Environment]::GetEnvironmentVariable('PM2_HOME', 'Machine')
if ($machinePm2Home) { $env:PM2_HOME = $machinePm2Home }

Write-Host "Stopping + deleting meeting-master from PM2…"
pm2 stop   meeting-master 2>$null
pm2 delete meeting-master 2>$null
pm2 save --force 2>$null

Write-Host ""
$removeService = Read-Host "Also remove the PM2 Windows service entirely? (only if no other apps use PM2) [y/N]"
if ($removeService -match '^[Yy]') {
    $Pm2InstallerDir = Join-Path $env:TEMP 'pm2-installer'
    if (Test-Path $Pm2InstallerDir) {
        Push-Location $Pm2InstallerDir
        try {
            Write-Host "Removing PM2 Windows service (pm2-installer deconfigure/remove)…"
            npm run deconfigure 2>$null
            npm run remove
        } finally { Pop-Location }
    } else {
        Write-Warning "pm2-installer folder not found in TEMP. To remove the service manually, re-download pm2-installer and run 'npm run remove' in an elevated shell."
    }
} else {
    Write-Host "Left the PM2 service in place (app removed from its list). Reboot-safe: it just resurrects an empty list."
}

Write-Host "Done. Verify with:  pm2 list    and    Get-Service PM2"
