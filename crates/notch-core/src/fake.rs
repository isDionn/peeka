//! In-memory adapters for the ports (fakes live in notch-core). Used by this crate's tests and by
//! `notch-win`'s decision tests; the UI's browser preview gets its own fake backend (the UI agent's).

use std::cell::RefCell;

use crate::apps::RawWindow;
use crate::model::{Monitor, Rect};
use crate::ports::{AppBar, AppControl, Desktop};
use crate::presence::Presence;
use crate::status::Status;

#[derive(Default)]
pub struct FakeAppBar {
    /// Windows moves a proposed rect down by this much (another top AppBar).
    pub push_down: i32,
    pub refuse: bool,
    pub log: RefCell<Vec<String>>,
}

impl AppBar for FakeAppBar {
    fn register(&self, hwnd: isize) -> bool {
        self.log.borrow_mut().push(format!("new {hwnd}"));
        !self.refuse
    }
    fn query_pos(&self, hwnd: isize, proposed: Rect) -> Option<Rect> {
        self.log.borrow_mut().push(format!("query {hwnd}"));
        Some(Rect { top: proposed.top + self.push_down, bottom: proposed.bottom + self.push_down, ..proposed })
    }
    fn set_pos(&self, hwnd: isize, rect: Rect) -> Option<Rect> {
        self.log.borrow_mut().push(format!("set {hwnd}"));
        Some(rect)
    }
    fn remove(&self, hwnd: isize) {
        self.log.borrow_mut().push(format!("remove {hwnd}"));
    }
}

pub struct FakeDesktop {
    pub monitors: Vec<Monitor>,
    pub windows: Vec<RawWindow>,
    pub status: Status,
    pub presence: Presence,
    pub foreground_covers: bool,
}

impl Default for FakeDesktop {
    fn default() -> Self {
        Self {
            monitors: vec![],
            windows: vec![],
            status: Status::default(),
            presence: Presence::Normal,
            foreground_covers: false,
        }
    }
}

impl Desktop for FakeDesktop {
    fn monitors(&self) -> Vec<Monitor> {
        self.monitors.clone()
    }
    fn windows(&self) -> Vec<RawWindow> {
        self.windows.clone()
    }
    fn status(&self) -> Status {
        self.status.clone()
    }
    fn presence(&self) -> Presence {
        self.presence
    }
    fn foreground_covers(&self) -> bool {
        self.foreground_covers
    }
}

#[derive(Default)]
pub struct FakeAppControl {
    pub log: RefCell<Vec<String>>,
}

impl AppControl for FakeAppControl {
    fn launch(&self, target: &str) -> bool {
        self.log.borrow_mut().push(format!("launch {target}"));
        true
    }
    fn focus(&self, hwnd: isize) -> bool {
        self.log.borrow_mut().push(format!("focus {hwnd}"));
        true
    }
    fn close(&self, hwnd: isize) -> bool {
        self.log.borrow_mut().push(format!("close {hwnd}"));
        true
    }
}
