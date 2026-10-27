//! A small `Shell_TrayWnd` listener, modelled after the MIT-licensed new_win tray host and Peeka's Wave 0 probe.
//! It never replaces Explorer: every `WM_COPYDATA` is promptly forwarded to the real taskbar, while this private
//! window remembers enough of the app's registration to replay its own left or context-menu callback.

use parking_lot::Mutex;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Click {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Icon {
    hwnd: usize,
    pid: u32,
    uid: u32,
    callback: u32,
    version: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Message {
    kind: u32,
    hwnd: usize,
    uid: u32,
    flags: u32,
    callback: u32,
    version: Option<u32>,
}

static ICONS: Mutex<Vec<Icon>> = Mutex::new(Vec::new());
#[cfg(windows)]
static HOST: OnceLock<isize> = OnceLock::new();

/// Start the listener on its own message-loop thread. It is intentionally independent of Tauri's event loop.
#[cfg(windows)]
pub fn start() {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_ok() {
        std::thread::spawn(run);
    }
}

#[cfg(not(windows))]
pub fn start() {}

/// Ask the listener to leave and make apps re-register with Explorer on the way out.
#[cfg(windows)]
pub fn stop() {
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
    if let Some(&host) = HOST.get() {
        // SAFETY: our own window; a failed post only means its thread already ended.
        let _ = unsafe {
            PostMessageW(
                Some(windows::Win32::Foundation::HWND(host as *mut _)),
                WM_CLOSE,
                Default::default(),
                Default::default(),
            )
        };
    }
}

#[cfg(not(windows))]
pub fn stop() {}

/// Deliver an app's registered tray callback. `false` means it was not mirrored (notably elevated apps), so callers
/// can use their normal focus/launch fallback.
#[cfg(windows)]
pub fn click(exe: &str, point: Option<(i32, i32)>, click: Click) -> bool {
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, GetCursorPos, PostMessageW, WM_CONTEXTMENU, WM_LBUTTONDOWN, WM_LBUTTONUP,
        WM_RBUTTONDOWN, WM_RBUTTONUP,
    };
    let Some(icon) = ICONS.lock().iter().find(|i| same_path(&exe_of_pid(i.pid), exe)).cloned() else { return false };
    let hwnd = HWND(icon.hwnd as *mut _);
    let mut cursor = POINT::default();
    // SAFETY: registered window handle and plain callback messages from the icon's owner.
    unsafe {
        let _ = GetCursorPos(&mut cursor);
        let (x, y) = point.unwrap_or((cursor.x, cursor.y));
        let _ = AllowSetForegroundWindow(pid_of(hwnd));
        let xy = WPARAM(((y as u16 as usize) << 16) | x as u16 as usize);
        const NIN_SELECT: u32 = 0x0400;
        let events: &[u32] = match click {
            Click::Left if icon.version >= 4 => &[NIN_SELECT],
            Click::Left => &[WM_LBUTTONDOWN, WM_LBUTTONUP],
            Click::Right if icon.version >= 4 => &[WM_CONTEXTMENU],
            Click::Right => &[WM_RBUTTONDOWN, WM_RBUTTONUP],
        };
        events.iter().all(|&event| {
            let (wparam, lparam) = if icon.version >= 4 {
                (xy, LPARAM(((icon.uid as isize & 0xffff) << 16) | event as isize))
            } else {
                (WPARAM(icon.uid as usize), LPARAM(event as isize))
            };
            PostMessageW(Some(hwnd), icon.callback, wparam, lparam).is_ok()
        })
    }
}

#[cfg(not(windows))]
pub fn click(_exe: &str, _point: Option<(i32, i32)>, _click: Click) -> bool {
    false
}

fn same_path(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn apply(message: Message, pid: u32) {
    const NIM_ADD: u32 = 0;
    const NIM_MODIFY: u32 = 1;
    const NIM_DELETE: u32 = 2;
    const NIM_SETVERSION: u32 = 4;
    const NIF_MESSAGE: u32 = 1;
    let mut icons = ICONS.lock();
    let at = icons.iter().position(|i| i.hwnd == message.hwnd && i.uid == message.uid);
    match (message.kind, at) {
        (NIM_ADD | NIM_MODIFY, None) if message.callback != 0 => {
            icons.push(Icon { hwnd: message.hwnd, pid, uid: message.uid, callback: message.callback, version: 0 })
        }
        (NIM_ADD | NIM_MODIFY, Some(i)) => {
            if message.flags & NIF_MESSAGE != 0 {
                icons[i].callback = message.callback;
            }
            icons[i].pid = pid;
        }
        (NIM_DELETE, Some(i)) => {
            icons.remove(i);
        }
        (NIM_SETVERSION, Some(i)) => {
            icons[i].version = message.version.unwrap_or(0);
        }
        _ => {}
    }
}

/// Peeka's probe-established 32-bit `Shell_NotifyIcon` packet layout. Unknown packets are still forwarded unchanged.
fn parse(bytes: &[u8]) -> Option<Message> {
    let at = |offset: usize| bytes.get(offset..offset + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
    if at(0)? != 0x3475_3423 || bytes.len() < 288 {
        return None;
    }
    Some(Message {
        kind: at(4)?,
        hwnd: at(12)? as usize,
        uid: at(16)?,
        flags: at(20)?,
        callback: at(24)?,
        version: at(808),
    })
}

#[cfg(windows)]
fn run() {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, WNDCLASSW, WS_EX_TOOLWINDOW,
        WS_POPUP,
    };
    // SAFETY: class and window are owned by this dedicated thread; no Tauri state is touched here.
    unsafe {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let _ = RegisterClassW(&WNDCLASSW {
            hInstance: instance.into(),
            lpszClassName: w!("Shell_TrayWnd"),
            lpfnWndProc: Some(proc),
            ..Default::default()
        });
        let host = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            w!("Shell_TrayWnd"),
            w!(""),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .unwrap_or(HWND::default());
        if host.is_invalid() {
            return;
        }
        let _ = HOST.set(host.0 as isize);
        broadcast_created();
        let mut message = Default::default();
        while GetMessageW(&mut message, None, 0, 0).into() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        broadcast_created();
        let _ = (LPARAM::default(), WPARAM::default(), LRESULT::default());
    }
}

#[cfg(windows)]
unsafe extern "system" fn proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, DestroyWindow, PostQuitMessage, SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_CLOSE, WM_COPYDATA,
        WM_DESTROY,
    };
    if msg == WM_COPYDATA {
        // SAFETY: WM_COPYDATA makes this buffer valid only for this synchronous call; parsing and the mutex are local.
        let copy = unsafe { &*(lparam.0 as *const COPYDATASTRUCT) };
        if copy.dwData == 1 && !copy.lpData.is_null() {
            let bytes = unsafe { std::slice::from_raw_parts(copy.lpData as *const u8, copy.cbData as usize) };
            if let Some(packet) = parse(bytes) {
                apply(packet, pid_of(windows::Win32::Foundation::HWND(packet.hwnd as *mut _)));
            }
        }
        let mut result = 0usize;
        if let Some(real) = explorer_tray() {
            // SAFETY: Windows remarshal the same synchronous COPYDATA to Explorer; the timeout keeps senders moving.
            unsafe {
                SendMessageTimeoutW(real, WM_COPYDATA, wparam, lparam, SMTO_ABORTIFHUNG, 250, Some(&mut result));
            }
        }
        return LRESULT(result as isize);
    }
    if msg == WM_CLOSE {
        unsafe {
            let _ = DestroyWindow(hwnd);
        };
        return LRESULT(0);
    }
    if msg == WM_DESTROY {
        unsafe { PostQuitMessage(0) };
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

#[cfg(windows)]
fn explorer_tray() -> Option<windows::Win32::Foundation::HWND> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowThreadProcessId};
    let me = std::process::id();
    let mut after = HWND::default();
    for _ in 0..8 {
        // SAFETY: top-level enumeration after the prior match; result and process id are checked.
        let next = unsafe { FindWindowExW(None, Some(after), w!("Shell_TrayWnd"), PCWSTR::null()) }.ok()?;
        if next.is_invalid() {
            return None;
        }
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(next, Some(&mut pid));
        }
        if pid != me {
            return Some(next);
        }
        after = next;
    }
    None
}

