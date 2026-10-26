# Run a PowerShell command inside the auto-logged-on user's interactive desktop session (not session 0).
# A one-shot scheduled task (LogonType Interactive) runs it; stdout+stderr are copied back and printed.
# Usage: .\run-interactive.ps1 '<powershell command>' [-CredFile path] [-TimeoutSec 300] [-OutFile host.txt]
param([Parameter(Mandatory)][string]$Command, [string]$CredFile, [int]$TimeoutSec = 300, [string]$OutFile)
. "$PSScriptRoot\_common.ps1"
$cred = Get-NotchCred $CredFile
$s = New-PSSession -VMName $script:VMName -Credential $cred
try {
    $guestOut = Invoke-Command -Session $s -ArgumentList $Command, $cred.UserName, $TimeoutSec -ScriptBlock {
        param($cmd, $user, $timeout)
        $ErrorActionPreference = 'Stop'
        $id = 'notch-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
        $dir = 'C:\NotchHarness'
        New-Item -ItemType Directory -Force $dir | Out-Null
        $ps1 = "$dir\$id.ps1"; $out = "$dir\$id.out.txt"
        # Wrapper: run the command, capture every stream, always leave an exit marker.
        Set-Content $ps1 -Encoding utf8 -Value @"
try { & { $cmd } *> '$out' } catch { `$_ | Out-String | Add-Content '$out' }
"@
        # conhost --headless: no console window at all. A plain powershell.exe makes Windows Terminal/conhost take the foreground even with -WindowStyle Hidden, which closes Peeka's panels (blur rule) between harness commands.
        $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$ps1`""
        # Limited: PS Direct gets a UAC-filtered token, which may not register Highest tasks.
        $principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$user" -LogonType Interactive -RunLevel Limited
        try {
            # The VM reports a battery; default task settings leave the task Queued forever while it runs on it.
            $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
            Register-ScheduledTask -TaskName $id -Action $action -Principal $principal -Settings $settings -Force | Out-Null
            Start-ScheduledTask -TaskName $id
            $deadline = (Get-Date).AddSeconds($timeout)
            Start-Sleep -Milliseconds 500
            while ((Get-ScheduledTask -TaskName $id).State -eq 'Running') {
                if ((Get-Date) -gt $deadline) { Stop-ScheduledTask -TaskName $id; throw "timed out after $timeout s" }
                Start-Sleep -Milliseconds 300
            }
            $info = Get-ScheduledTaskInfo -TaskName $id
            if ($info.LastTaskResult -eq 267011) { throw 'task never ran: is the user logged on interactively?' }
        } finally {
            Unregister-ScheduledTask -TaskName $id -Confirm:$false -ErrorAction SilentlyContinue
            Remove-Item $ps1 -ErrorAction SilentlyContinue
        }
        $out
    }
    $local = if ($OutFile) { $OutFile } else { Join-Path $env:TEMP ([IO.Path]::GetFileName($guestOut)) }
    Copy-Item -FromSession $s -Path $guestOut -Destination $local -Force -ErrorAction SilentlyContinue
    Invoke-Command -Session $s { param($p) Remove-Item $p -ErrorAction SilentlyContinue } -ArgumentList $guestOut
    if (Test-Path $local) { Get-Content $local; if (-not $OutFile) { Remove-Item $local } }
} finally { Remove-PSSession $s }
