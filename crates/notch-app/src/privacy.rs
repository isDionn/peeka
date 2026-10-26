//! The one privacy gate: locked, presenting / busy (a full-screen app), or the screen shared or recorded. While it is
//! closed Peeka shows generic labels and nothing of the main assistant's slot data reaches a page. Every consumer
//! calls [`closed`] (list held by `notch_core::plugins::host::tests_slots`): clipboard passwords, the agent diff, the
//! music meter, the screen tint, `SurfacesView.private` / `assistantState`, `assistant_request`, `assistant_reply`,
//! `assistant_event`. A gate change goes out as `plugin_surfaces_changed` (`plugins::emit_surfaces`).

use std::collections::VecDeque;

use notch_core::presence::Presence;
use parking_lot::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Notch;

/// `assistant_event`s that came while the gate was closed: at most this many (the newest), delivered in order after.
const HELD_MAX: usize = 50;
static HELD: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());

pub fn closed(app: &AppHandle) -> bool {
    let presence = app.try_state::<Notch>().map(|n| n.attention.lock().presence).unwrap_or_default();
    crate::plugins::locked(app) || matches!(presence, Presence::Presentation | Presence::Busy) || crate::extras::sharing(app)
}

/// One `assistant_event` for the page: now, or held while the gate is closed (nothing reaches the WebView meanwhile).
pub fn event(app: &AppHandle, v: Value) {
    if closed(app) {
        let mut held = HELD.lock();
        held.push_back(v);
        if held.len() > HELD_MAX {
            held.pop_front();
        }
    } else {
        let _ = app.emit("assistant_event", v);
    }
}

/// The gate may have changed (`plugins::emit_surfaces`): once open, the held events go out, oldest first.
pub fn release(app: &AppHandle) {
    if HELD.lock().is_empty() || closed(app) {
        return;
    }
    let held = std::mem::take(&mut *HELD.lock());
    for v in held {
        let _ = app.emit("assistant_event", v);
    }
}
