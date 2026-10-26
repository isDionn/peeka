//! Ports: what Notch asks of Windows. `notch-win` implements them, `fake` has in-memory versions for tests.
//! The taskbar's port (`Shell`) lives in `taskbar` beside the logic that uses it.

use crate::apps::RawWindow;
use crate::model::{strip_rect, Monitor, Rect};
use crate::presence::Presence;
use crate::status::Status;

/// Read-only views of the desktop.
pub trait Desktop {
    /// Every monitor, sorted (`model::sort_monitors`); empty if Windows cannot say.
    fn monitors(&self) -> Vec<Monitor>;
    /// Top-level windows in Z-order, unfiltered (`apps::merge` filters).
    fn windows(&self) -> Vec<RawWindow>;
    fn status(&self) -> Status;
    fn presence(&self) -> Presence;
    /// The foreground window covers its whole monitor.
    fn foreground_covers(&self) -> bool;
}

/// The owner's own actions on apps. Only ever called with an id or window Notch itself listed.
pub trait AppControl {
    /// `ShellExecute` of `apps::launch_target`; false = Windows refused.
    fn launch(&self, target: &str) -> bool;
    /// `ShellExecute` of a file with arguments (`apps::split_command` of a relaunch command); false = Windows refused.
    fn run(&self, file: &str, args: &str) -> bool;
    /// Restore if minimised, then bring to front.
    fn focus(&self, hwnd: isize) -> bool;
    /// `WM_CLOSE` (the app may still ask to save).
    fn close(&self, hwnd: isize) -> bool;
}

/// `SHAppBarMessage` for one strip window, top edge only.
pub trait AppBar {
    /// `ABM_NEW`; false = refused (already registered counts as true).
    fn register(&self, hwnd: isize) -> bool;
    /// `ABM_QUERYPOS`: Windows may move the proposed rect (another AppBar on the same edge).
    fn query_pos(&self, hwnd: isize, proposed: Rect) -> Option<Rect>;
    /// `ABM_SETPOS`: the rect Windows finally reserved.
    fn set_pos(&self, hwnd: isize, rect: Rect) -> Option<Rect>;
    /// `ABM_REMOVE`.
    fn remove(&self, hwnd: isize);
}

/// Register `hwnd` as the strip of `m` and reserve its 30 px. Windows answers QUERYPOS with a rect whose top may have
/// moved down (another top AppBar); the strip keeps its own height from that top. Returns where the strip window
/// must go, None = no reservation (the strip still shows, maximised windows then start under it - harmless).
pub fn reserve(port: &dyn AppBar, hwnd: isize, m: &Monitor) -> Option<Rect> {
    let want = strip_rect(m);
    if !port.register(hwnd) {
        return None;
    }
    let mut got = port.query_pos(hwnd, want)?;
    got.bottom = got.top + want.height();
    port.set_pos(hwnd, got)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake::FakeAppBar;

    fn monitor() -> Monitor {
        let rect = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };
        Monitor { index: 0, rect, work: rect, scale: 1.25, primary: true, hz: 144 }
    }

    #[test]
    fn reserve_registers_queries_and_sets_the_strip_height() {
        let port = FakeAppBar::default();
        let r = reserve(&port, 7, &monitor()).unwrap();
        assert_eq!(r, Rect { left: 0, top: 0, right: 1920, bottom: 38 });
        assert_eq!(*port.log.borrow(), ["new 7", "query 7", "set 7"]);
    }

    #[test]
    fn another_top_appbar_pushes_the_strip_down_but_keeps_its_height() {
        let port = FakeAppBar { push_down: 40, ..Default::default() };
        let r = reserve(&port, 7, &monitor()).unwrap();
        assert_eq!((r.top, r.bottom), (40, 78));
    }

    #[test]
    fn a_refused_registration_reserves_nothing() {
        let port = FakeAppBar { refuse: true, ..Default::default() };
        assert_eq!(reserve(&port, 7, &monitor()), None);
        assert_eq!(*port.log.borrow(), ["new 7"]);
    }
}
