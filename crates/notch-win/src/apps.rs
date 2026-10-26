//! Open windows (`EnumWindows`), grouped by AppUserModelID (`SHGetPropertyStoreForWindow` + `PKEY_AppUserModel_ID`)
//! or exe path; the filter and the merge with pins are `notch_core::apps` (tested there). Also the owner's actions on
//! them (`AppControl`) and "does the foreground window cover its monitor".
//! A fresh enumeration on each request; window events (`flash`, `foreground`) say when to ask again.

#[cfg(windows)]
use notch_core::apps::RawWindow;
use notch_core::model::{Monitor, Rect};

/// The monitor holding a window's centre (`index`), None = off every screen.
pub fn monitor_of(rect: &Rect, monitors: &[Monitor]) -> Option<usize> {
    let (cx, cy) = (rect.left + rect.width() / 2, rect.top + rect.height() / 2);
    monitors.iter().find(|m| m.rect.contains(cx, cy)).map(|m| m.index)
}

/// Desktop furniture never counts as "a fullscreen app" even though it covers the monitor.
pub fn is_desktop_class(class: &str) -> bool {
    matches!(class.to_ascii_lowercase().as_str(), "progman" | "workerw")
}

#[cfg(windows)]
mod sys {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, GWL_EXSTYLE,
    };

    use crate::wide_to_string;

    pub fn hwnd(h: isize) -> HWND {
        HWND(h as _)
    }

    pub fn text(h: HWND) -> String {
        let mut buf = [0u16; 512];
        // SAFETY: a window handle from EnumWindows / GetForegroundWindow; the buffer is ours.
        let n = unsafe { GetWindowTextW(h, &mut buf) }.max(0) as usize;
        wide_to_string(&buf[..n.min(buf.len())])
    }

    pub fn class(h: HWND) -> String {
        let mut buf = [0u16; 256];
        // SAFETY: as above.
        let n = unsafe { GetClassNameW(h, &mut buf) }.max(0) as usize;
        wide_to_string(&buf[..n.min(buf.len())])
    }

    pub fn ex_style(h: HWND) -> u32 {
        // SAFETY: as above; a stale handle answers 0.
        unsafe { GetWindowLongW(h, GWL_EXSTYLE) as u32 }
    }

    pub fn rect(h: HWND) -> Option<notch_core::model::Rect> {
        let mut r = RECT::default();
        // SAFETY: as above.
        unsafe { GetWindowRect(h, &mut r) }.ok()?;
        Some(notch_core::model::Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }

    pub fn cloaked(h: HWND) -> bool {
        let mut value = 0u32;
        // SAFETY: DWMWA_CLOAKED writes one DWORD into `value`.
        let ok = unsafe {
            DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut value as *mut u32 as *mut _, std::mem::size_of::<u32>() as u32)
        };
        ok.is_ok() && value != 0
    }

    /// The window's own AppUserModelID, if it set one (Store apps, Chrome profiles, PWAs).
    pub fn aumid(h: HWND) -> Option<String> {
        prop(h, &PKEY_AppUserModel_ID)
    }

    /// One string property of the window's shell property store; None = unset or empty.
    pub fn prop(h: HWND, key: &windows::Win32::Foundation::PROPERTYKEY) -> Option<String> {
        // MTA on this thread; "already initialised" (S_FALSE / RPC_E_CHANGED_MODE) is fine either way.
        // SAFETY: plain COM init, no reserved pointer.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        // SAFETY: a window handle; the store is a COM object released on drop.
        let store: IPropertyStore = unsafe { SHGetPropertyStoreForWindow(h) }.ok()?;
        // SAFETY: a valid store and a constant key.
        let value = unsafe { store.GetValue(key) }.ok()?;
        // SAFETY: the PROPVARIANT just returned; an empty one gives an error or an empty string.
        let s = unsafe { PropVariantToStringAlloc(&value) }.ok()?;
        // SAFETY: `s` is a CoTaskMem string we own; read, then freed.
        let out = unsafe { s.to_string() }.ok();
        unsafe { CoTaskMemFree(Some(s.0 as *const _)) };
        out.filter(|a| !a.is_empty())
    }

    pub fn pid(h: HWND) -> u32 {
        let mut pid = 0u32;
        // SAFETY: as above; out-param is ours.
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        pid
    }

    /// `TokenElevation` of a process; None = its token cannot be read (an elevated or protected process, or gone).
    pub fn elevated(pid: u32) -> Option<bool> {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows::Win32::System::Threading::OpenProcessToken;
        // SAFETY: limited query rights on a plain pid; checked, and closed below.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut token = HANDLE::default();
        // SAFETY: a valid process handle and an out-param we own.
        let opened = unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) };
        // SAFETY: we own the handle.
        let _ = unsafe { CloseHandle(process) };
        opened.ok()?;
        let mut e = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
        // SAFETY: the buffer is a TOKEN_ELEVATION of `size` bytes we own; the token is valid until CloseHandle.
        let ok =
            unsafe { GetTokenInformation(token, TokenElevation, Some(&mut e as *mut _ as *mut _), size, &mut len) };
        // SAFETY: we own the handle.
        let _ = unsafe { CloseHandle(token) };
        ok.ok().map(|_| e.TokenIsElevated != 0)
    }

    /// Full exe path of a process; "" when it cannot be opened (elevated / protected).
    pub fn exe_path(pid: u32) -> String {
        // SAFETY: limited query rights on a plain pid; the result is checked and the handle closed.
        let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
            return String::new();
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: the buffer and its length are ours; the handle is valid until CloseHandle.
        let ok = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) };
        // SAFETY: we own the handle.
        let _ = unsafe { CloseHandle(process) };
        if ok.is_ok() {
            String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())])
        } else {
            String::new()
        }
    }

    /// The package app's AUMID of a process (Store / MSIX apps); None for a plain desktop app.
    pub fn package_aumid(pid: u32) -> Option<String> {
        use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
        // SAFETY: limited query rights on a plain pid; the handle is closed below.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = [0u16; 512]; // APPLICATION_USER_MODEL_ID_MAX_LENGTH is 130
        let mut len = buf.len() as u32;
        // SAFETY: the buffer and its length are ours; the handle is valid until CloseHandle.
        let err = unsafe { GetApplicationUserModelId(process, &mut len, Some(PWSTR(buf.as_mut_ptr()))) };
        // SAFETY: we own the handle.
        let _ = unsafe { CloseHandle(process) };
        let s = String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]).trim_end_matches('\0').to_string();
        (err.is_ok() && !s.is_empty()).then_some(s)
    }
}

