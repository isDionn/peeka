//! Windows is logging off or shutting down: tell the guard early, before Windows starts ending processes.
//! tao already turns `WM_ENDSESSION(TRUE)` into `RunEvent::Exit` (the clean exit path); this only adds
//! `WM_QUERYENDSESSION` (and the cancelled `WM_ENDSESSION(FALSE)`), on one of Notch's top-level windows.
//! The same window also hears the session lock (`WTSRegisterSessionNotification`, `WM_WTSSESSION_CHANGE`): Notch's
//! own lock follows a Windows lock.

use std::sync::OnceLock;

/// true = the session is ending, false = the end was cancelled.
static ON_END: OnceLock<fn(bool)> = OnceLock::new();
/// true = `WTS_SESSION_LOCK`, false = `WTS_SESSION_UNLOCK`.
static ON_LOCK: OnceLock<fn(bool)> = OnceLock::new();

/// Explorer (re)created the taskbar (`TaskbarCreated` broadcast): set once by `on_taskbar_created`.
static ON_TASKBAR: OnceLock<fn()> = OnceLock::new();
/// The registered `TaskbarCreated` message id (0 = not registered).
static TASKBAR_MSG: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// `f` runs on the window thread whenever Explorer announces a new taskbar (restart). Call before `watch`.
pub fn on_taskbar_created(f: fn()) {
    let _ = ON_TASKBAR.set(f);
    #[cfg(windows)]
    {
        // SAFETY: a valid wide-string literal; the id is process-wide and stable.
        let id = unsafe { windows::Win32::UI::WindowsAndMessaging::RegisterWindowMessageW(windows::core::w!("TaskbarCreated")) };
        TASKBAR_MSG.store(id, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Subclasses `hwnd` (call on its own thread). Calling it again for the same window only replaces the data.
/// `on_lock` hears the Windows session lock; registering for it twice on the same window is harmless.
#[cfg(windows)]
pub fn watch(hwnd: isize, on_end: fn(bool), on_lock: fn(bool)) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
    use windows::Win32::UI::Shell::SetWindowSubclass;
    let _ = ON_END.set(on_end);
    let _ = ON_LOCK.set(on_lock);
    // SAFETY: a live window of this process; Windows unregisters it when the window is destroyed.
    if let Err(e) = unsafe { WTSRegisterSessionNotification(HWND(hwnd as _), NOTIFY_FOR_THIS_SESSION) } {
        eprintln!("[notch] session lock notifications: {e}");
    }
    // SAFETY: a live window of this thread; `proc_` is a plain `extern "system"` fn with no data behind it.
    unsafe { SetWindowSubclass(HWND(hwnd as _), Some(proc_), 0x4E4F_5443, 0) }.as_bool()
}

#[cfg(windows)]
unsafe extern "system" fn proc_(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        WM_ENDSESSION, WM_QUERYENDSESSION, WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
    };
    let created = TASKBAR_MSG.load(std::sync::atomic::Ordering::Relaxed);
    if let (true, Some(f)) = (created != 0 && msg == created, ON_TASKBAR.get()) {
        f();
    }
    if let Some(on_end) = ON_END.get() {
        match msg {
            WM_QUERYENDSESSION => on_end(true),
            WM_ENDSESSION if wparam.0 == 0 => on_end(false),
            _ => {}
        }
    }
    if let (WM_WTSSESSION_CHANGE, Some(on_lock)) = (msg, ON_LOCK.get()) {
        match wparam.0 as u32 {
            WTS_SESSION_LOCK => on_lock(true),
            WTS_SESSION_UNLOCK => on_lock(false),
            _ => {}
        }
    }
    // SAFETY: forwarding the same message to the next procedure in the chain.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(not(windows))]
pub fn watch(_hwnd: isize, on_end: fn(bool), on_lock: fn(bool)) -> bool {
    let _ = ON_END.set(on_end);
    let _ = ON_LOCK.set(on_lock);
    false
}

/// The guard has no window: it asks Windows directly before relaunching.
#[cfg(windows)]
pub fn shutting_down() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SHUTTINGDOWN};
    // SAFETY: a plain metric read.
    unsafe { GetSystemMetrics(SM_SHUTTINGDOWN) != 0 }
}

#[cfg(not(windows))]
pub fn shutting_down() -> bool {
    false
}
