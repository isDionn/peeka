# Peeka: Wave 0 trials (you do these)

This small tool lets us see how Windows behaves on your computer before we start building Peeka. Each command changes one thing for 60 seconds and then **undoes it by itself**. It writes what it did and what it saw both to the screen and to a log file.

## Where the tool is

- Program: `tools\probe\target\release\notch-probe.exe`
- Log and marker files: `%LOCALAPPDATA%\PeekaProbe\` (log: `probe.log`). You can open this folder by typing it into the File Explorer address bar.
- If the program is missing, tell Claude "build the trial tool".

## First: emergency (if something goes wrong)

1. If the command's window is still open, press **Ctrl+C** there first, or close that PowerShell window: it undoes everything. (If you type `restore` in another window while a command runs, the running command hides again within 1 second.)
2. If the command has finished, or was closed from Task Manager, type this in a PowerShell window: `notch-probe restore`
   It brings the taskbar back, removes the strip on top, and turns Wi-Fi and Bluetooth back on.
3. If that does not work either: Task Manager › "Windows Explorer" › "Restart".

Good to know: every time it starts, the tool first checks for anything left over from a previous trial and undoes it. If the screen says "Leftover ... marker found", that is normal.

## Before you start

- Open PowerShell in the program's folder: in File Explorer go to `...\tools\probe\target\release`, type `powershell` in the address bar and press Enter. You type the commands in that window as `.\notch-probe.exe <command>` (all the ones below work that way).
- **One command at a time.** Do not start a new one in another window before one finishes (before it prints "Done."): the newly started one undoes what the earlier one did.
- The log may contain app names and tray icon tips. The file stays only on your computer.

## 1. Top strip (AppBar)

Command: `.\notch-probe.exe appbar on`

Check: a thin dark blue strip appears at the top of every screen. Maximize a browser or File Explorer (fill the screen): does the window start **below** the strip? On a second screen too? When the strip goes away after 60 s, does the maximized window stretch to the very top again?

Result: ____

## 2. 30 px after a crash (the most important trial)

**2a. Without the guard:**
Command: `.\notch-probe.exe appbar on`
While the strip is visible, right-click `notch-probe.exe` in Task Manager › **Details** tab › "End task".
Check: the strip disappeared, but do maximized windows still start 30 px lower? How long does it take (seconds)? Then Task Manager › "Windows Explorer" › "Restart": did it fix it? At the end, type `.\notch-probe.exe restore`.

Result: ____

**2b. With the guard:**
Command: `.\notch-probe.exe guard`
The screen says "end the notch-probe.exe with PID **this**". In the Details tab you will see two `notch-probe.exe`; end **only the one with that PID** (the other is the guard).
Check: after how many seconds do maximized windows stretch to the top again? Did a warning window appear? The guard prints nothing to the screen; to see what it did, look at the end of `%LOCALAPPDATA%\PeekaProbe\probe.log` for a "Guard step ... WORKED" or a "Windows released the 30 px BY ITSELF" line.

Result: ____

## 3. Hiding the taskbar completely

Command: `.\notch-probe.exe hide on`

Check: did the taskbar disappear completely? Does the **Win** key open Start, and does the bar below appear for a moment when it opens? Do the **Win+A** and **Win+N** panels open, and where on the screen? Does the bar come back after 60 s?

Result: ____

## 4. Tray (hidden icons)

Command: `.\notch-probe.exe tray`

Check (first 25 s, while the taskbar is hidden): did the hidden-icons panel (the small window under the up arrow) open by itself? Was it moved to the top of the screen, below the strip, or did it jump straight back to its old place?
Check (next 35 s): a window called "Tray mirror" opens with buttons in it. Is there a button for your tray apps such as Discord, Steam, OneDrive? Click one: does that app's own right-click menu open?

Result: ____

## 5. Two monitors with different scaling

(If you have two monitors. Set one to 100% and the other to 125% or 150% in Windows Settings › Display.)
Command: `.\notch-probe.exe appbar on`

Check: does the strip look the same thickness on both screens (about a finger wide)? Is one very thin or very thick?

Result: ____

## 6. Hiding while Explorer restarts

Command: `.\notch-probe.exe hide on`
While the taskbar is hidden, Task Manager › "Windows Explorer" › "Restart".

Check: when Explorer comes back, does the taskbar appear and get hidden again **within 1 second**?

Result: ____

## 7. Sample island (click-through and focus)

First open Notepad in the background and type something in it (so the cursor blinks there).
Command: `.\notch-probe.exe island`

A grey, semi-transparent box appears at the top centre of the screen with a dark "Box: click here" area inside. The first 30 s are "Mode 1", the last 30 s "Mode 2" (it says so at the top).
Check (in both modes): click the grey area: does the click go through to the window behind? Click the dark box: does the cursor keep blinking in Notepad (it must not lose focus)?

Result (Mode 1): ____
Result (Mode 2): ____

## 8. Wi-Fi and Bluetooth

(First turn both on in Windows. The internet may drop for 5 seconds: do not download anything meanwhile.)
Command: `.\notch-probe.exe radios`

Check: do the Wi-Fi and Bluetooth icons go off for 5 s and come back? Does the screen say "DeniedByUser" or "DeniedBySystem" (access denied)? At the end, are both on again?

Result: ____

## 9. Top strip over a fullscreen game

Command: `.\notch-probe.exe topmost`
After typing the command, switch to a game within 15 seconds (first an older game that runs in exclusive fullscreen, then a borderless fullscreen game if you have one). The tool does this 3 times: each time it waits 15 s, then shows an orange strip on top for 4 s.

Check: when the strip appears, does the game shrink, or is there a black screen or a stutter? What happens in borderless fullscreen?

Result (exclusive fullscreen): ____
Result (borderless): ____

## 10. Volume keys

Command: `.\notch-probe.exe volkeys`

For 60 s: press the volume keys on the keyboard; on a laptop, the volume keys with Fn; the volume button on your headset; and also the volume key while a window opened as administrator (for example an administrator PowerShell) is in front.
Check: does the Windows volume overlay (the volume bar on screen) appear? Does the volume change? (If the tool captured the key, the volume must not change and the overlay must not appear.) In which case did it appear?

Result: ____

## 11. Hiding from screen sharing

Get screen sharing in Teams/Zoom, screen capture in OBS, or the Snipping Tool ready.
Command: `.\notch-probe.exe exclude`

A reddish window opens; it says "NOW: VISIBLE" or "NOW: HIDDEN FROM CAPTURE" and switches every 5 s.
Check: while it says "HIDDEN", is the window invisible in the share/OBS (black or empty)? While it says "VISIBLE", is it visible? Is there any flicker or a moment of visibility at the switches?

Result: ____

## 12. Playing track and encryption

Play a song in Spotify (or another app).
Command: `.\notch-probe.exe smtc` then `.\notch-probe.exe dpapi`

Check: does smtc print the playing song's title and artist correctly? Does dpapi print "result same (correct)"? (dpapi only encrypts a fixed trial sentence and never touches your data.)

Result: ____

---

When you finish, save this file and tell Claude "the trials are done".
