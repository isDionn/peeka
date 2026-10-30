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
pub(crate) fn process_table() -> std::collections::HashMap<u32, notch_core::session_window::Proc> {
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

/// When process `pid` started (FILETIME ticks); None once it has exited. Kept next to a pid so a later look can tell
/// the same process from a reused pid.
#[cfg(windows)]
pub fn started(pid: u32) -> Option<u64> {
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    let ticks = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    // SAFETY: a read-only (limited query) handle, closed before returning.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let (mut created, mut exited, mut kernel, mut user) = Default::default();
        let ok = GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user).is_ok();
        let _ = CloseHandle(h);
        (ok && ticks(exited) == 0).then(|| ticks(created))
    }
}

/// Peeka's hook process `hook` -> the Claude Code process above it and its start time.
#[cfg(windows)]
pub fn agent_of_hook(hook: u32) -> Option<(u32, u64)> {
    let pid = notch_core::session_window::agent_proc(&process_table(), hook)?;
    Some((pid, started(pid)?))
}

/// Types `text` into the console process `pid` runs in, then Enter, as keyboard input (what terminal multiplexers
/// do): works for a classic console and for ConPTY (Windows Terminal, editor terminals), whose host takes the same
/// input records. False = no console to join (a GUI session, or Peeka already has a console of its own) or a short write.
#[cfg(windows)]
pub fn type_into(pid: u32, text: &str) -> bool {
    use windows::core::w;
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Console::{
        AttachConsole, FreeConsole, WriteConsoleInputW, INPUT_RECORD, INPUT_RECORD_0, KEY_EVENT, KEY_EVENT_RECORD,
        KEY_EVENT_RECORD_0,
    };
    // A process has one console at a time: two sends never overlap.
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let key = |c: u16, vk: u16, scan: u16, down: bool| INPUT_RECORD {
        EventType: KEY_EVENT as u16,
        Event: INPUT_RECORD_0 {
            KeyEvent: KEY_EVENT_RECORD {
                bKeyDown: down.into(),
                wRepeatCount: 1,
                wVirtualKeyCode: vk,
                wVirtualScanCode: scan,
                uChar: KEY_EVENT_RECORD_0 { UnicodeChar: c },
                dwControlKeyState: 0,
            },
        },
    };
    let chars: Vec<INPUT_RECORD> = text.encode_utf16().flat_map(|c| [key(c, 0, 0, true), key(c, 0, 0, false)]).collect();
    let enter = [key(13, 0x0D, 0x1C, true), key(13, 0x0D, 0x1C, false)];
    struct Detach;
    impl Drop for Detach {
        fn drop(&mut self) {
            // SAFETY: undoes the AttachConsole below; nothing of the console outlives this guard.
            let _ = unsafe { FreeConsole() };
        }
    }
    struct Input(HANDLE);
    impl Drop for Input {
        fn drop(&mut self) {
            // SAFETY: the CONIN$ handle opened below, closed once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
    let write = |h: HANDLE, recs: &[INPUT_RECORD]| {
        let mut n = 0u32;
        // SAFETY: `recs` outlives the call and `n` receives the count written.
        unsafe { WriteConsoleInputW(h, recs, &mut n) }.is_ok() && n as usize == recs.len()
    };
    // SAFETY: joins the console of `pid` (fails if Peeka already has one); the guards detach and close on every path.
    unsafe {
        if AttachConsole(pid).is_err() {
            return false;
        }
        let _detach = Detach;
        let Ok(h) = CreateFileW(
            w!("CONIN$"),
            (GENERIC_READ | GENERIC_WRITE).0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        ) else {
            return false;
        };
        let input = Input(h);
        // The Enter goes on its own a moment later: in the same burst a TUI reads it as a pasted newline, not a submit.
        write(input.0, &chars) && {
            std::thread::sleep(std::time::Duration::from_millis(120));
            write(input.0, &enter)
        }
    }
}
