//! The foreground-app watcher for shortcut exceptions: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on its
//! own thread with a message loop; each change hands the new front app's exe path to the sink once. What to do with
//! it is `notch_core::shortcuts::ShortcutGate` (tested there).

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

/// Start the watcher once per process; false = already started or the hook could not be set. `sink` gets the exe path
/// ("" = unknown, e.g. an elevated window) on the watcher thread.
#[cfg(windows)]
pub fn watch(sink: impl Fn(String) + Send + Sync + 'static) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
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
}
