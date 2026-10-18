//! Weekly recap (F8): Peeka's own records (agent hook events, edits, approval answers, new clipboard items) counted
//! into `notch_core::recap`. Only the counts are saved (`<data>/recap.json`); demo mode keeps them in memory.

use notch_core::recap::{self, Ev, Recap};
use parking_lot::Mutex;
use tauri::{AppHandle, Manager};

pub struct RecapState(pub Mutex<Recap>);

pub fn start(app: &AppHandle, data_dir: &std::path::Path) {
    // Demo: a fresh, in-memory recap (the owner's file is not even read).
    let r = if crate::app::demo() { Recap::default() } else { recap::load(&recap::path(data_dir)) };
    app.manage(RecapState(Mutex::new(r)));
}

/// Today, local days since 1970-01-01.
pub fn today() -> i64 {
    let (y, m, d) = notch_win::local_date();
    recap::day_of(y, m, d)
}

pub fn count(app: &AppHandle, ev: Ev) {
    let Some(s) = app.try_state::<RecapState>() else { return };
    let mut r = s.0.lock();
    if r.add(ev, today(), crate::live::now_ms()) {
        save(app, &r);
    }
}

pub fn save(app: &AppHandle, r: &Recap) {
    if crate::app::demo() {
        return;
    }
    if let Some(n) = app.try_state::<crate::app::Notch>() {
        let _ = recap::save(&recap::path(&n.data_dir), r);
    }
}
