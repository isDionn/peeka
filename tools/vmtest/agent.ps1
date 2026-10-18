# Runs INSIDE Windows Sandbox as the LogonCommand (sandbox.py copies it to C:\out).
# The only host<->guest channel is the mapped C:\out folder: the host drops cmd\NNN.ps1,
# this loop runs it and writes res\NNN.json. No network, no Python in the guest.
$ErrorActionPreference = 'Continue'
trap { $_ | Out-String | Set-Content 'C:\outgent-error.txt' -Encoding UTF8; exit 1 }
$out = 'C:\out'
New-Item -ItemType Directory -Force "$out\cmd", "$out\res", "$out\shots" | Out-Null

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint a, uint b, ref RECT r, uint c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static IntPtr ByTitle(string t) { return FindWindow(null, t); }
  public static IntPtr ByClass(string c) { return FindWindow(c, null); }
  public static int[] WorkArea() { var r = new RECT(); SystemParametersInfo(0x30, 0, ref r, 0); return new[] { r.L, r.T, r.R, r.B }; }
  public static int[] Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return new[] { r.L, r.T, r.R, r.B }; }
  // shortcut: FindWindow returns the topmost Shell_TrayWnd; the probe's tray test creates its own fake one.
  public static bool TrayExists() { return FindWindow("Shell_TrayWnd", null) != IntPtr.Zero; }
  public static bool TrayVisible() { var h = FindWindow("Shell_TrayWnd", null); return h != IntPtr.Zero && IsWindowVisible(h); }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(100); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
  public static void Keys(byte[] vks) {
    foreach (var k in vks) keybd_event(k, 0, 0, UIntPtr.Zero);
    for (int i = vks.Length - 1; i >= 0; i--) keybd_event(vks[i], 0, 2, UIntPtr.Zero);
  }
}
'@
[W]::SetProcessDPIAware() | Out-Null

function Shot([string]$name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $p = "$out\shots\$name.png"
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $p
}

function Measure-Desk {
  $fg = [W]::GetForegroundWindow()
  [ordered]@{ work_area = [W]::WorkArea(); tray_exists = [W]::TrayExists(); tray_visible = [W]::TrayVisible(); foreground = [W]::Title($fg) }
}

# The probe needs the VC runtime; sandbox.py copies the host's copy into C:\out\runtime when it has one.
foreach ($dll in Get-ChildItem "$out\runtime\*.dll" -ErrorAction SilentlyContinue) {
  if (-not (Test-Path "C:\Windows\System32\$($dll.Name)")) { Copy-Item $dll.FullName "C:\Windows\System32\" }
}

# LogonCommand can fire before Explorer: wait for the taskbar so tray checks are not false negatives.
$t = 0
while (-not [W]::TrayVisible() -and $t -lt 180) { Start-Sleep 1; $t++ }
"ready after $t s" | Set-Content "$out\ready.txt" -Encoding UTF8

while ($true) {
  foreach ($f in Get-ChildItem "$out\cmd\*.ps1" -ErrorAction SilentlyContinue | Sort-Object Name) {
    $id = $f.BaseName
    $code = Get-Content $f.FullName -Raw -Encoding UTF8
    Remove-Item $f.FullName -Force
    $ok = $true
    try { $o = (& ([scriptblock]::Create($code)) 2>&1 | Out-String -Width 100000) } catch { $ok = $false; $o = ($_ | Out-String -Width 1000) }
    $tmp = "$out\res\$id.tmp"
    [ordered]@{ id = $id; ok = $ok; output = $o } | ConvertTo-Json -Depth 4 | Set-Content $tmp -Encoding UTF8
    Move-Item $tmp "$out\res\$id.json" -Force
  }
  Start-Sleep -Milliseconds 300
}
