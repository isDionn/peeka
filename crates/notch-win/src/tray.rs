//! The read-only tray list's registry side (**PENDING Wave 0 test 4**; rules and why: `notch_core::tray`).

#[cfg(windows)]
use crate::privacy::reg;

#[cfg(windows)]
const KEY: &str = r"Control Panel\NotifyIconSettings";

/// Every subkey of `HKCU\Control Panel\NotifyIconSettings`; empty before Windows 11 22H2 (no such key).
#[cfg(windows)]
pub fn read() -> Vec<notch_core::tray::RawIcon> {
    let Some(root) = reg::hkcu(KEY, false) else { return vec![] };
    reg::subkeys(&root)
        .into_iter()
        .filter_map(|key| {
            let k = reg::open(root.0, &key, false)?;
            Some(notch_core::tray::RawIcon {
                exe: reg::sz(&k, "ExecutablePath"),
                tooltip: reg::sz(&k, "InitialTooltip"),
                promoted: reg::dword(&k, "IsPromoted"),
                key,
            })
        })
        .collect()
}

/// `notch_core::tray::parse` with this machine's folders and running processes.
#[cfg(windows)]
pub fn list() -> Vec<notch_core::tray::TrayIcon> {
    let procs: Vec<(String, String)> =
        crate::session_window::process_table().into_iter().map(|(pid, p)| (p.exe, exe_path(pid))).collect();
    notch_core::tray::parse(
        read(),
        |v| std::env::var(v).ok().filter(|s| !s.is_empty()),
        |p| notch_core::tray::running(p, &procs),
    )
}

/// Full exe path of a process; "" when it cannot be opened (elevated / protected / gone).
#[cfg(windows)]
fn exe_path(pid: u32) -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
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
