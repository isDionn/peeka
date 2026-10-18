# Host-side screenshot of the guest console via Hyper-V WMI (no guest login needed).
# Usage: .\screenshot.ps1 out.png [-Width 1920 -Height 1080]
param([Parameter(Mandatory)][string]$Out, [int]$Width = 1920, [int]$Height = 1080)
. "$PSScriptRoot\_common.ps1"
Add-Type -AssemblyName System.Drawing

$ns = 'root\virtualization\v2'
$vm = Get-CimInstance -Namespace $ns -ClassName Msvm_ComputerSystem -Filter "ElementName='$script:VMName'"
if (-not $vm) { throw "VM $script:VMName not found" }
$setting = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_VirtualSystemSettingData |
    Where-Object VirtualSystemType -eq 'Microsoft:Hyper-V:System:Realized'
$svc = Get-CimInstance -Namespace $ns -ClassName Msvm_VirtualSystemManagementService
$r = Invoke-CimMethod -InputObject $svc -MethodName GetVirtualSystemThumbnailImage `
    -Arguments @{ TargetSystem = $setting; WidthPixels = [uint16]$Width; HeightPixels = [uint16]$Height }
if ($r.ReturnValue -ne 0 -or -not $r.ImageData) { throw "GetVirtualSystemThumbnailImage failed (ReturnValue $($r.ReturnValue)); is the VM running?" }

# ImageData is raw RGB565, row-major, no padding.
$bytes = [byte[]]$r.ImageData
$bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format16bppRgb565)
$data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)),
    [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
for ($y = 0; $y -lt $Height; $y++) {
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, $y * $Width * 2, [IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $Width * 2)
}
$bmp.UnlockBits($data)
$full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output $full