/// Is Notch itself elevated (then it reaches every window)? Read once.
#[cfg(windows)]
fn notch_elevated() -> bool {
    static ME: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ME.get_or_init(|| sys::elevated(std::process::id()) == Some(true))
}

/// The exe path of the window's process ("" = unknown); the foreground watcher uses it too.
#[cfg(windows)]
pub fn exe_of_window(hwnd: isize) -> String {
    sys::exe_path(sys::pid(sys::hwnd(hwnd)))
}

/// The package app's AUMID of the window's process (a Store app window without its own AUMID, like Paint).
#[cfg(windows)]
pub fn package_aumid_of_window(hwnd: isize) -> Option<String> {
    sys::package_aumid(sys::pid(sys::hwnd(hwnd)))
}

/// The window's relaunch command (`PKEY_AppUserModel_RelaunchCommand`: Chrome / Edge profiles, Steam); read only when
/// launching, never per scan. Idea from new_win (MIT).
#[cfg(windows)]
pub fn relaunch_command(hwnd: isize) -> Option<String> {
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_RelaunchCommand;
    sys::prop(sys::hwnd(hwnd), &PKEY_AppUserModel_RelaunchCommand)
}

#[cfg(windows)]
pub fn pid_of_window(hwnd: isize) -> u32 {
    sys::pid(sys::hwnd(hwnd))
}

#[cfg(windows)]
pub fn title_of_window(hwnd: isize) -> String {
    sys::text(sys::hwnd(hwnd))
}

#[cfg(windows)]
pub fn class_of_window(hwnd: isize) -> String {
    sys::class(sys::hwnd(hwnd))
}

#[cfg(windows)]
pub fn ex_style_of_window(hwnd: isize) -> u32 {
    sys::ex_style(sys::hwnd(hwnd))
}

/// Top-level windows in Z-order. Hidden windows are skipped early (the filter drops them anyway) so the slower AUMID /
/// exe lookups run only for candidates.
#[cfg(windows)]
pub fn enumerate(monitors: &[Monitor]) -> Vec<RawWindow> {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetPropW, GetWindow, IsIconic, IsWindowVisible, GW_OWNER};

    unsafe extern "system" fn collect(h: HWND, out: LPARAM) -> windows::core::BOOL {
        // SAFETY: `out` is the &mut Vec below, alive for the whole EnumWindows call.
        unsafe { &mut *(out.0 as *mut Vec<isize>) }.push(h.0 as isize);
        true.into()
    }
    let mut handles: Vec<isize> = Vec::new();
    // SAFETY: the callback only pushes into `handles`, which outlives the call.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut handles as *mut Vec<isize> as isize)) };

    let (own_pid, own_exe) = (std::process::id(), std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default());
    handles
        .into_iter()
        .filter_map(|raw| {
            let h = sys::hwnd(raw);
            // SAFETY: handles from EnumWindows; a window that closed meanwhile only answers false / empty.
            let (visible, minimized) = unsafe { (IsWindowVisible(h).as_bool(), IsIconic(h).as_bool()) };
            if !visible {
                return None;
            }
            let title = sys::text(h);
            if title.trim().is_empty() {
                return None;
            }
            // SAFETY: as above.
            let owned = unsafe { GetWindow(h, GW_OWNER) }.is_ok_and(|o| !o.is_invalid());
            let rect = sys::rect(h);
            let pid = sys::pid(h);
            let exe_path = sys::exe_path(pid);
            if notch_core::apps::is_own(pid, &exe_path, own_pid, &own_exe) {
                return None;
            }
            Some(RawWindow {
                hwnd: raw,
                title,
                class: sys::class(h),
                ex_style: sys::ex_style(h),
                visible,
                minimized,
                cloaked: sys::cloaked(h),
                // SAFETY: as above; a constant property name.
                deleted: !unsafe { GetPropW(h, w!("ITaskList_Deleted")) }.is_invalid(),
                owned,
                aumid: sys::aumid(h),
                exe_path,
                monitor: rect.as_ref().and_then(|r| monitor_of(r, monitors)),
                elevated: notch_core::apps::beyond_reach(notch_elevated(), sys::elevated(pid)),
            })
        })
        .collect()
}

