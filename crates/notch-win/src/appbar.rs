//! Each strip window is an AppBar on its monitor's top edge: `ABM_NEW`, `ABM_QUERYPOS`,
//! `ABM_SETPOS`, `ABM_REMOVE`. The decision (register, query, keep our height, set) is `notch_core::ports::reserve`,
//! tested there with `FakeAppBar`.
//! TODO: `ABN_POSCHANGED` / `ABN_FULLSCREENAPP` arrive as `CALLBACK_MSG` on the strip window; listening needs a
//! window subclass (`SetWindowSubclass`). Until then the app re-reserves on monitor changes and fullscreen comes from
//! `presence` + `foreground_covers` polling. Not gated on Wave 0.

use notch_core::model::Rect;
use notch_core::ports::AppBar;

/// `WM_APP + 0x4E`: the message Explorer posts to a strip for `ABN_*` notifications.
pub const CALLBACK_MSG: u32 = 0x8000 + 0x4E;

/// Remembers which strips are registered: `ABM_NEW` answers FALSE both for "refused" and "already registered".
#[derive(Default)]
pub struct Win32AppBar {
    registered: parking_lot::Mutex<Vec<isize>>,
}

impl Win32AppBar {
    /// Every strip this process registered (for the exit path's `ABM_REMOVE` and the marker).
    pub fn handles(&self) -> Vec<isize> {
        self.registered.lock().clone()
    }

    /// Explorer restarted and dropped every AppBar: the next `register` sends `ABM_NEW` again.
    pub fn forget(&self) {
        self.registered.lock().clear();
    }
}

/// Track a registration: true = this handle is (now) registered.
fn track(list: &mut Vec<isize>, hwnd: isize, register: impl FnOnce() -> bool) -> bool {
    if list.contains(&hwnd) {
        return true;
    }
    let ok = register();
    if ok {
        list.push(hwnd);
    }
    ok
}

#[cfg(windows)]
mod sys {
    use notch_core::model::Rect;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::Shell::{SHAppBarMessage, ABE_TOP, APPBARDATA};

    pub fn send(msg: u32, hwnd: isize, rect: Option<Rect>, callback: u32) -> (usize, Rect) {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: HWND(hwnd as _),
            uCallbackMessage: callback,
            uEdge: ABE_TOP,
            ..Default::default()
        };
        if let Some(r) = rect {
            data.rc = RECT { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
        // SAFETY: a fully initialised APPBARDATA with its own size; `hwnd` is a strip window of this process.
        let answer = unsafe { SHAppBarMessage(msg, &mut data) };
        (answer, Rect { left: data.rc.left, top: data.rc.top, right: data.rc.right, bottom: data.rc.bottom })
    }
}

#[cfg(windows)]
impl AppBar for Win32AppBar {
    fn register(&self, hwnd: isize) -> bool {
        use windows::Win32::UI::Shell::ABM_NEW;
        track(&mut self.registered.lock(), hwnd, || sys::send(ABM_NEW, hwnd, None, CALLBACK_MSG).0 != 0)
    }
    fn query_pos(&self, hwnd: isize, proposed: Rect) -> Option<Rect> {
        use windows::Win32::UI::Shell::ABM_QUERYPOS;
        Some(sys::send(ABM_QUERYPOS, hwnd, Some(proposed), 0).1)
    }
    fn set_pos(&self, hwnd: isize, rect: Rect) -> Option<Rect> {
        use windows::Win32::UI::Shell::ABM_SETPOS;
        Some(sys::send(ABM_SETPOS, hwnd, Some(rect), 0).1)
    }
    fn remove(&self, hwnd: isize) {
        use windows::Win32::UI::Shell::ABM_REMOVE;
        sys::send(ABM_REMOVE, hwnd, None, 0);
        self.registered.lock().retain(|&h| h != hwnd);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_register_is_not_sent_and_a_refusal_is_not_tracked() {
        let mut list = vec![];
        assert!(track(&mut list, 7, || true));
        assert!(track(&mut list, 7, || panic!("already registered: ABM_NEW would answer FALSE")));
        assert!(!track(&mut list, 8, || false));
        assert_eq!(list, [7]);
    }
}
