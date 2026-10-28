//! A small `Shell_TrayWnd` listener, modelled after the MIT-licensed new_win tray host and Peeka's Wave 0 probe.
//! It never replaces Explorer: every `WM_COPYDATA` is promptly forwarded to the real taskbar, while this private
//! window remembers enough of the app's registration to replay its own left or context-menu callback.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

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

#[derive(Clone, Debug, PartialEq, Eq)]
struct Message {
    kind: u32,
    hwnd: usize,
    uid: u32,
    flags: u32,
    callback: u32,
    version: Option<u32>,
    /// The app's HICON (NIF_ICON only); a handle in the session, valid until the app destroys it.
    icon: Option<u32>,
    tip: Option<String>,
    /// NIS_HIDDEN, when NIF_STATE and the mask carry it.
    hidden: Option<bool>,
}

/// An icon's live look, kept per (hwnd, uid) until NIM_DELETE or NIS_HIDDEN.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Live {
    pub icon: Option<crate::icons::Icon>,
    pub tip: Option<String>,
}

type Key = (usize, u32);

/// What the window procedure hands the worker. `icon` is our own `CopyIcon` copy as an isize (HICON is not Send).
#[derive(Debug, Default, PartialEq, Eq)]
struct Pending {
    pid: u32,
    icon: Option<isize>,
    tip: Option<String>,
    gone: bool,
}

static ICONS: Mutex<Vec<Icon>> = Mutex::new(Vec::new());
#[cfg(windows)]
static HOST: OnceLock<isize> = OnceLock::new();
#[cfg(windows)]
static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();
static LIVE: Mutex<Vec<(Key, String, Live)>> = Mutex::new(Vec::new());
static CHANGES: OnceLock<std::sync::mpsc::Sender<(Key, Pending)>> = OnceLock::new();
static ON_LIVE: OnceLock<Box<dyn Fn(&str) + Send + Sync>> = OnceLock::new();

/// Called on the worker thread with the exe path whenever an icon's live look changed or went (never in the wndproc).
pub fn on_live(f: impl Fn(&str) + Send + Sync + 'static) {
    let _ = ON_LIVE.set(Box::new(f));
}

/// The live look of `exe`'s tray icon; None = never heard, deleted or hidden (the registry snapshot stands).
/// shortcut: an app with two tray icons shows whichever changed first in the list; key by uid if that shows.
pub fn live(exe: &str) -> Option<Live> {
    LIVE.lock().iter().find(|(_, e, _)| same_path(e, exe)).map(|(.., l)| l.clone())
}

/// Fewest ms between two conversions of one icon (an animating icon: ~4 a second).
const GAP: Duration = Duration::from_millis(250);

/// Fold a newer change into one still waiting; returns a superseded icon copy for the caller to destroy.
fn merge(slot: &mut Pending, next: Pending) -> Option<isize> {
    let old = if next.icon.is_some() || next.gone { slot.icon.take() } else { None };
    let tip = if next.gone { None } else { next.tip.or(slot.tip.take()) };
    let icon = next.icon.or(slot.icon.take());
    *slot = Pending { pid: next.pid, icon, tip, gone: next.gone };
    old
}

/// Is a change to an icon last shown at `last` allowed out at `now`?
fn due(last: Option<Instant>, now: Instant) -> bool {
    last.is_none_or(|t| now.duration_since(t) >= GAP)
}

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

fn apply(message: &Message, pid: u32) {
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
    const NIF_ICON: u32 = 2;
    const NIF_TIP: u32 = 4;
    const NIF_STATE: u32 = 8;
    const NIS_HIDDEN: u32 = 1;
    if at(0)? != 0x3475_3423 || bytes.len() < 288 {
        return None;
    }
    let flags = at(20)?;
    Some(Message {
        kind: at(4)?,
        hwnd: at(12)? as usize,
        uid: at(16)?,
        flags,
        callback: at(24)?,
        version: at(808),
        icon: (flags & NIF_ICON != 0).then(|| at(28)).flatten(),
        tip: (flags & NIF_TIP != 0).then(|| {
            let units: Vec<u16> =
                bytes[32..288].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
            String::from_utf16_lossy(&units)
        }),
        hidden: (flags & NIF_STATE != 0 && at(292)? & NIS_HIDDEN != 0).then(|| at(288).map(|s| s & NIS_HIDDEN != 0)).flatten(),
    })
}

