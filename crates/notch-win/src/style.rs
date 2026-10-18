//! Raw window bits Tauri does not expose: `WS_EX_NOACTIVATE` (strip and island never steal the focus)
//! and the cursor position for the island's click-through poll.

/// The extended style with `WS_EX_NOACTIVATE` added.
pub fn with_no_activate(ex_style: isize) -> isize {
    ex_style | notch_core::apps::WS_EX_NOACTIVATE as isize
}

/// Adds `WS_EX_NOACTIVATE` to a window of this process. Whether a click on WebView2 still activates it is
/// unverified (Wave 0 test 7).
#[cfg(windows)]
pub fn no_activate(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE};
    let h = HWND(hwnd as _);
    // SAFETY: a top-level window this process just built; only the extended style is changed.
    unsafe {
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, with_no_activate(ex));
    }
}

/// The extended style with `WS_EX_TOOLWINDOW` on and `WS_EX_APPWINDOW` off (no taskbar button, no Alt+Tab entry).
pub fn with_tool_window(ex_style: u32) -> u32 {
    (ex_style | notch_core::apps::WS_EX_TOOLWINDOW) & !notch_core::apps::WS_EX_APPWINDOW
}

/// Keeps `WS_EX_TOOLWINDOW` on a window of this process for good. tao rebuilds the whole extended style from its own
/// flags on every change (`set_ignore_cursor_events`, show...; the first run measured `WS_EX_APPWINDOW` and no tool
/// bit on every window), so a one-time `SetWindowLongPtr` is wiped: the subclass corrects each `WM_STYLECHANGING`.
/// Call on the window's own thread, once per window.
#[cfg(windows)]
pub fn tool_window(hwnd: isize) {
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, STYLESTRUCT, WM_STYLECHANGING};
    unsafe extern "system" fn proc_(h: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if msg == WM_STYLECHANGING && wparam.0 as i32 == GWL_EXSTYLE.0 {
            // SAFETY: for WM_STYLECHANGING, lParam points at a STYLESTRUCT owned by Windows for this call.
            let ss = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
            ss.styleNew = with_tool_window(ss.styleNew);
        }
        // SAFETY: forwarding the same message down the chain.
        unsafe { DefSubclassProc(h, msg, wparam, lparam) }
    }
    let h = HWND(hwnd as _);
    // SAFETY: a live top-level window of this thread; `proc_` is a plain fn with no data behind it. The set call
    // right after runs the subclass once, so the style is right even if nothing else changes it.
    unsafe {
        let _ = SetWindowSubclass(h, Some(proc_), 0x4E54_4F4C, 0);
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, with_tool_window(ex as u32) as isize | (ex & !0xFFFF_FFFF));
    }
}

/// The window that may take the keyboard focus right now (0 = none): a panel that needs typing (Search, the composer)
/// is "typing" only while open; every other press on a strip leaves the user's app in front.
static TYPING: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
/// The user's window that was in front when typing began; the focus goes back to it when typing ends.
static PREV: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// Where the focus goes back to when typing ends: `prev` only if Notch's window still holds it (the user did not
/// move on by themselves) and `prev` is a real, other window.
pub fn give_back(prev: isize, fg: isize, hwnd: isize, prev_alive: bool) -> Option<isize> {
    (fg == hwnd && prev != 0 && prev != hwnd && prev_alive).then_some(prev)
}

/// Typing starts in `hwnd`: remembers the window in front (unless it is a Notch window: the earlier one stays) and
/// lets `hwnd` be activated.
pub fn typing_begin(hwnd: isize, fg: isize, fg_is_ours: bool) {
    use std::sync::atomic::Ordering::SeqCst;
    if !fg_is_ours {
        PREV.store(fg, SeqCst);
    }
    TYPING.store(hwnd, SeqCst);
}

/// Typing ended in `hwnd`: activation is refused again; returns the window to hand the focus back to, if any.
pub fn typing_end(hwnd: isize, fg: isize, prev_alive: impl Fn(isize) -> bool) -> Option<isize> {
    use std::sync::atomic::Ordering::SeqCst;
    if TYPING.compare_exchange(hwnd, 0, SeqCst, SeqCst).is_err() {
        return None; // another window took over typing meanwhile
    }
    let prev = PREV.swap(0, SeqCst);
    give_back(prev, fg, hwnd, prev_alive(prev))
}

