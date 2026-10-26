//! The Win32 side of `notch_core::taskbar`: the real `Shell`,
//! the guard process (`peeka.exe --guard <pid>`) and the launch-time check. The worker thread and the emergency key
//! are in `crates/notch-app` (they need the Tauri app).

use notch_core::taskbar::{self, Shell};

pub const GUARD_ARG: &str = "--guard";

/// The real taskbar. Built only by the callers in `crates/notch-app` / the guard: tests never construct it.
#[cfg(windows)]
pub struct Win32Shell;

#[cfg(windows)]
mod sys {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::APPBARDATA;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW};

    pub fn tray() -> Option<HWND> {
        // SAFETY: two valid wide-string pointers (a literal and null); the result is checked.
        unsafe { FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) }.ok()
    }

    /// Every taskbar window, found fresh each time (an Explorer restart makes new ones; handles are never cached).
    pub fn bars() -> Vec<HWND> {
        let mut out: Vec<HWND> = tray().into_iter().collect();
        let mut after = HWND::default();
        // shortcut: at most 16 secondary bars (monitors); more is not a desk anyone has.
        for _ in 0..16 {
            // SAFETY: top-level search (null parent) after the previous match; valid wide strings; result checked.
            match unsafe { FindWindowExW(None, Some(after), w!("Shell_SecondaryTrayWnd"), PCWSTR::null()) } {
                Ok(next) if !next.is_invalid() => {
                    out.push(next);
                    after = next;
                }
                _ => break,
            }
        }
        out
    }

    pub fn data(hwnd: HWND) -> APPBARDATA {
        APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
    }
}

#[cfg(windows)]
impl Shell for Win32Shell {
    fn state(&self) -> Option<u32> {
        use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE};
        let mut data = sys::data(sys::tray()?);
        // SAFETY: `data` is a fully initialised APPBARDATA with its own size in cbSize.
        Some(unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as u32)
    }

    fn set_state(&self, state: u32) -> bool {
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_SETSTATE};
        let Some(tray) = sys::tray() else { return false };
        let mut data = sys::data(tray);
        data.lParam = LPARAM(state as isize);
        // SAFETY: as above; ABM_SETSTATE always returns TRUE, so success = the taskbar was found.
        unsafe { SHAppBarMessage(ABM_SETSTATE, &mut data) };
        true
    }

    fn bars_visible(&self) -> Option<bool> {
        use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
        let bars = sys::bars();
        // SAFETY: handles just returned by FindWindow(Ex)W; a stale one only answers false.
        (!bars.is_empty()).then(|| bars.iter().any(|&bar| unsafe { IsWindowVisible(bar) }.as_bool()))
    }

    fn show_bars(&self, show: bool) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindowAsync, SW_HIDE, SW_SHOWNA};
        let bars = sys::bars();
        for &bar in &bars {
            // SAFETY: as above. Async: a hung Explorer cannot block Notch (or the guard). SW_SHOWNA shows without
            // taking the focus. The return value only says the request was posted.
            let _ = unsafe { ShowWindowAsync(bar, if show { SW_SHOWNA } else { SW_HIDE }) };
        }
        !bars.is_empty()
    }

    fn remove_appbar(&self, hwnd: isize) {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_REMOVE};
        let mut data = sys::data(HWND(hwnd as _));
        // SAFETY: a plain APPBARDATA; a handle of a dead window is only an id to Explorer (Wave 0 test 2 checks it).
        unsafe { SHAppBarMessage(ABM_REMOVE, &mut data) };
    }
}

#[cfg(not(windows))]
pub struct Win32Shell;

#[cfg(not(windows))]
impl Shell for Win32Shell {
    fn state(&self) -> Option<u32> {
        None
    }
    fn set_state(&self, _state: u32) -> bool {
        false
    }
    fn bars_visible(&self) -> Option<bool> {
        None
    }
    fn show_bars(&self, _show: bool) -> bool {
        false
    }
    fn remove_appbar(&self, _hwnd: isize) {}
}

