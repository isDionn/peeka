// Peeka — original implementation (MIT).
//! The daily update check (rules: `notch_core::update`, request: `notch_win::update`). One GET of GitHub's latest
//! release, first ~1 min after start and then whenever a day has passed since the last ask (kept in `update.json`, so
//! restarts do not ask again). When a newer version exists that was not dismissed, `update_available {version}` goes
//! to the page; the release page's address stays here and "Download" opens it. Off with `updateCheck`; silent offline.

use std::{path::PathBuf, thread, time::Duration};

use notch_core::ports::AppControl;
use notch_core::update::{self, State as Saved};
use notch_win::apps::Win32Control;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Notch;

#[derive(Default)]
pub struct State {
    /// The last announced release; `update_open` opens its page and `update_dismiss` remembers its version (the page
    /// sends neither).
    last: Mutex<Option<update::Release>>,
}

fn file() -> Option<PathBuf> {
    notch_core::data_dir().map(|d| d.join("update.json"))
}

fn load() -> Saved {
    file().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(s: &Saved) {
    if let (Some(p), Ok(t)) = (file(), serde_json::to_string(s)) {
        let _ = std::fs::write(p, t);
    }
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

pub fn start(app: &AppHandle) {
    app.manage(State::default());
    // a build without an update channel (brand `updates_url: null`) never asks
    if crate::app::demo() || notch_core::brand::UPDATES_URL.is_none() {
        return;
    }
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(60));
        loop {
            check(&handle);
            thread::sleep(Duration::from_secs(3600)); // the saved time keeps the real cadence at one ask a day
        }
    });
}

fn check(app: &AppHandle) {
    let (Some(n), Some(s)) = (app.try_state::<Notch>(), app.try_state::<State>()) else { return };
    let mut saved = load();
    if !n.settings.lock().update_check || !update::due(saved.last_check, now_s()) {
        return;
    }
    saved.last_check = now_s(); // an offline try also waits a day: a quiet, rare request beats a retry loop
    save(&saved);
    let Some(body) = notch_win::update::get("api.github.com", "/repos/isDionn/peeka/releases/latest", &format!("Peeka/{}", app.package_info().version)) else { return };
    if let Some(r) = update::notice(&body, &app.package_info().version.to_string(), &saved.dismissed) {
        let _ = app.emit("update_available", &r.version);
        *s.last.lock() = Some(r);
    }
}

/// "Download" on the notice: the remembered release page in the default browser.
pub fn open(app: &AppHandle) -> bool {
    let url = app.try_state::<State>().and_then(|s| s.last.lock().as_ref().map(|r| r.url.clone()));
    url.is_some_and(|u| Win32Control.launch(&u))
}

/// Remembers the announced version as dismissed so it is not announced again.
pub fn dismiss(app: &AppHandle) {
    let Some(r) = app.try_state::<State>().and_then(|s| s.last.lock().clone()) else { return };
    let mut saved = load();
    saved.dismissed = r.version;
    save(&saved);
}
