# Hyper-V test VM harness (NotchTest)

Host-side scripts to drive the `NotchTest` Hyper-V VM headlessly, so Peeka can be
tested in a real Windows 11 desktop session without touching the owner's desktop.
Never open `vmconnect`; everything goes through PowerShell Direct and Hyper-V WMI.

The VM (Gen 2, vTPM, Secure Boot, 4 vCPU, 8 GB static RAM, 64 GB dynamic VHDX, 1920x1080)
lives in `C:\VMs\NotchTest\`, outside the repo. Nothing from there goes into git.

## Requirements

- Elevated PowerShell on the host (Hyper-V cmdlets and WMI need admin).
- A credential file: line 1 user name, line 2 password. Pass it with `-CredFile <path>`
  or set `NOTCHTEST_CRED_FILE`. It is kept outside the repo; never commit it.
- Optional: `NOTCHTEST_VM` to target a VM other than `NotchTest`.

## Commands

| Script | What it does |
|---|---|
| `vm.ps1 start\|stop\|status` | Start, shut down (guest shutdown), or show state/heartbeat. |
| `vm.ps1 checkpoint <name>` / `restore <name>` | Standard checkpoint; restore resumes the VM. Clean baseline: `temiz`. |
| `copy-in.ps1 <host> <guest>` | Copy a file/folder into the guest (PowerShell Direct). `-FromGuest` copies back. |
| `run-interactive.ps1 '<ps command>'` | Runs the command in the logged-on user's desktop session (not session 0) through a one-shot scheduled task; prints its output. `-OutFile` keeps it, `-TimeoutSec` limits it. |
| `screenshot.ps1 <out.png>` | Host-side capture of the guest console via `GetVirtualSystemThumbnailImage` (1920x1080). Works without guest login. |
| `measure.ps1` | JSON with screen size/DPI, work area (`SPI_GETWORKAREA`), `Shell_TrayWnd` visibility + rect, and a real maximised window rect. |

## Example

```powershell
$env:NOTCHTEST_CRED_FILE = 'C:\path\outside\repo\vm-cred.txt'
.\vm.ps1 restore temiz
.\copy-in.ps1 .\build\peeka.exe C:\Peeka\peeka.exe
.\run-interactive.ps1 'Start-Process C:\Peeka\peeka.exe; Start-Sleep 5; Get-Process peeka'
.\screenshot.ps1 $env:TEMP\after.png
.\measure.ps1
```

## Notes

- `run-interactive.ps1` runs with the user's normal (non-elevated) token: PowerShell Direct gets a
  UAC-filtered token, which cannot register `Highest` tasks.
- The `temiz` checkpoint has the network adapter disconnected and display/sleep timeouts off.
  Reconnect with `Connect-VMNetworkAdapter -VMName NotchTest -SwitchName 'Default Switch'`.

