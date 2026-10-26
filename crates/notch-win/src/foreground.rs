//! The foreground-app watcher for shortcut exceptions: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on its
//! own thread with a message loop; each change hands the new front app's exe path to the sink once. What to do with
//! it is `notch_core::shortcuts::ShortcutGate` (tested there).
//! The same thread hears what the shell hook (`flash`) misses: windows shown, hidden (an app minimised to the tray) or
//! cloaked (a virtual desktop switch) poke the strips' list; the taskbar showing again wakes the re-hide at once.

/// Passes on a foreground change only when the app actually changed (focus moving between two Chrome windows, or
/// back and forth inside one app, is not a change).
#[derive(Default)]
pub struct Dedupe {
    last: Option<String>,
}

impl Dedupe {
    pub fn changed(&mut self, exe: &str) -> bool {
        let exe = exe.to_lowercase();
        if self.last.as_deref() == Some(exe.as_str()) {
            return false;
        }
        self.last = Some(exe);
        true
    }
}

#[cfg(windows)]
type Sink = Box<dyn Fn(String) + Send + Sync>;
#[cfg(windows)]
static SINK: std::sync::OnceLock<Sink> = std::sync::OnceLock::new();
#[cfg(windows)]
static SEEN: parking_lot::Mutex<Dedupe> = parking_lot::Mutex::new(Dedupe { last: None });
/// The last window outside Notch that came to the front (the hook skips our own process); 0 = none yet.
static LAST_OTHER: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// The last window of another process that was in front: where a press on a strip or the island hands the focus back.
pub fn last_other() -> isize {
    LAST_OTHER.load(std::sync::atomic::Ordering::SeqCst)
}

/// Runs (on the watcher thread) when Explorer shows a taskbar window (`Shell_TrayWnd` / `Shell_SecondaryTrayWnd`).
static ON_TASKBAR_SHOWN: std::sync::OnceLock<fn()> = std::sync::OnceLock::new();

/// `f` hears the native taskbar coming back (Win key, Explorer restart): the full-hide worker re-hides at once.
pub fn on_taskbar_shown(f: fn()) {
    let _ = ON_TASKBAR_SHOWN.set(f);
}

/// The taskbar's own window classes.
pub fn is_taskbar_class(class: &str) -> bool {
    class.eq_ignore_ascii_case("Shell_TrayWnd") || class.eq_ignore_ascii_case("Shell_SecondaryTrayWnd")
}

/// Could a window shown / hidden / cloaked with these traits be on the strip? Cheap, so tooltips and menus (tool
/// windows, untitled, owned popups) never cost a relist.
pub fn may_be_listed(titled: bool, ex_style: u32, owned: bool) -> bool {
    use notch_core::apps::{WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW};
    titled && ex_style & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) == 0 && (!owned || ex_style & WS_EX_APPWINDOW != 0)
}

/// Start the watcher once per process; false = already started or the hook could not be set. `sink` gets the exe path
/// ("" = unknown, e.g. an elevated window) on the watcher thread.
#[cfg(windows)]
pub fn watch(sink: impl Fn(String) + Send + Sync + 'static) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_HIDE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED,
        EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    unsafe extern "system" fn on_event(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        _object: i32,
        _child: i32,
        _thread: u32,
        _time: u32,
    ) {
        LAST_OTHER.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
        // The strip's foreground dot follows at once.
        crate::flash::poke(crate::flash::Relist::Soon);
        // Paint / Terminal climb over Notch a moment after they come to the front (`style::keep_on_top`).
        std::thread::spawn(|| {
            for wait in [100, 400] {
                std::thread::sleep(std::time::Duration::from_millis(wait));
                crate::style::keep_on_top();
            }
        });
        let exe = crate::apps::exe_of_window(hwnd.0 as isize);
        if SEEN.lock().changed(&exe) {
            if let Some(sink) = SINK.get() {
                sink(exe);
            }
        }
    }

    /// A top-level window shown, hidden or (un)cloaked.
    unsafe extern "system" fn on_window(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        object: i32,
        child: i32,
        _thread: u32,
        _time: u32,
    ) {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindow, GetWindowTextLengthW, GA_ROOT, GW_OWNER, OBJID_WINDOW,
        };
        if object != OBJID_WINDOW.0 || child != 0 || hwnd.is_invalid() {
            return;
        }
        // SAFETY: a handle from the event; a window gone meanwhile only answers null / 0.
        unsafe {
            if GetAncestor(hwnd, GA_ROOT) != hwnd {
                return;
            }
            let h = hwnd.0 as isize;
            if event == EVENT_OBJECT_SHOW && is_taskbar_class(&crate::apps::class_of_window(h)) {
                if let Some(f) = ON_TASKBAR_SHOWN.get() {
                    f();
                }
                return;
            }
            let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid());
            if may_be_listed(GetWindowTextLengthW(hwnd) > 0, crate::apps::ex_style_of_window(h), owned) {
                crate::flash::poke(crate::flash::Relist::Soon);
            }
        }
    }

    if SINK.set(Box::new(sink)).is_err() {
        return false;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        // SAFETY: an out-of-context hook (no DLL injection), delivered to this thread's message loop below.
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };
        let _ = tx.send(!hook.is_invalid());
        if hook.is_invalid() {
            return;
        }
        for (from, to) in [(EVENT_OBJECT_SHOW, EVENT_OBJECT_HIDE), (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED)] {
            // SAFETY: as above. A failed hook only leaves that case to the slow re-scan.
            let h = unsafe {
                SetWinEventHook(from, to, None, Some(on_window), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS)
            };
            if h.is_invalid() {
                eprintln!("[foreground] window events {from:#x}-{to:#x} not hooked");
            }
        }
        let mut msg = MSG::default();
        // SAFETY: a plain message loop on the thread that owns the hook; ends only with the process.
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            unsafe { DispatchMessageW(&msg) };
        }
    });
    rx.recv().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_app_change_passes() {
        let mut d = Dedupe::default();
        assert!(d.changed("C:\\x\\chrome.exe"));
        assert!(!d.changed("C:\\X\\Chrome.exe"), "another window of the same app");
        assert!(d.changed("C:\\Windows\\explorer.exe"));
        assert!(d.changed(""), "unknown counts as a change (the gate takes shortcuts back)");
        assert!(!d.changed(""));
    }

    #[test]
    fn only_app_like_windows_and_the_taskbar_count() {
        use notch_core::apps::{WS_EX_APPWINDOW, WS_EX_TOOLWINDOW};
        assert!(may_be_listed(true, 0, false), "an app window (Discord back from the tray)");
        assert!(!may_be_listed(false, 0, false), "untitled: a menu, a splash");
        assert!(!may_be_listed(true, WS_EX_TOOLWINDOW, false), "a tooltip");
        assert!(!may_be_listed(true, 0, true), "a dialog");
        assert!(may_be_listed(true, WS_EX_APPWINDOW, true), "forced onto the bar");
        assert!(is_taskbar_class("Shell_TrayWnd") && is_taskbar_class("shell_secondarytraywnd"));
        assert!(!is_taskbar_class("Progman"));
    }
}
