//! The pano's Tauri half (Wave 4): the Windows listener feeds `notch_core::clip::Pano`, each change goes
//! out as `clip_changed` (`wave4-api.ts` `ClipChange`; a password row is left out while hidden), and the plugin
//! host's `clipboard.read` source is refreshed. Every rule lives in `notch_core::clip`; this file moves data. It
//! never logs an item's content.

use notch_core::clip::{Change, Pano};
use notch_core::presence::Presence;
use notch_win::dpapi::Dpapi;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Notch;
use crate::live::now_ms;

pub struct PanoState {
    pub pano: Mutex<Pano>,
}

/// Where `clip_open` / `clip_to_shelf` copy an image (a screenshot may be private: both are emptied at every start,
/// the shelf is session-only anyway).
pub fn temp_open() -> std::path::PathBuf {
    std::env::temp_dir().join("notch-open")
}

pub fn temp_shelf() -> std::path::PathBuf {
    std::env::temp_dir().join("notch-raf")
}

pub fn start(app: &AppHandle, data_dir: std::path::PathBuf) {
    let _ = std::fs::remove_dir_all(temp_open());
    let _ = std::fs::remove_dir_all(temp_shelf());
    let cfg = app.try_state::<Notch>().map(|n| n.settings.lock().clip_config()).unwrap_or_default();
    // Demo: an empty in-memory pano (the owner's pinned items are not even read).
    let pano = if crate::app::demo() { Pano::demo(data_dir, cfg) } else { Pano::load(data_dir, cfg, now_ms()) };
    app.manage(PanoState { pano: Mutex::new(pano) });
    refresh_plugins(app);
    let handle = app.clone();
    if !notch_win::clipboard::listen(move |copied| {
        let locked = crate::plugins::locked(&handle);
        let changes = match handle.try_state::<PanoState>() {
            Some(p) => p.pano.lock().capture(copied, locked, now_ms(), &Dpapi),
            None => return,
        };
        emit(&handle, changes);
    }) {
        crate::app::notice(app, "Pano dinlenemiyor; pano geçmişi boş kalacak.");
    }
}

/// Password rows stay out of the list and the events while Notch is locked, and (a heuristic) while
/// Windows is in presentation or busy mode.
pub fn hide_passwords(app: &AppHandle) -> bool {
    let presence = app.try_state::<Notch>().map(|n| n.attention.lock().presence).unwrap_or_default();
    crate::plugins::locked(app) || matches!(presence, Presence::Presentation | Presence::Busy)
}

/// `clipboard.read`'s source (never a password item: `Pano::plugin_items`).
fn refresh_plugins(app: &AppHandle) {
    let (Some(p), Some(pl)) = (app.try_state::<PanoState>(), app.try_state::<crate::plugins::Plugins>()) else {
        return;
    };
    let items = p.pano.lock().plugin_items();
    pl.host.lock().clipboard = items;
}

pub fn emit(app: &AppHandle, changes: Vec<Change>) {
    if changes.is_empty() {
        return;
    }
    let hide = hide_passwords(app);
    for c in changes {
        let _ = app.emit("clip_changed", c.hiding_passwords(hide));
    }
    refresh_plugins(app);
}

/// The 1 s tick: password expiry (the slot is zeroed in the file) and the 24 h limit.
pub fn tick(app: &AppHandle) {
    let changes = match app.try_state::<PanoState>() {
        Some(p) => p.pano.lock().tick(now_ms()),
        None => return,
    };
    emit(app, changes);
}

/// Settings › Pano changed.
pub fn configure(app: &AppHandle, cfg: notch_core::clip::Config) {
    let changes = match app.try_state::<PanoState>() {
        Some(p) => p.pano.lock().set_config(cfg, now_ms()),
        None => return,
    };
    emit(app, changes);
}
