# Notch: removes the notification mirror's sparse package (undoes register.ps1). The OWNER runs it, by hand.
#   powershell -ExecutionPolicy Bypass -File unregister.ps1
# Quit Notch first. Notch keeps working without the package; only the mirror stops (its setting shows why).
# The package and folder names come from the brand file (-Brand, default the repo's brand\peeka.json).
param([string]$Brand = (Join-Path $PSScriptRoot '..\..\..\brand\peeka.json'))
$ErrorActionPreference = 'Stop'
$b = Get-Content -Raw $Brand | ConvertFrom-Json
Get-AppxPackage -Name $b.mirror.package | Remove-AppxPackage
$stage = Join-Path $env:LOCALAPPDATA "$($b.code_name)-identity"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Write-Host 'Package removed.'
