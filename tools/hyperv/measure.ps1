# Measure the guest desktop from inside the interactive session; prints JSON.
# Reports: screen size, DPI, work area (SPI_GETWORKAREA), Shell_TrayWnd visibility + rect,
# and the rect of a real maximised top-level window (a throwaway WinForms form).
# Usage: .\measure.ps1 [-CredFile path]
param([string]$CredFile)
$guest = @'
$sig = '
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern uint GetDpiForSystem();
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
[DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, ref RECT r, int c);
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
public struct RECT { public int Left, Top, Right, Bottom; }
'
Add-Type -Namespace Notch -Name W -MemberDefinition $sig
[Notch.W]::SetProcessDPIAware() | Out-Null
function ToRect($r) { [ordered]@{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top } }
$wa = New-Object Notch.W+RECT
[Notch.W]::SystemParametersInfo(0x30, 0, [ref]$wa, 0) | Out-Null   # SPI_GETWORKAREA
$tray = [Notch.W]::FindWindow('Shell_TrayWnd', $null)
$tr = New-Object Notch.W+RECT
if ($tray -ne [IntPtr]::Zero) { [Notch.W]::GetWindowRect($tray, [ref]$tr) | Out-Null }
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = 'notch-measure'; $f.WindowState = 'Maximized'; $f.ShowInTaskbar = $false
$f.Show(); 1..20 | ForEach-Object { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
$mr = New-Object Notch.W+RECT
[Notch.W]::GetWindowRect($f.Handle, [ref]$mr) | Out-Null
$zoomed = [Notch.W]::IsZoomed($f.Handle)
$f.Close()
[ordered]@{
    screen    = [ordered]@{ width = [Notch.W]::GetSystemMetrics(0); height = [Notch.W]::GetSystemMetrics(1); dpi = [Notch.W]::GetDpiForSystem() }
    workArea  = ToRect $wa
    trayWnd   = [ordered]@{ found = ($tray -ne [IntPtr]::Zero); visible = [Notch.W]::IsWindowVisible($tray); rect = ToRect $tr }
    maximised = [ordered]@{ zoomed = $zoomed; rect = ToRect $mr }
    session   = (Get-Process -Id $PID).SessionId
} | ConvertTo-Json -Depth 4
'@
& "$PSScriptRoot\run-interactive.ps1" -Command $guest -CredFile $CredFile