/// The pid in `--guard <pid>`. None = not guard arguments; Some(Err) = guard arguments with a bad pid.
pub fn guard_pid(args: &[String]) -> Option<Result<u32, ()>> {
    if args.get(1).map(String::as_str) != Some(GUARD_ARG) {
        return None;
    }
    Some(args.get(2).and_then(|p| p.parse::<u32>().ok()).ok_or(()))
}

/// `peeka.exe --guard <pid>` (main.rs, before Tauri starts - the single-instance plugin never sees it). Waits for
/// that process to end; if the marker is still there (crash, kill), cleans up. Then, if Notch did not end cleanly
/// (`notch_core::supervise`: the alive file is still there) and Windows is not shutting down, relaunches it with a
/// back-off, or gives up after 3 crashes in 2 minutes and leaves a reason file. A clean quit already deleted the
/// marker and the alive file, so the guard just ends. None = these are not guard arguments.
pub fn guard_main(args: &[String]) -> Option<i32> {
    let Ok(pid) = guard_pid(args)? else { return Some(2) };
    // Cannot watch Notch (not "already gone"): end without touching the bars - restoring now would fight a live
    // Notch. Notch sees this guard end and starts another.
    if !wait_for_exit(pid, None) {
        return Some(3);
    }
    let Some(dir) = notch_core::data_dir() else { return Some(1) };
    let marker = taskbar::marker_path(&dir);
    // Explorer may be restarting right now: a few tries, then the next launch's check takes over.
    let mut cleaned = false;
    for _ in 0..10 {
        if taskbar::crash_cleanup(&Win32Shell, &marker) {
            cleaned = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    supervise(&dir);
    Some(if cleaned { 0 } else { 1 })
}

/// The relaunch half of the guard (the taskbar is already back).
fn supervise(dir: &std::path::Path) {
    use notch_core::supervise::{self as policy, Next};
    let alive = policy::alive_path(dir);
    let history_path = policy::crashes_path(dir);
    let mut history = policy::read_history(&history_path);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let next = policy::after_exit(alive.exists(), crate::session::shutting_down(), &mut history, now);
    if next == Next::Done {
        return;
    }
    policy::write_history(&history_path, &history);
    match next {
        Next::Done => {}
        Next::GiveUp => {
            let _ = std::fs::write(policy::gave_up_path(dir), policy::GAVE_UP_TEXT);
        }
        Next::Relaunch { after_ms } => {
            std::thread::sleep(std::time::Duration::from_millis(after_ms));
            // shortcut: dev builds never relaunch (stopping `tauri dev` would bring Notch back); test with release.
            if cfg!(debug_assertions) || crate::session::shutting_down() {
                return;
            }
            relaunch();
        }
    }
}

/// The same exe, quietly. A Notch the owner started meanwhile wins: single-instance sends this one away.
fn relaunch() {
    if let Err(error) = spawn_self(&[notch_core::supervise::AUTOSTART_ARG]) {
        eprintln!("[guard] Notch could not be started again: {error}");
    }
}

/// `main()`, before Tauri starts: a marker left behind means the last run never put the bar back.
pub fn restore_left_behind() {
    if let Some(dir) = notch_core::data_dir() {
        taskbar::crash_cleanup(&Win32Shell, &taskbar::marker_path(&dir));
    }
}

/// `OpenProcess` on a pid with no process answers ERROR_INVALID_PARAMETER (87); anything else (access denied...) is
/// not proof that Notch ended.
#[cfg(windows)]
fn no_such_process(code: windows::core::HRESULT) -> bool {
    code == windows::Win32::Foundation::ERROR_INVALID_PARAMETER.to_hresult()
}

/// True = the process ended (or was already gone); false = it cannot be watched, or `timeout_ms` (None = no limit)
/// ran out first.
#[cfg(windows)]
pub fn wait_for_exit(pid: u32, timeout_ms: Option<u32>) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE};
    // SAFETY: OpenProcess with a plain pid; the result is checked.
    let process = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(process) => process,
        Err(error) => return no_such_process(error.code()),
    };
    // SAFETY: a valid handle we own; closed right after.
    unsafe {
        let ended = WaitForSingleObject(process, timeout_ms.unwrap_or(INFINITE)) == WAIT_OBJECT_0;
        let _ = CloseHandle(process);
        ended
    }
}

