//! Windows asking for attention (a taskbar button flashing: `FlashWindowEx`, a chat's new message): the shell hook's
//! `HSHELL_FLASH`, on a hidden window of our own (never shown) with its own message loop. A window stops asking when it
//! comes to the front or closes.
//! The same hook says when the strips' window list changed (a taskbar window came, went, came forward, was retitled):
//! `poke` debounces those (and `foreground`'s WinEvents) into one `changed` call, instead of re-scanning on a timer.
//! Idea from YASB / new_win (MIT): shell hook + WinEvents, debounced.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};

const HSHELL_WINDOWCREATED: usize = 1;
const HSHELL_WINDOWDESTROYED: usize = 2;
const HSHELL_WINDOWACTIVATED: usize = 4;
const HSHELL_REDRAW: usize = 6;
const HSHELL_WINDOWREPLACED: usize = 13;
const HSHELL_MONITORCHANGED: usize = 16;
const HSHELL_RUDEAPPACTIVATED: usize = 0x8004;
const HSHELL_FLASH: usize = 0x8006;

/// What an event asks of the strips' list. `Later`: a title changed (a terminal's spinner retitles ten times a
/// second), relisted at most once per `LATER_MS`. `Soon`: a window came, went, moved, came forward or flashes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relist {
    No = 0,
    Later = 1,
    Soon = 2,
}
const SOON_MS: u64 = 60;
const LATER_MS: u64 = 1000;

fn relist(code: usize) -> Relist {
    match code {
        HSHELL_WINDOWCREATED | HSHELL_WINDOWDESTROYED | HSHELL_WINDOWACTIVATED | HSHELL_RUDEAPPACTIVATED
        | HSHELL_WINDOWREPLACED | HSHELL_MONITORCHANGED => Relist::Soon,
        HSHELL_REDRAW => Relist::Later,
        _ => Relist::No,
    }
}

/// How long after the first pending event the list is sent: the most urgent pending kind decides.
fn debounce_ms(pending: u8) -> u64 {
    if pending >= Relist::Soon as u8 {
        SOON_MS
    } else if pending == Relist::Later as u8 {
        LATER_MS
    } else {
        0
    }
}

static PENDING: AtomicU8 = AtomicU8::new(0);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static DEBOUNCER: std::sync::OnceLock<std::thread::Thread> = std::sync::OnceLock::new();

/// A window event: the strips relist after the debounce. Cheap; safe from any hook callback.
pub fn poke(r: Relist) {
    if r == Relist::No {
        return;
    }
    PENDING.fetch_max(r as u8, Ordering::SeqCst);
    if let Some(t) = DEBOUNCER.get() {
        t.unpark();
    }
}

/// Bumped before each debounced `changed`: strips relisting after the same event can share one enumeration.
pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}

static FLASHING: parking_lot::Mutex<Vec<isize>> = parking_lot::Mutex::new(Vec::new());
static STARTED: AtomicBool = AtomicBool::new(false);

/// One shell hook message onto the set; true = the set changed.
fn on_shell(set: &mut Vec<isize>, code: usize, hwnd: isize) -> bool {
    match code {
        HSHELL_FLASH if !set.contains(&hwnd) => {
            set.push(hwnd);
            true
        }
        HSHELL_WINDOWACTIVATED | HSHELL_RUDEAPPACTIVATED | HSHELL_WINDOWDESTROYED => {
            let n = set.len();
            set.retain(|&h| h != hwnd);
            set.len() != n
        }
        _ => false,
    }
}

/// Is this window asking for attention right now?
pub fn flashing(hwnd: isize) -> bool {
    FLASHING.lock().contains(&hwnd)
}

