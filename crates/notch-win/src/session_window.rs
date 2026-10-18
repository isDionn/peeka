// Peeka — original implementation (MIT).
//! "Open terminal" against the live desktop: a Toolhelp process list and the taskbar-worthy windows from `apps`,
//! fed to the decision in `notch_core::session_window`.

/// Why the session's window could not be raised.
#[derive(Debug, PartialEq, Eq)]
pub enum FocusErr {
    /// None of the session's ancestors owns an app window (classic console, or the process has exited).
    NoWindow,
    /// Windows declined to bring the window forward.
    Refused,
}

/// Raises the terminal or editor window that session process `pid` runs under.
#[cfg(windows)]
pub fn focus(pid: u32) -> Result<(), FocusErr> {
    use notch_core::ports::AppControl;

    // Topmost first, so the first match below is the window the owner used last.
    let wins: Vec<(isize, u32)> = crate::apps::enumerate(&[])
        .into_iter()
        .filter(notch_core::apps::is_app_window)
        .map(|w| (w.hwnd, crate::apps::pid_of_window(w.hwnd)))
        .collect();
    let owner = notch_core::session_window::window_owner(&process_table(), pid, |p| {
        wins.iter().any(|&(_, owner)| owner == p)
    })
    .ok_or(FocusErr::NoWindow)?;
    let &(hwnd, _) = wins.iter().find(|&&(_, p)| p == owner).ok_or(FocusErr::NoWindow)?;
    if crate::apps::Win32Control.focus(hwnd) {
        Ok(())
    } else {
        Err(FocusErr::Refused)
    }
}

/// Every running process keyed by pid, with its parent pid and exe file name. Empty if no snapshot can be taken.
#[cfg(windows)]
fn process_table() -> std::collections::HashMap<u32, notch_core::session_window::Proc> {
    use notch_core::session_window::Proc;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    let mut table = std::collections::HashMap::new();
    // SAFETY: plain snapshot call; a failure is returned as an error, not a handle.
    let Ok(snap) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else { return table };
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    // SAFETY: `snap` is a live snapshot handle and `entry` is a correctly sized PROCESSENTRY32W the API fills in.
    let mut ok = unsafe { Process32FirstW(snap, &mut entry) }.is_ok();
    while ok {
        table.insert(
            entry.th32ProcessID,
            Proc { parent: entry.th32ParentProcessID, exe: crate::wide_to_string(&entry.szExeFile) },
        );
        // SAFETY: as above.
        ok = unsafe { Process32NextW(snap, &mut entry) }.is_ok();
    }
    // SAFETY: the snapshot was opened above and is closed exactly once; nothing uses it afterwards.
    let _ = unsafe { CloseHandle(snap) };
    table
}
