//! The clipboard's Tauri half (Wave 4): the Windows listener feeds `notch_core::clip::ClipHistory`, each change goes
//! out as `clip_changed` (`wave4-api.ts` `ClipChange`; a password row is left out while hidden), and the plugin
//! host's `clipboard.read` source is refreshed. Every rule lives in `notch_core::clip`; this file moves data. It
//! never logs an item's content.

use notch_core::clip::{Change, ClipHistory};
use notch_core::presence::Presence;
use notch_win::dpapi::Dpapi;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Notch;
use crate::live::now_ms;

pub struct ClipState {
    pub clip_history: Mutex<ClipHistory>,
}

/// Where `clip_open` / `clip_to_shelf` copy an image (a screenshot may be private: both are emptied at every start,
/// the shelf is session-only anyway).
pub fn temp_open() -> std::path::PathBuf {
    std::env::temp_dir().join("notch-open")
}

pub fn temp_shelf() -> std::path::PathBuf {
    std::env::temp_dir().join("notch-shelf")
}

pub fn start(app: &AppHandle, data_dir: std::path::PathBuf) {
    let _ = std::fs::remove_dir_all(temp_open());
    let _ = std::fs::remove_dir_all(temp_shelf());
    let _ = std::fs::remove_dir_all(std::env::temp_dir().join("notch-raf")); // the old (Turkish) name of temp_shelf
    let cfg = app.try_state::<Notch>().map(|n| n.settings.lock().clip_config()).unwrap_or_default();
    // Demo: an empty in-memory clipboard (the owner's pinned items are not even read).
    let clip_history =
        if crate::app::demo() { ClipHistory::demo(data_dir, cfg) } else { ClipHistory::load(data_dir, cfg, now_ms()) };
    app.manage(ClipState { clip_history: Mutex::new(clip_history) });
    refresh_plugins(app);
    let handle = app.clone();
    if !notch_win::clipboard::listen(move |copied| {
        let locked = crate::plugins::locked(&handle);
        let changes = match handle.try_state::<ClipState>() {
            Some(p) => p.clip_history.lock().capture(copied, locked, now_ms(), &Dpapi),
            None => return,
        };
        emit(&handle, changes);
    }) {
        crate::app::notice(app, "Cannot listen to the clipboard; the clipboard history will stay empty.");
    }
}

/// Password rows stay out of the list and the events while Notch is locked, and (a heuristic) while
/// Windows is in presentation or busy mode, or the screen is being shared or recorded.
pub fn hide_passwords(app: &AppHandle) -> bool {
    let presence = app.try_state::<Notch>().map(|n| n.attention.lock().presence).unwrap_or_default();
    crate::plugins::locked(app)
        || matches!(presence, Presence::Presentation | Presence::Busy)
        || crate::extras::sharing(app)
}

/// `clipboard.read`'s source (never a password item: `ClipHistory::plugin_items`).
fn refresh_plugins(app: &AppHandle) {
    let (Some(p), Some(pl)) = (app.try_state::<ClipState>(), app.try_state::<crate::plugins::Plugins>()) else {
        return;
    };
    let items = p.clip_history.lock().plugin_items();
    pl.host.lock().clipboard = items;
}

pub fn emit(app: &AppHandle, changes: Vec<Change>) {
    if changes.is_empty() {
        return;
    }
    if changes.iter().any(|c| c.reason == "added") {
        crate::recap::count(app, notch_core::recap::Ev::Clip);
    }
    let hide = hide_passwords(app);
    for c in changes {
        let _ = app.emit("clip_changed", c.hiding_passwords(hide));
    }
    refresh_plugins(app);
}

/// The 1 s tick: password expiry (the slot is zeroed in the file) and the 24 h limit.
pub fn tick(app: &AppHandle) {
    let changes = match app.try_state::<ClipState>() {
        Some(p) => p.clip_history.lock().tick(now_ms()),
        None => return,
    };
    emit(app, changes);
}

/// Settings › Clipboard changed.
pub fn configure(app: &AppHandle, cfg: notch_core::clip::Config) {
    let changes = match app.try_state::<ClipState>() {
        Some(p) => p.clip_history.lock().set_config(cfg, now_ms()),
        None => return,
    };
    emit(app, changes);
}