#[cfg(windows)]
type Sink = Box<dyn Fn() + Send + Sync>;
#[cfg(windows)]
static SINK: std::sync::OnceLock<Sink> = std::sync::OnceLock::new();
#[cfg(windows)]
static SHELLHOOK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Start the watcher once per process; `changed` runs (on the debounce thread) whenever a window starts or stops asking
/// or the list changed (`poke`).
/// False = already started or the hook could not be set (then nothing ever flashes).
#[cfg(windows)]
pub fn watch(changed: impl Fn() + Send + Sync + 'static) -> bool {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, RegisterShellHookWindow,
        RegisterWindowMessageW, MSG, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
    };

    unsafe extern "system" fn proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg != 0 && msg == SHELLHOOK.load(Ordering::SeqCst) {
            let flash = on_shell(&mut FLASHING.lock(), wp.0, lp.0);
            poke(if flash { Relist::Soon } else { relist(wp.0) });
            return LRESULT(0);
        }
        // SAFETY: default handling for every other message of our own window.
        unsafe { DefWindowProcW(h, msg, wp, lp) }
    }

    if STARTED.swap(true, Ordering::SeqCst) {
        return false;
    }
    let _ = SINK.set(Box::new(changed));
    let debouncer = std::thread::spawn(|| loop {
        std::thread::park();
        let first = std::time::Instant::now();
        loop {
            let wait = std::time::Duration::from_millis(debounce_ms(PENDING.load(Ordering::SeqCst)));
            let Some(left) = wait.checked_sub(first.elapsed()).filter(|d| !d.is_zero()) else { break };
            std::thread::park_timeout(left);
        }
        if PENDING.swap(0, Ordering::SeqCst) != 0 {
            GENERATION.fetch_add(1, Ordering::SeqCst);
            if let Some(f) = SINK.get() {
                f();
            }
        }
    });
    let _ = DEBOUNCER.set(debouncer.thread().clone());
    let (done, result) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let class = w!("PeekaShellHook");
        // SAFETY: our own module, a static class name and a window procedure that lives forever. A plain hidden popup
        // (never shown): shell hook messages go to top-level windows.
        let hwnd = unsafe {
            let instance = GetModuleHandleW(None).ok().map(Into::into);
            let wc = WNDCLASSW {
                lpfnWndProc: Some(proc),
                hInstance: instance.unwrap_or_default(),
                lpszClassName: class,
                ..Default::default()
            };
            RegisterClassW(&wc);
            CreateWindowExW(WS_EX_TOOLWINDOW, class, w!(""), WS_POPUP, 0, 0, 0, 0, None, None, instance, None)
        };
        // SAFETY: a constant name; our own live window.
        let ok = hwnd.is_ok_and(|h| unsafe {
            SHELLHOOK.store(RegisterWindowMessageW(w!("SHELLHOOK")), Ordering::SeqCst);
            RegisterShellHookWindow(h).as_bool()
        });
        let _ = done.send(ok);
        if !ok {
            return;
        }
        let mut msg = MSG::default();
        // SAFETY: the window's own message loop, for the life of the process.
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            unsafe { DispatchMessageW(&msg) };
        }
    });
    result.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_asks_until_it_comes_forward_or_closes() {
        let mut set = vec![];
        assert!(on_shell(&mut set, HSHELL_FLASH, 7));
        assert!(!on_shell(&mut set, HSHELL_FLASH, 7), "flashing again changes nothing");
        assert!(on_shell(&mut set, HSHELL_FLASH, 9));
        assert!(!on_shell(&mut set, 6, 7), "a title change (HSHELL_REDRAW) keeps it");
        assert!(on_shell(&mut set, HSHELL_RUDEAPPACTIVATED, 7));
        assert!(!on_shell(&mut set, HSHELL_WINDOWACTIVATED, 7));
        assert!(on_shell(&mut set, HSHELL_WINDOWDESTROYED, 9));
        assert!(set.is_empty());
    }

    #[test]
    fn list_events_are_sent_soon_titles_later_the_rest_never() {
        for code in [HSHELL_WINDOWCREATED, HSHELL_WINDOWDESTROYED, HSHELL_WINDOWACTIVATED, HSHELL_RUDEAPPACTIVATED] {
            assert_eq!(relist(code), Relist::Soon, "{code}");
        }
        assert_eq!(relist(HSHELL_REDRAW), Relist::Later);
        assert_eq!(relist(HSHELL_FLASH), Relist::No, "the flash set decides (on_shell)");
        assert_eq!(relist(3), Relist::No, "HSHELL_ACTIVATESHELLWINDOW");
        assert_eq!(debounce_ms(Relist::Soon as u8), SOON_MS);
        assert_eq!(debounce_ms(Relist::Later as u8), LATER_MS);
        assert_eq!(debounce_ms(0), 0, "nothing pending: nothing sent");
        assert!(SOON_MS < 100 && LATER_MS >= 1000);
    }
}
