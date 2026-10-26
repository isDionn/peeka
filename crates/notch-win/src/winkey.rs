// Peeka — original implementation (MIT). Idea (mask a lone Win tap with an unassigned key) credited to new_win (MIT).
//! A lone Windows-key tap opens Peeka's Start instead of Windows's (`notch_core::shortcuts::WinTap` decides).
//! `WH_KEYBOARD_LL` on its own thread. Win down always passes (Win+E, Win+L keep working). On a lone Win up the hook
//! injects an unassigned key (0xFC) down/up and then the Win up, and swallows the real up: Windows sees Win+<nothing>,
//! so its Start stays shut and Win is never left held. Injected keys (ours, "Open Windows Start", other tools) pass
//! untouched. The hook procedure only posts to a channel; `on_tap` runs on a worker with the hook's `Instant`.
//! Ctrl+Esc (Windows's other Start key) opens Peeka's Start the same way; its Esc is swallowed, Ctrl+Shift+Esc passes.
//! Off (`set_on(false)`, the taskbar left alone or restored) = every key passes. `unhook` on exit and in the panic hook.

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::time::Instant;

#[cfg(windows)]
static ON: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static TAPS: std::sync::OnceLock<std::sync::mpsc::Sender<Instant>> = std::sync::OnceLock::new();
#[cfg(windows)]
static STARTED: AtomicBool = AtomicBool::new(false);
/// The hook handle (0 = none), for `unhook`.
#[cfg(windows)]
static HOOK: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// Lone taps open Peeka's Start (true) or Windows's (false).
#[cfg(windows)]
pub fn set_on(on: bool) {
    ON.store(on, Ordering::SeqCst);
}

#[cfg(windows)]
unsafe extern "system" fn hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use std::cell::RefCell;
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, WM_KEYDOWN, WM_SYSKEYDOWN,
    };
    use notch_core::shortcuts::EscKey;
    thread_local! { static TAP: RefCell<notch_core::shortcuts::WinTap> = RefCell::default(); }
    /// An unassigned virtual key: between Win down and up it turns the press into a combination.
    const VK_MASK: u16 = 0xFC;

    if code == HC_ACTION as i32 {
        let at = Instant::now();
        // SAFETY: for HC_ACTION, lparam points at a KBDLLHOOKSTRUCT for the call's duration.
        let k = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if k.flags.0 & LLKHF_INJECTED.0 == 0 {
            let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            // SAFETY: plain key-state reads.
            let mods = [VK_CONTROL, VK_SHIFT, VK_MENU].iter().any(|v| unsafe { GetAsyncKeyState(i32::from(v.0)) } < 0);
            // A Win down while the key was up is a fresh press (auto-repeat reads "down"): start clean, so a Win up
            // the hook never saw (Win+L, the secure desktop) cannot make the next lone tap look like a combination.
            // SAFETY: a plain key-state read; a low-level hook runs before the state takes this event.
            let fresh = down && notch_core::shortcuts::VK_WINS.contains(&k.vkCode) && unsafe { GetAsyncKeyState(k.vkCode as i32) } >= 0;
            let on = ON.load(Ordering::SeqCst);
            // SAFETY: plain key-state reads.
            let held = |v: VIRTUAL_KEY| unsafe { GetAsyncKeyState(i32::from(v.0)) } < 0;
            let ctrl_only =
                held(VK_CONTROL) && !held(VK_SHIFT) && !held(VK_MENU) && !held(VK_LWIN) && !held(VK_RWIN);
            let (tap, esc) = TAP.with(|t| {
                let mut t = t.borrow_mut();
                if fresh {
                    *t = Default::default();
                }
                (t.key(k.vkCode, down, mods), t.ctrl_esc(k.vkCode, down, ctrl_only, on))
            });
            let key = |vk: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), dwFlags: flags, ..Default::default() } },
            };
            match esc {
                EscKey::Pass => {}
                EscKey::Swallow => return LRESULT(1),
                EscKey::Open => {
                    // Our own input makes Peeka the last input's source, so Start may take the foreground.
                    let mask = [key(VK_MASK, KEYBD_EVENT_FLAGS(0)), key(VK_MASK, KEYEVENTF_KEYUP)];
                    // SAFETY: well-formed keyboard inputs and their size.
                    unsafe { SendInput(&mask, std::mem::size_of::<INPUT>() as i32) };
                    if let Some(tx) = TAPS.get() {
                        let _ = tx.send(at);
                    }
                    return LRESULT(1);
                }
            }
            if tap && on {
                let inputs =
                    [key(VK_MASK, KEYBD_EVENT_FLAGS(0)), key(VK_MASK, KEYEVENTF_KEYUP), key(k.vkCode as u16, KEYEVENTF_KEYUP)];
                // SAFETY: well-formed keyboard inputs and their size. They queue after this event.
                let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
                // Not all in: let the real up through (Windows's Start at worst, never a Win key left held).
                if sent as usize == inputs.len() {
                    if let Some(tx) = TAPS.get() {
                        let _ = tx.send(at);
                    }
                    return LRESULT(1);
                }
            }
        }
    }
    // SAFETY: passing the event on unchanged.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Installs the hook once per process. `on_tap(hook_time)` runs on one worker thread. False = Windows refused it.
#[cfg(windows)]
pub fn start(on_tap: impl Fn(Instant) + Send + 'static) -> bool {
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, SetWindowsHookExW, MSG, WH_KEYBOARD_LL,
    };
    if STARTED.swap(true, Ordering::SeqCst) {
        return true;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = TAPS.set(tx);
    std::thread::spawn(move || {
        for at in rx {
            on_tap(at);
        }
    });
    let (ok_tx, ok_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        // SAFETY: our own module handle; the procedure is a plain function that lives as long as the process.
        let hook = unsafe {
            let module = GetModuleHandleW(None).ok().map(Into::into);
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0)
        };
        let Ok(hook) = hook else {
            let _ = ok_tx.send(false);
            return;
        };
        HOOK.store(hook.0 as isize, Ordering::SeqCst);
        let _ = ok_tx.send(true);
        let mut msg = MSG::default();
        // SAFETY: the message loop a low-level hook needs on the thread that installed it; WM_QUIT ends it.
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            unsafe { DispatchMessageW(&msg) };
        }
        unhook();
    });
    let ok = ok_rx.recv().unwrap_or(false);
    if !ok {
        STARTED.store(false, Ordering::SeqCst);
    }
    ok
}

/// Removes the hook now (any thread, idempotent): exit and the panic hook, so a hung or dying Peeka never holds the
/// keyboard. Lone taps then open Windows's Start again.
#[cfg(windows)]
pub fn unhook() {
    use windows::Win32::UI::WindowsAndMessaging::{UnhookWindowsHookEx, HHOOK};
    let h = HOOK.swap(0, Ordering::SeqCst);
    if h != 0 {
        // SAFETY: the handle SetWindowsHookExW returned, unhooked once (the swap above).
        let _ = unsafe { UnhookWindowsHookEx(HHOOK(h as _)) };
    }
}