#[cfg(windows)]
fn run() {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, WNDCLASSW, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_POPUP,
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
            // Explorer's real tray is topmost too.  This must be topmost before its first Shell_NotifyIcon send so
            // this listener is the first Shell_TrayWnd in Z-order.
            WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
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
        reassert_topmost(host);
        let reorder_hook = watch_explorer_reorder();
        broadcast_created();
        let mut message = Default::default();
        while GetMessageW(&mut message, None, 0, 0).into() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if let Some(hook) = reorder_hook {
            // SAFETY: the hook was installed on this message-loop thread.
            let _ = windows::Win32::UI::Accessibility::UnhookWinEvent(hook);
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
                let pid = pid_of(windows::Win32::Foundation::HWND(packet.hwnd as *mut _));
                apply(&packet, pid);
                hand_off(&packet, pid);
            }
        }
        let mut result = 0usize;
        if let Some(real) = explorer_tray() {
            // SAFETY: Windows remarshal the original synchronous COPYDATA to Explorer.  In particular this handles
            // Peeka's SHAppBarMessage packets now that our topmost Shell_TrayWnd is found first; the timeout means a
            // stuck Explorer cannot deadlock the app that synchronously sent us the packet.
            unsafe { SendMessageTimeoutW(real, WM_COPYDATA, wparam, lparam, SMTO_ABORTIFHUNG, 250, Some(&mut result)) };
        }
        return LRESULT(result as isize);
    }
    if msg == taskbar_created_message() {
        // Explorer recreated its topmost taskbar. Put the listener back in front before the next notification send.
        reassert_topmost(hwnd);
        return LRESULT(0);
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

/// In the wndproc: copy the icon now (apps often destroy theirs right after the call) and queue it. No conversion and
/// no Tauri here; the worker does both.
#[cfg(windows)]
fn hand_off(m: &Message, pid: u32) {
    use windows::Win32::UI::WindowsAndMessaging::{CopyIcon, HICON};
    const NIM_ADD: u32 = 0;
    const NIM_MODIFY: u32 = 1;
    const NIM_DELETE: u32 = 2;
    let gone = m.kind == NIM_DELETE || m.hidden == Some(true);
    if !gone && !matches!(m.kind, NIM_ADD | NIM_MODIFY) {
        return;
    }
    // The packet holds 32 bits of the handle; USER handles are sign-extended in 64-bit processes.
    let icon = m.icon.filter(|&h| !gone && h != 0).and_then(|h| {
        // SAFETY: a session-wide USER handle from the sender, valid for this synchronous call; the copy is ours.
        unsafe { CopyIcon(HICON(h as i32 as isize as *mut _)) }.ok().map(|c| c.0 as isize)
    });
    if !gone && icon.is_none() && m.tip.is_none() {
        return;
    }
    let tx = CHANGES.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || worker(rx));
        tx
    });
    let _ = tx.send(((m.hwnd, m.uid), Pending { pid, icon, tip: m.tip.clone(), gone }));
}

/// Coalesces each icon's changes and lets at most one through per `GAP`, converting off the wndproc thread.
#[cfg(windows)]
fn worker(rx: std::sync::mpsc::Receiver<(Key, Pending)>) {
    use std::sync::mpsc::RecvTimeoutError;
    let mut waiting: HashMap<Key, Pending> = HashMap::new();
    let mut shown: HashMap<Key, Instant> = HashMap::new();
    loop {
        let now = Instant::now();
        let wait = waiting
            .keys()
            .map(|k| shown.get(k).map_or(Duration::ZERO, |t| (*t + GAP).saturating_duration_since(now)))
            .min()
            .unwrap_or(Duration::from_secs(3600));
        match rx.recv_timeout(wait) {
            Ok((key, next)) => {
                if let Some(old) = merge(waiting.entry(key).or_default(), next) {
                    destroy_icon(old);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let now = Instant::now();
        let ready: Vec<Key> = waiting.keys().filter(|k| due(shown.get(k).copied(), now)).copied().collect();
        for key in ready {
            let Some(p) = waiting.remove(&key) else { continue };
            if p.gone {
                shown.remove(&key);
            } else {
                shown.insert(key, now);
            }
            show(key, p);
        }
    }
}

/// One change into `LIVE`, then `on_live` with the app's exe.
#[cfg(windows)]
fn show(key: Key, p: Pending) {
    let exe = if p.gone {
        let mut live = LIVE.lock();
        let Some(i) = live.iter().position(|(k, ..)| *k == key) else { return };
        live.remove(i).1
    } else {
        let icon = p.icon.and_then(|h| {
            let i = crate::icons::from_hicon(h);
            destroy_icon(h);
            i
        });
        let exe = exe_of_pid(p.pid);
        if exe.is_empty() || (icon.is_none() && p.tip.is_none()) {
            return;
        }
        let mut live = LIVE.lock();
        let i = live.iter().position(|(k, ..)| *k == key).unwrap_or_else(|| {
            live.push((key, String::new(), Live::default()));
            live.len() - 1
        });
        let entry = &mut live[i];
        entry.1 = exe.clone();
        if icon.is_some() {
            entry.2.icon = icon;
        }
        if p.tip.is_some() {
            entry.2.tip = p.tip;
        }
        exe
    };
    if let Some(f) = ON_LIVE.get() {
        f(&exe);
    }
}

#[cfg(windows)]
fn destroy_icon(h: isize) {
    // SAFETY: a `CopyIcon` copy only this module owns, destroyed once.
    let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::DestroyIcon(windows::Win32::UI::WindowsAndMessaging::HICON(h as *mut _)) };
}

#[cfg(windows)]
pub(crate) fn explorer_tray() -> Option<windows::Win32::Foundation::HWND> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowThreadProcessId};
    let me = std::process::id();
    let mut after = HWND::default();
    let mut candidates = Vec::with_capacity(8);
    let mut pids = Vec::with_capacity(8);
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
        candidates.push((next, pid));
        pids.push(pid);
        after = next;
    }
    first_foreign_index(&pids, me).map(|index| candidates[index].0)
}

