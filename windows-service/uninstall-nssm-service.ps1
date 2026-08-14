<#
    uninstall-nssm-service.ps1
    Stop + remove the Meeting Master Windows Service created by NSSM.

    RUN AS ADMINISTRATOR.
    Usage:
        powershell -ExecutionPolicy Bypass -File .\uninstall-nssm-service.ps1
        powershell -ExecutionPolicy Bypass -File .\uninstall-nssm-service.ps1 -NssmPath "C:\tools\nssm\nssm.exe"
#>

param(
    [string]$NssmPath,
    [string]$ServiceName = 'MeetingMaster'
)

$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run as Administrator." }

$ScriptDir = $PSScriptRoot

# Locate nssm.exe the same way the installer did.
if (-not $NssmPath) {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { $NssmPath = $cmd.Source }
    elseif (Test-Path (Join-Path $ScriptDir 'nssm.exe')) { $NssmPath = Join-Path $ScriptDir 'nssm.exe' }
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' not found — nothing to do."
    return
}

if ($NssmPath -and (Test-Path $NssmPath)) {
    Write-Host "Stopping + removing service '$ServiceName' via NSSM…"
    & $NssmPath stop   $ServiceName confirm 2>$null
    & $NssmPath remove $ServiceName confirm
} else {
    Write-Warning "nssm.exe not found; falling back to sc.exe."
    sc.exe stop   $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
}

Start-Sleep -Seconds 1
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Warning "Service still present — a reboot may be required to fully clear it."
} else {
    Write-Host "Service '$ServiceName' removed. Verify: Get-Service $ServiceName (should error/not found)."
}