#[cfg(not(windows))]
pub fn wait_for_exit(_pid: u32, _timeout_ms: Option<u32>) -> bool {
    true
}

/// The guard process and how many times this run started one.
#[cfg(windows)]
static GUARD: parking_lot::Mutex<(Option<std::process::Child>, u8)> = parking_lot::Mutex::new((None, 0));

/// This exe again, with no console and no inherited handles. `CREATE_BREAKAWAY_FROM_JOB` lets it outlive a job that
/// whatever launched Notch put it in; a job that forbids breaking away refuses that flag, and it then starts inside
/// it (it may die with Notch - logged).
#[cfg(windows)]
pub fn spawn_self(args: &[&str]) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let exe = std::env::current_exe()?;
    let spawn = |flags: u32| {
        Command::new(&exe).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(flags).spawn()
    };
    spawn(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB).or_else(|error| {
        eprintln!("[taskbar] could not break away from a job ({error}); starting inside it");
        spawn(CREATE_NO_WINDOW)
    })
}

#[cfg(not(windows))]
pub fn spawn_self(_args: &[&str]) -> std::io::Result<std::process::Child> {
    Err(std::io::ErrorKind::Unsupported.into())
}

/// Ends this process at once, from any thread, like a crash: the alive file stays, so the guard restarts Notch within
/// its budget. `TerminateProcess`, not `exit` (DLL detach could wait on the frozen main thread's locks) or a panic (a
/// crash dialog). Idea from new_win (MIT): restart a hung shell.
#[cfg(windows)]
pub fn end_now() {
    use windows::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
    // SAFETY: the pseudo-handle of our own process.
    let _ = unsafe { TerminateProcess(GetCurrentProcess(), 1) };
}

#[cfg(not(windows))]
pub fn end_now() {}

/// Keep a guard running while full hide is wanted (checked every worker tick; false = none could be kept).
#[cfg(windows)]
pub fn ensure_guard() -> bool {
    use std::process::Child;
    let alive = |child: &mut Child| match child.try_wait() {
        Ok(None) => true,
        Ok(Some(status)) => {
            eprintln!("[taskbar] guard ended ({status}); starting a new one");
            false
        }
        // Cannot tell: leave it (no spawn loop on a handle error).
        Err(error) => {
            eprintln!("[taskbar] guard status unknown: {error}");
            true
        }
    };
    let start = || {
        spawn_self(&[GUARD_ARG, &std::process::id().to_string()])
            .map_err(|error| eprintln!("[taskbar] guard did not start: {error}"))
            .ok()
    };
    let mut guard = GUARD.lock();
    let (slot, spawns) = &mut *guard;
    taskbar::keep_guard(slot, spawns, alive, start)
}

#[cfg(not(windows))]
pub fn ensure_guard() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_arguments_are_recognised_and_nothing_else_is() {
        assert_eq!(guard_pid(&["peeka.exe".into()]), None);
        assert_eq!(guard_pid(&["peeka.exe".into(), "--autostart".into()]), None);
        assert_eq!(guard_pid(&["peeka.exe".into(), GUARD_ARG.into(), "not-a-pid".into()]), Some(Err(())));
        assert_eq!(guard_pid(&["peeka.exe".into(), GUARD_ARG.into(), "42".into()]), Some(Ok(42)));
        assert_eq!(guard_main(&["peeka.exe".into(), GUARD_ARG.into()]), Some(2));
    }

    #[cfg(windows)]
    #[test]
    fn only_a_missing_process_counts_as_notch_ended() {
        use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER};
        assert!(no_such_process(ERROR_INVALID_PARAMETER.to_hresult()));
        assert!(!no_such_process(ERROR_ACCESS_DENIED.to_hresult()));
    }
}
