# Copy a host file or folder into the guest over PowerShell Direct.
# Usage: .\copy-in.ps1 <host path> <guest path> [-CredFile path]   (add -FromGuest to copy the other way)
param([Parameter(Mandatory)][string]$HostPath, [Parameter(Mandatory)][string]$GuestPath, [string]$CredFile, [switch]$FromGuest)
. "$PSScriptRoot\_common.ps1"
$s = New-NotchSession $CredFile
try {
    if ($FromGuest) {
        Copy-Item -FromSession $s -Path $GuestPath -Destination $HostPath -Recurse -Force
    } else {
        Invoke-Command -Session $s { param($p) New-Item -ItemType Directory -Force (Split-Path $p) | Out-Null } -ArgumentList $GuestPath
        Copy-Item -ToSession $s -Path $HostPath -Destination $GuestPath -Recurse -Force
    }
} finally { Remove-PSSession $s }
