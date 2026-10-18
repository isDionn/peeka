# Notch: registers the sparse package of the Windows notification mirror (Wave 6, owner decision 3).
# The OWNER runs this once, by hand; Notch never registers anything itself. Needs Developer Mode
# (Settings > System > For developers > Developer Mode), because the package is not signed.
#
#   powershell -ExecutionPolicy Bypass -File register.ps1 [-ExeDir <folder that holds peeka.exe>]
#
# -ExeDir defaults to notch\target\release (the local build). Point it at wherever peeka.exe really runs from;
# after moving peeka.exe, run unregister.ps1 and this again. Then quit and start Notch again, and turn the mirror
# on in Notch's settings (Windows asks once for notification access).
# What it does: copies AppxManifest.xml and three PNG logos (made from ..\icons\icon.ico) into
# %LOCALAPPDATA%\notch-identity, then Add-AppxPackage -Register ... -ExternalLocation <ExeDir>. Nothing is installed
# or copied next to peeka.exe; unregister.ps1 undoes it.
param([string]$ExeDir = (Join-Path $PSScriptRoot '..\..\target\release'))
$ErrorActionPreference = 'Stop'

$dev = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
if (-not $dev -or $dev.AllowDevelopmentWithoutDevLicense -eq 0) {
    Write-Host 'Gelistirici Modu kapali. Ayarlar > Sistem > Gelistiriciler icin > Gelistirici Modu acilip tekrar denenmeli.'
    exit 1
}
$ExeDir = (Resolve-Path $ExeDir).Path
if (-not (Test-Path (Join-Path $ExeDir 'peeka.exe'))) {
    Write-Host "peeka.exe bulunamadi: $ExeDir  (-ExeDir ile peeka.exe'nin klasoru verilmeli)"
    exit 1
}

$stage = Join-Path $env:LOCALAPPDATA 'notch-identity'
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Force $assets | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'AppxManifest.xml') $stage -Force

Add-Type -AssemblyName System.Drawing
$ico = Join-Path $PSScriptRoot '..\icons\icon.ico'
foreach ($logo in @(@('StoreLogo.png', 50), @('Square44x44Logo.png', 44), @('Square150x150Logo.png', 150))) {
    $icon = New-Object System.Drawing.Icon ((Resolve-Path $ico).Path), 256, 256
    $bmp = New-Object System.Drawing.Bitmap $logo[1], $logo[1]
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($icon.ToBitmap(), 0, 0, $logo[1], $logo[1])
    $bmp.Save((Join-Path $assets $logo[0]), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $icon.Dispose()
}

Add-AppxPackage -Register (Join-Path $stage 'AppxManifest.xml') -ExternalLocation $ExeDir
Get-AppxPackage -Name 'Notch.Mirror' | Select-Object Name, Version, InstallLocation
Write-Host 'Kayit tamam. Peeka kapatilip yeniden acilmali, sonra Ayarlar > Bildirimler > Windows bildirim aynasi.'