/// Finds the first tray candidate not owned by Peeka.  Kept pure so the own-tray exclusion stays tested even on
/// non-Windows CI.
fn first_foreign_index(pids: &[u32], ours: u32) -> Option<usize> {
    pids.iter().position(|&pid| pid != ours)
}

#[cfg(windows)]
fn taskbar_created_message() -> u32 {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::RegisterWindowMessageW;
    *TASKBAR_CREATED.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) })
}

#[cfg(windows)]
fn reassert_topmost(host: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
    // SAFETY: this is our hidden tool window; this only adjusts Z-order and never activates or moves it.
    unsafe {
        let _ = SetWindowPos(host, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

#[cfg(windows)]
fn watch_explorer_reorder() -> Option<windows::Win32::UI::Accessibility::HWINEVENTHOOK> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        EVENT_OBJECT_REORDER, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    unsafe extern "system" fn on_reorder(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        object: i32,
        child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if object != OBJID_WINDOW.0 || child != 0 || hwnd.is_invalid() {
            return;
        }
        if explorer_tray() == Some(hwnd) {
            if let Some(&host) = HOST.get() {
                reassert_topmost(HWND(host as *mut _));
            }
        }
    }

    // SAFETY: out-of-context events are delivered to this thread's message loop; the hook is released before it exits.
    let hook = unsafe {
        SetWinEventHook(
            EVENT_OBJECT_REORDER,
            EVENT_OBJECT_REORDER,
            None,
            Some(on_reorder),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    (!hook.is_invalid()).then_some(hook)
}

#[cfg(windows)]
fn broadcast_created() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, HWND_BROADCAST};
    // SAFETY: TaskbarCreated has no pointer payload and a posted broadcast cannot stall the host.
    unsafe {
        let _ = PostMessageW(Some(HWND_BROADCAST), taskbar_created_message(), WPARAM(0), LPARAM(0));
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
            Some(Message {
                kind: 1,
                hwnd: 42,
                uid: 7,
                flags: 1,
                callback: 0x9000,
                version: Some(4),
                icon: None,
                tip: None,
                hidden: None
            })
        );
        // NIF_ICON | NIF_TIP | NIF_STATE with NIS_HIDDEN in both state and mask.
        bytes[20..24].copy_from_slice(&(2u32 | 4 | 8).to_le_bytes());
        bytes[28..32].copy_from_slice(&0x1234u32.to_le_bytes());
        for (i, u) in "Discord".encode_utf16().enumerate() {
            bytes[32 + i * 2..34 + i * 2].copy_from_slice(&u.to_le_bytes());
        }
        bytes[288..292].copy_from_slice(&1u32.to_le_bytes());
        bytes[292..296].copy_from_slice(&1u32.to_le_bytes());
        let m = parse(&bytes).unwrap();
        assert_eq!((m.icon, m.tip.as_deref(), m.hidden), (Some(0x1234), Some("Discord"), Some(true)));
        bytes[292..296].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(parse(&bytes).unwrap().hidden, None, "state outside the mask says nothing");
        assert!(same_path(r"C:\Apps\Tool.exe", r"c:\apps\tool.EXE"));
        assert!(!same_path(r"C:\Apps\Tool.exe", r"C:\Apps\Other.exe"));
        assert!(parse(&bytes[..100]).is_none());
    }

    #[test]
    fn changes_coalesce_and_are_throttled() {
        let mut slot = Pending::default();
        assert_eq!(merge(&mut slot, Pending { pid: 1, icon: Some(10), tip: Some("a".into()), gone: false }), None);
        assert_eq!(merge(&mut slot, Pending { pid: 1, icon: None, tip: None, gone: false }), None, "a tip-only no-op");
        assert_eq!(slot, Pending { pid: 1, icon: Some(10), tip: Some("a".into()), gone: false });
        assert_eq!(merge(&mut slot, Pending { pid: 1, icon: Some(11), tip: None, gone: false }), Some(10), "older copy freed");
        assert_eq!(slot.tip.as_deref(), Some("a"));
        assert_eq!(merge(&mut slot, Pending { pid: 1, icon: None, tip: None, gone: true }), Some(11));
        assert_eq!(slot, Pending { pid: 1, icon: None, tip: None, gone: true });
        assert_eq!(merge(&mut slot, Pending { pid: 1, icon: Some(12), tip: None, gone: false }), None, "re-added");
        assert!(!slot.gone);
        let t = Instant::now();
        assert!(due(None, t));
        assert!(!due(Some(t), t + Duration::from_millis(100)));
        assert!(due(Some(t), t + GAP));
    }

    #[test]
    fn own_tray_is_skipped_when_selecting_explorer() {
        assert_eq!(first_foreign_index(&[44, 44, 77], 44), Some(2));
        assert_eq!(first_foreign_index(&[44, 44], 44), None);
        assert_eq!(first_foreign_index(&[], 44), None);
    }
}
