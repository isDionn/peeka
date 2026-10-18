//! "İndirme bitti" (scenario 29, rules: `notch_core::downloads`): the Downloads folder is listed every 2 s from the
//! app tick and a finished new file is announced as `download_done` (`{id, name, size}`, never a path, never to a
//! plugin). The folder path lives here only. Off with `watchDownloads`; nothing is announced while Notch is locked.

use std::path::PathBuf;

use notch_core::downloads::Downloads;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Notch;

#[derive(Default)]
pub struct State {
    pub tracker: Mutex<Downloads>,
    dir: Mutex<Option<PathBuf>>,
}

/// Called from the app tick. Cheap when off (one lock and a reset).
pub fn poll(app: &AppHandle) {
    let (Some(n), Some(s)) = (app.try_state::<Notch>(), app.try_state::<State>()) else { return };
    if !n.settings.lock().watch_downloads || crate::app::demo() {
        s.tracker.lock().reset();
        return;
    }
    let Some(dir) = notch_win::downloads::cached_folder(&s.dir, notch_win::downloads::folder) else { return };
    let files = notch_win::downloads::list(&dir);
    let done = s.tracker.lock().step(&files);
    if crate::plugins::locked(app) {
        return; // stepped (so it is not announced later) but not said
    }
    for d in done {
        let _ = app.emit("download_done", d);
    }
}

/// The file behind an id Notch announced, if it is still a plain file there.
pub fn file(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let s = app.try_state::<State>()?;
    let name = s.tracker.lock().name(id)?.to_string();
    let path = s.dir.lock().clone()?.join(name);
    path.is_file().then_some(path)
}