/// The island's window (0 = not built yet). A press activates a strip, and Windows then lifts it to the top of the
/// always-on-top band, over the island: VM run 2 saw the island's clock vanish behind the strip's bar after the
/// first click (rewriting `WM_WINDOWPOSCHANGING`'s insert-after did not stop it). After a strip's z-order changed,
/// the island is put back on top.
static ISLAND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// Remembers the island's window for [`strip_no_activate`]'s z-order rule.
pub fn set_island(hwnd: isize) {
    ISLAND.store(hwnd, std::sync::atomic::Ordering::SeqCst);
}

/// The island to lift back over a window whose z-order just changed: not the island itself, not before it exists.
pub fn island_to_lift(z_changed: bool, island: isize, me: isize) -> Option<isize> {
    (z_changed && island != 0 && island != me).then_some(island)
}

/// A Notch window needs lifting when a visible window that is not always-on-top sits above it. `above` = (visible,
/// topmost) of each window above it, nearest first. Another always-on-top app is left alone (no tug of war).
pub fn covered(mut above: impl Iterator<Item = (bool, bool)>) -> bool {
    above.any(|(visible, topmost)| visible && !topmost)
}

/// The order to lift Notch's windows in: the island last, so it stays over the strips.
pub fn lift_order(mut ours: Vec<isize>, island: isize) -> Vec<isize> {
    ours.sort_by_key(|&h| h == island);
    ours
}

/// Windows 11 Paint and Terminal put themselves over always-on-top windows when they come to the front, without
/// being always-on-top themselves (VM run 3: `MSPaintApp` / `CASCADIA_HOSTING_WINDOW_CLASS` above both Notch windows,
/// `WS_EX_TOPMOST` still set on ours, same z-band; Notepad stays under). Notch's visible always-on-top windows are put
/// back on top, only when a plain window is above one. Never over a fullscreen app: its strip hides instead (`ticks`).
/// Any thread (the move is asynchronous).
#[cfg(windows)]
pub fn keep_on_top() {
    use std::sync::atomic::Ordering::SeqCst;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongW, GetWindowThreadProcessId, IsWindowVisible, SetWindowPos, GWL_EXSTYLE,
        GW_HWNDPREV, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_TOPMOST,
    };
    unsafe extern "system" fn mine(h: HWND, out: LPARAM) -> BOOL {
        // SAFETY: `out` is the Vec below, alive for the whole EnumWindows call; plain handle queries.
        unsafe {
            let mut pid = 0;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == GetCurrentProcessId() && IsWindowVisible(h).as_bool() && topmost(h) {
                (*(out.0 as *mut Vec<isize>)).push(h.0 as isize);
            }
        }
        BOOL(1)
    }
    unsafe fn topmost(h: HWND) -> bool {
        // SAFETY: a style query; a stale handle gives 0.
        unsafe { GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 }
    }
    if crate::apps::foreground_covers() {
        return;
    }
    let mut ours: Vec<isize> = vec![];
    // SAFETY: the callback only pushes into `ours`, which outlives the call.
    unsafe {
        let _ = EnumWindows(Some(mine), LPARAM(&mut ours as *mut Vec<isize> as isize));
    }
    let island = ISLAND.load(SeqCst);
    let mut lifted = false;
    for h in lift_order(ours, island) {
        // SAFETY (block): z-order walk and an asynchronous no-activate move of our own window.
        unsafe {
            let above = std::iter::successors(GetWindow(HWND(h as _), GW_HWNDPREV).ok(), |w| GetWindow(*w, GW_HWNDPREV).ok())
                .map(|w| (IsWindowVisible(w).as_bool(), topmost(w)));
            if covered(above) || (lifted && h == island) {
                let _ = SetWindowPos(HWND(h as _), Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
                lifted = true;
            }
        }
    }
}

/// Where the focus goes back when no other app has come to the front since Notch started (`last_other` = 0): the
/// desktop (`GetShellWindow`), as when the last window closes. Keeping it would leave keys going into Notch's page.
pub fn or_desktop(last_other: isize, shell: isize) -> isize {
    if last_other == 0 { shell } else { last_other }
}

/// The window to hand the focus back to after a press activated `hwnd`: the last other app in front, if it is a
/// real other window and Notch's window is still in front (the user did not move on by themselves).
pub fn after_press(before: isize, fg: isize, hwnd: isize, typing: bool, before_alive: bool) -> Option<isize> {
    (!typing).then_some(()).and(give_back(before, fg, hwnd, before_alive))
}

