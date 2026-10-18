# In-sandbox stand-in for "a maximised browser / Notepad": a window titled VMTEST with a text box.
# Every mouse-down it receives is appended to C:\out\testwin-clicks.txt (click-through check, test 7).
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = 'VMTEST'
$tb = New-Object System.Windows.Forms.TextBox
$tb.Multiline = $true; $tb.Dock = 'Fill'; $tb.Text = 'deneme'
$tb.Add_MouseDown({ param($s, $e) "$([DateTime]::Now.ToString('HH:mm:ss.fff')) $($e.X),$($e.Y)" | Add-Content 'C:\out\testwin-clicks.txt' })
$f.Controls.Add($tb)
$f.WindowState = 'Maximized'
[System.Windows.Forms.Application]::Run($f)
