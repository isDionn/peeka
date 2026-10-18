# Shared helpers, dot-sourced by the other scripts. Requires an elevated host shell.
$ErrorActionPreference = 'Stop'
if (-not $script:VMName) { $script:VMName = if ($env:NOTCHTEST_VM) { $env:NOTCHTEST_VM } else { 'NotchTest' } }

function Get-NotchCred([string]$CredFile) {
    if (-not $CredFile) { $CredFile = $env:NOTCHTEST_CRED_FILE }
    if (-not $CredFile -or -not (Test-Path $CredFile)) {
        throw 'Credential file missing: pass -CredFile or set NOTCHTEST_CRED_FILE (line 1 user, line 2 password).'
    }
    $lines = @(Get-Content $CredFile)
    if ($lines.Count -lt 2) { throw "Credential file $CredFile needs two lines: user, password." }
    $sec = ConvertTo-SecureString $lines[1] -AsPlainText -Force
    New-Object System.Management.Automation.PSCredential($lines[0], $sec)
}

function New-NotchSession([string]$CredFile) {
    New-PSSession -VMName $script:VMName -Credential (Get-NotchCred $CredFile)
}
