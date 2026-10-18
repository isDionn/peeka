//! "Terminali aç" on the real desktop: a process snapshot (Toolhelp32), the taskbar-worthy windows (`apps`), and the
//! rule from `notch_core::session_window`. Adapted from CouCou (`windows/src-tauri/src/platform/windows.rs`
//! `process_table`, commit ff825663, MIT; see `docs/THIRD_PARTY_NOTICES.md`).

#[derive(Debug, PartialEq, Eq)]
pub enum FocusErr {
    /// No ancestor of the session's process owns a window (a classic console, or the process is gone).
    NoWindow,
    /// Windows refused to bring it forward.
    Refused,
}

/// Brings the window of the terminal or editor `pid` runs in to the front.
#[cfg(windows)]
pub fn focus(pid: u32) -> Result<(), FocusErr> {
    use notch_core::ports::AppControl;
    let windows: Vec<(isize, u32)> = crate::apps::enumerate(&[])
        .into_iter()
        .filter(notch_core::apps::is_app_window)
        .map(|w| (w.hwnd, crate::apps::pid_of_window(w.hwnd)))
        .collect();
    let owner = notch_core::session_window::window_owner(&process_table(), pid, |p| {
        windows.iter().any(|(_, owner)| *owner == p)
    })
    .ok_or(FocusErr::NoWindow)?;
    // Z-order: the owner's frontmost window (an editor with several projects open gets its last-used one).
    let hwnd = windows.iter().find(|(_, o)| *o == owner).map(|(h, _)| *h).ok_or(FocusErr::NoWindow)?;
    crate::apps::Win32Control.focus(hwnd).then_some(()).ok_or(FocusErr::Refused)
}

/// Every process by id: its parent and exe file name.
#[cfg(windows)]
fn process_table() -> std::collections::HashMap<u32, notch_core::session_window::Proc> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut out = std::collections::HashMap::new();
    // SAFETY: a snapshot handle we close below; the entry struct carries its own size as Toolhelp requires.
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            out.insert(
                entry.th32ProcessID,
                notch_core::session_window::Proc {
                    parent: entry.th32ParentProcessID,
                    exe: crate::wide_to_string(&entry.szExeFile),
                },
            );
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    out
}