/// The foreground window's handle (0 = none).
#[cfg(windows)]
pub fn foreground() -> isize {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    // SAFETY: no arguments.
    unsafe { GetForegroundWindow() }.0 as isize
}

/// The foreground window covers its whole monitor (borderless fullscreen video / game).
#[cfg(windows)]
pub fn foreground_covers() -> bool {
    foreground_cover_monitor().is_some()
}

/// The index (`Monitor::index`) of the monitor the foreground window covers completely, if any: which screen a
/// fullscreen video is on (scenario 39).
#[cfg(windows)]
pub fn foreground_cover_monitor() -> Option<usize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    // SAFETY: no arguments; a null result is checked.
    let h = unsafe { GetForegroundWindow() };
    if h.is_invalid() || is_desktop_class(&sys::class(h)) {
        return None;
    }
    let r = sys::rect(h)?;
    let monitors = crate::monitors::list();
    let i = monitor_of(&r, &monitors)?;
    monitors.get(i).filter(|m| r.covers(&m.rect)).map(|m| m.index)
}

/// `AppControl` on the real desktop.
#[cfg(windows)]
pub struct Win32Control;

#[cfg(windows)]
impl notch_core::ports::AppControl for Win32Control {
    fn launch(&self, target: &str) -> bool {
        self.run(target, "")
    }

    fn run(&self, target: &str, args: &str) -> bool {
        use windows::core::{w, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let (file, params) = (crate::to_wide(target), crate::to_wide(args));
        let params = if args.is_empty() { PCWSTR::null() } else { PCWSTR(params.as_ptr()) };
        // SAFETY: NUL-terminated wide strings that outlive the call; > 32 = success (Microsoft Learn).
        let r = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(file.as_ptr()), params, PCWSTR::null(), SW_SHOWNORMAL) };
        r.0 as isize > 32
    }

    fn focus(&self, hwnd: isize) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{IsIconic, SetForegroundWindow, ShowWindowAsync, SW_RESTORE};
        let h = sys::hwnd(hwnd);
        // SAFETY: a handle Notch listed; a stale one just fails.
        unsafe {
            if IsIconic(h).as_bool() {
                let _ = ShowWindowAsync(h, SW_RESTORE);
            }
            // Allowed because the owner's click on the strip was this process's last input (unverified: Wave 1 check).
            SetForegroundWindow(h).as_bool()
        }
    }

    fn close(&self, hwnd: isize) -> bool {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
        // SAFETY: posting WM_CLOSE to a listed top-level window; the app decides (it may ask to save).
        unsafe { PostMessageW(Some(sys::hwnd(hwnd)), WM_CLOSE, WPARAM(0), LPARAM(0)) }.is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn own_token_is_readable_and_a_missing_process_is_none() {
        assert!(sys::elevated(std::process::id()).is_some());
        assert_eq!(sys::elevated(0), None, "the idle process: no token for us");
    }

    fn mon(index: usize, left: i32) -> Monitor {
        let rect = Rect { left, top: 0, right: left + 1920, bottom: 1080 };
        Monitor { index, rect, work: rect, scale: 1.0, primary: index == 0, hz: 60 }
    }

    #[test]
    fn a_window_belongs_to_the_monitor_under_its_centre() {
        let ms = [mon(0, 0), mon(1, 1920)];
        assert_eq!(monitor_of(&Rect { left: 1800, top: 0, right: 2400, bottom: 500 }, &ms), Some(1));
        assert_eq!(monitor_of(&Rect { left: -8, top: -8, right: 1928, bottom: 1088 }, &ms), Some(0), "maximised");
        assert_eq!(monitor_of(&Rect { left: -5000, top: 0, right: -4000, bottom: 10 }, &ms), None);
    }

    #[test]
    fn the_desktop_is_not_a_fullscreen_app() {
        assert!(is_desktop_class("Progman") && is_desktop_class("WorkerW"));
        assert!(!is_desktop_class("Chrome_WidgetWin_1"));
    }
}