#[cfg(windows)]
fn broadcast_created() {
    use windows::core::w;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, RegisterWindowMessageW, HWND_BROADCAST};
    // SAFETY: TaskbarCreated has no pointer payload and a posted broadcast cannot stall the host.
    unsafe {
        let id = RegisterWindowMessageW(w!("TaskbarCreated"));
        let _ = PostMessageW(Some(HWND_BROADCAST), id, WPARAM(0), LPARAM(0));
    }
}

#[cfg(windows)]
fn pid_of(hwnd: windows::Win32::Foundation::HWND) -> u32 {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let mut pid = 0;
    // SAFETY: a registered app window can be stale; Windows simply returns zero.
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid
}

#[cfg(windows)]
fn exe_of_pid(pid: u32) -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return String::new();
    };
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: this process owns the buffer and handle for the duration of the query.
    let ok =
        unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.is_ok();
    unsafe {
        let _ = CloseHandle(process);
    }
    ok.then(|| String::from_utf16_lossy(&buf[..len as usize])).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_parsing_and_path_matching_are_strict() {
        let mut bytes = vec![0u8; 812];
        bytes[0..4].copy_from_slice(&0x3475_3423u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&42u32.to_le_bytes());
        bytes[16..20].copy_from_slice(&7u32.to_le_bytes());
        bytes[20..24].copy_from_slice(&1u32.to_le_bytes());
        bytes[24..28].copy_from_slice(&0x9000u32.to_le_bytes());
        bytes[808..812].copy_from_slice(&4u32.to_le_bytes());
        assert_eq!(
            parse(&bytes),
            Some(Message { kind: 1, hwnd: 42, uid: 7, flags: 1, callback: 0x9000, version: Some(4) })
        );
        assert!(same_path(r"C:\Apps\Tool.exe", r"c:\apps\tool.EXE"));
        assert!(!same_path(r"C:\Apps\Tool.exe", r"C:\Apps\Other.exe"));
        assert!(parse(&bytes[..100]).is_none());
    }
}