/// A press on a strip or the island leaves the user's app in front unless the window is the typing one. Refusing the
/// activation (`MA_NOACTIVATE`) is not an option: VM run 2 measured that WebView2 then drops the click (no panel
/// opened) and activates the window anyway; `WM_MOUSEACTIVATE` does not even reach this window (WebView2's child
/// answers it), and `WM_ACTIVATE`'s lparam is null when the other window belongs to another process. So the press
/// activates as usual and, once it is through (a short timer: handing the focus back inside `WM_ACTIVATE` would
/// cancel the click), the focus goes back to the last other app in front (`foreground::last_other`). Call on the
/// window's own thread, once.
#[cfg(windows)]
pub fn strip_no_activate(hwnd: isize) {
    use std::sync::atomic::Ordering::SeqCst;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetShellWindow, IsWindow, KillTimer, SetForegroundWindow, SetTimer, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINDOWPOS, WM_ACTIVATE, WM_TIMER, WM_WINDOWPOSCHANGED,
    };
    const GIVE_BACK_TIMER: usize = 0x4E42;
    unsafe extern "system" fn proc_(h: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        let typing = TYPING.load(SeqCst) == h.0 as isize;
        // SAFETY (whole block): plain handle queries and requests; a stale handle is refused by Windows.
        unsafe {
            if msg == WM_ACTIVATE && wparam.0 & 0xFFFF == 0 {
                let _ = TYPING.compare_exchange(h.0 as isize, 0, SeqCst, SeqCst); // focus left: the typing session is over
            }
            if msg == WM_WINDOWPOSCHANGED {
                // SAFETY: for WM_WINDOWPOSCHANGED, lParam points at a WINDOWPOS owned by Windows for this call.
                let wp = &*(lparam.0 as *const WINDOWPOS);
                if let Some(i) = island_to_lift(wp.flags.0 & SWP_NOZORDER.0 == 0, ISLAND.load(SeqCst), h.0 as isize) {
                    let _ = SetWindowPos(HWND(i as _), Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
            }
            if msg == WM_ACTIVATE && wparam.0 & 0xFFFF != 0 && !typing {
                SetTimer(Some(h), GIVE_BACK_TIMER, 200, None);
            }
            if msg == WM_TIMER && wparam.0 == GIVE_BACK_TIMER {
                if crate::style::mouse_down() {
                    return LRESULT(0); // still pressed (a drag, a long press): the timer comes round again
                }
                let _ = KillTimer(Some(h), GIVE_BACK_TIMER);
                let before = or_desktop(crate::foreground::last_other(), GetShellWindow().0 as isize);
                let alive = IsWindow(Some(HWND(before as _))).as_bool();
                if let Some(b) = after_press(before, GetForegroundWindow().0 as isize, h.0 as isize, typing, alive) {
                    let _ = SetForegroundWindow(HWND(b as _));
                }
                return LRESULT(0);
            }
            DefSubclassProc(h, msg, wparam, lparam)
        }
    }
    // SAFETY: a live top-level window of this thread; `proc_` is a plain fn with no data behind it.
    unsafe {
        let _ = SetWindowSubclass(HWND(hwnd as _), Some(proc_), 0x4E4E_4143, 0);
    }
}

/// Typing begins in `hwnd`: the window gets the focus (it may, from now on).
#[cfg(windows)]
pub fn typing_focus_in(hwnd: isize, ours: impl Fn(isize) -> bool) {
    let fg = crate::apps::foreground();
    // The press that opened the panel may already have put Notch in front: the window from before the press counts.
    // SAFETY: a plain handle query.
    let shell = unsafe { windows::Win32::UI::WindowsAndMessaging::GetShellWindow() }.0 as isize;
    let fg = if ours(fg) { or_desktop(crate::foreground::last_other(), shell) } else { fg };
    typing_begin(hwnd, fg, fg == 0 || ours(fg));
}

/// Typing ends in `hwnd`: the window that was in front before gets the focus back.
#[cfg(windows)]
pub fn typing_focus_out(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
    // SAFETY: handle queries and one foreground request.
    let back = typing_end(hwnd, crate::apps::foreground(), |p| unsafe { IsWindow(Some(HWND(p as _))).as_bool() });
    if let Some(p) = back {
        unsafe { let _ = SetForegroundWindow(HWND(p as _)); }
    }
}

/// Clips the window to the union of `boxes` (`(left, top, right, bottom)` physical px, window-relative); an empty
/// list clips everything. What lies outside neither paints nor takes the mouse, whatever the page does.
#[cfg(windows)]
pub fn set_region(hwnd: isize, boxes: &[(i32, i32, i32, i32)]) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ, RGN_OR};
    // SAFETY: GDI regions we create and either hand to the window (which then owns `whole`) or delete.
    unsafe {
        let whole = CreateRectRgn(0, 0, 0, 0);
        for &(l, t, r, b) in boxes {
            let one = CreateRectRgn(l, t, r, b);
            CombineRgn(Some(whole), Some(whole), Some(one), RGN_OR);
            let _ = DeleteObject(HGDIOBJ(one.0));
        }
        if SetWindowRgn(HWND(hwnd as _), Some(whole), true) == 0 {
            let _ = DeleteObject(HGDIOBJ(whole.0));
        }
    }
}

