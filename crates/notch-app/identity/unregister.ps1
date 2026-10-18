# Notch: removes the notification mirror's sparse package (undoes register.ps1). The OWNER runs it, by hand.
#   powershell -ExecutionPolicy Bypass -File unregister.ps1
# Quit Notch first. Notch keeps working without the package; only the mirror stops (its setting shows why).
$ErrorActionPreference = 'Stop'
Get-AppxPackage -Name 'Notch.Mirror' | Remove-AppxPackage
$stage = Join-Path $env:LOCALAPPDATA 'notch-identity'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Write-Host 'Package removed.'
