; Uninstall: Peeka hides the Windows taskbar and its guard process puts it back after a crash, but the uninstaller
; stops both at once, which left the taskbar parked off-screen. Stop them here, then let the still-installed exe
; restore what the stopped run left behind (the same cleanup a launch does), before its files are removed.
!macro NSIS_HOOK_PREUNINSTALL
  nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
  Pop $R0
  Sleep 500
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-taskbar'
!macroend
