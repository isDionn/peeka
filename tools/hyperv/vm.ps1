# Usage: .\vm.ps1 start | stop | checkpoint <name> | restore <name> | status
param([Parameter(Mandatory)][ValidateSet('start', 'stop', 'checkpoint', 'restore', 'status')][string]$Action, [string]$Name)
. "$PSScriptRoot\_common.ps1"
if ($Action -in 'checkpoint', 'restore' -and -not $Name) { throw "$Action needs a checkpoint name" }

switch ($Action) {
    'start'      { Start-VM -Name $script:VMName }
    'stop'       { Stop-VM -Name $script:VMName -Force }   # guest shutdown via integration services
    'checkpoint' { Checkpoint-VM -Name $script:VMName -SnapshotName $Name }
    'restore'    { Restore-VMSnapshot -VMName $script:VMName -Name $Name -Confirm:$false
                   # A Standard checkpoint taken while running restores to Saved; resume it.
                   if ((Get-VM $script:VMName).State -ne 'Running') { Start-VM -Name $script:VMName } }
    'status'     { }
}
Get-VM $script:VMName | Select-Object Name, State, Heartbeat, Uptime