/// Physical px on the virtual screen; None = Windows would not say (secure desktop).
#[cfg(windows)]
pub fn cursor() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    // SAFETY: an out-param we own.
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x, p.y))
}

/// A mouse button (left, right, middle) is held right now, anywhere on the desktop.
#[cfg(windows)]
pub fn mouse_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
    // SAFETY: plain key-state reads; the high bit = held now.
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|k| unsafe { GetAsyncKeyState(i32::from(k.0)) } as u16 & 0x8000 != 0)
}

/// Esc is held right now (the mascot drag's cancel; read anywhere, no focus needed).
#[cfg(windows)]
pub fn esc_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
    // SAFETY: a plain key-state read; the high bit = held now.
    unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE.0)) as u16 & 0x8000 != 0 }
}

/// The top-level window under a screen point (window regions respected: a strip's clipped-away area is not it).
#[cfg(windows)]
pub fn root_at(x: i32, y: i32) -> isize {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};
    // SAFETY: value arguments only; a null result passes through as 0.
    unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT).0 as isize }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_window_is_added_and_appwindow_removed() {
        assert_eq!(with_tool_window(0x4_0118), 0x198);
        assert_eq!(with_tool_window(0x80), 0x80);
    }

    #[test]
    fn the_island_is_lifted_back_over_a_raised_strip() {
        assert_eq!(island_to_lift(true, 5, 9), Some(5));
        assert_eq!(island_to_lift(false, 5, 9), None, "a move or resize only");
        assert_eq!(island_to_lift(true, 5, 5), None, "the island itself");
        assert_eq!(island_to_lift(true, 0, 9), None, "no island yet");
    }

    #[test]
    fn notch_is_lifted_only_under_a_plain_window_and_the_island_goes_last() {
        assert!(covered([(true, true), (true, false)].into_iter()), "Paint above, not always-on-top");
        assert!(!covered([(true, true), (false, false)].into_iter()), "another always-on-top app, a hidden window");
        assert!(!covered(std::iter::empty()), "already at the top");
        assert_eq!(lift_order(vec![5, 1, 2], 5), vec![1, 2, 5]);
        assert_eq!(lift_order(vec![1, 2], 0), vec![1, 2], "no island yet");
    }

    #[test]
    fn with_no_other_app_yet_the_focus_goes_to_the_desktop() {
        assert_eq!(or_desktop(0, 3), 3);
        assert_eq!(or_desktop(7, 3), 7);
        assert_eq!(after_press(or_desktop(0, 3), 9, 9, false, true), Some(3), "the first press after start");
    }

    #[test]
    fn a_press_hands_the_focus_back_unless_typing() {
        assert_eq!(after_press(7, 9, 9, false, true), Some(7));
        assert_eq!(after_press(7, 9, 9, true, true), None, "Search or the composer opened: it keeps the focus");
        assert_eq!(after_press(0, 9, 9, false, true), None, "one of ours was in front");
        assert_eq!(after_press(7, 5, 9, false, true), None, "the user moved on");
    }

    #[test]
    fn focus_goes_back_only_to_a_live_other_window_while_we_still_hold_it() {
        assert_eq!(give_back(7, 9, 9, true), Some(7));
        assert_eq!(give_back(7, 5, 9, true), None, "the user moved on by themselves");
        assert_eq!(give_back(0, 9, 9, true), None, "nothing was in front before");
        assert_eq!(give_back(9, 9, 9, true), None);
        assert_eq!(give_back(7, 9, 9, false), None, "the old window is gone");
    }

    #[test]
    fn typing_remembers_the_first_outside_window_and_ends_once() {
        typing_begin(9, 7, false);
        typing_begin(9, 9, true); // a Notch window in front: the user's window stays remembered
        assert_eq!(typing_end(8, 9, |_| true), None, "someone else's typing session");
        assert_eq!(typing_end(9, 9, |_| true), Some(7));
        assert_eq!(typing_end(9, 9, |_| true), None, "already ended");
    }

    #[test]
    fn no_activate_is_added_and_other_bits_kept() {
        assert_eq!(with_no_activate(0x80), 0x0800_0080);
        assert_eq!(with_no_activate(0x0800_0000), 0x0800_0000);
    }
}
