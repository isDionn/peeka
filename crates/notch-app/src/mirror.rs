//! The Windows notification mirror's state and poll (Wave 6; rules: `notch_core::mirror`, Windows side:
//! `notch_win::notifications`). Off by default; runs only while the owner's switch is on, Windows's privacy switch
//! is not "no", and a source works (package identity with Windows's yes, else the notification history database,
//! which needs no setup). Event: `notifications_changed` (`MirrorView`). The list is
//! memory only: this file writes no file and no log line (the `mirror` test checks).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use notch_core::mirror::{self, Access, MirrorState, MirrorView, Notice, RawToast, Store};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Notch;
use crate::live::now_ms;

#[derive(Default)]
pub struct Mirror {
    pub store: Mutex<Store>,
    /// Windows's last answer (asked again only by `mirror_enable`).
    pub access: Mutex<Access>,
    /// "Kodu kopyala": the clipboard counter to check 60 s after the copy.
    pub clear: Mutex<mirror::CodeClear>,
    poll: Mutex<Option<Arc<AtomicBool>>>,
}

pub fn get(app: &AppHandle) -> Option<tauri::State<'_, Mirror>> {
    app.try_state::<Mirror>()
}

/// Called once from `setup`: reads Windows's current answer without prompting, and polls if everything is there.
pub fn start(app: &AppHandle) {
    app.manage(Mirror::default());
    let handle = app.clone();
    std::thread::spawn(move || {
        notch_win::com();
        if let Some(m) = get(&handle) {
            *m.access.lock() = notch_win::notifications::access();
        }
        sync(&handle);
    });
}

/// The 1 s tick: a copied one-time code leaves the clipboard after a minute, if nothing else was copied since.
pub fn tick(app: &AppHandle) {
    let due = get(app).and_then(|m| m.clear.lock().due(now_ms()));
    if let Some(seq) = due {
        notch_win::clipboard::clear_if(seq);
    }
}

/// Notch is closing: a code still waiting is cleared now (same rule: only if it is still what the clipboard holds).
pub fn clear_now(app: &AppHandle) {
    if let Some(seq) = get(app).and_then(|m| m.clear.lock().take()) {
        notch_win::clipboard::clear_if(seq);
    }
}

pub fn state(app: &AppHandle) -> MirrorState {
    let enabled = app.try_state::<Notch>().is_some_and(|n| n.settings.lock().mirror);
    let access = get(app).map_or(Access::Unknown, |m| *m.access.lock());
    mirror::state(notch_win::notifications::registered(), access, notch_win::wpn::readable(), enabled)
}

/// Starts or stops the poll to match `state`; stopping empties the list.
pub fn sync(app: &AppHandle) -> MirrorState {
    let s = state(app);
    let Some(m) = get(app) else { return s };
    let mut poll = m.poll.lock();
    if s.on && poll.is_none() {
        let handle = app.clone();
        *poll = Some(notch_win::notifications::watch(s.listener(), move |arrived, gone| on_poll(&handle, arrived, gone)));
    } else if !s.on {
        if let Some(stop) = poll.take() {
            stop.store(true, Ordering::Relaxed);
        }
        drop(poll);
        if m.store.lock().clear() {
            emit(app);
        }
    }
    s
}

fn on_poll(app: &AppHandle, arrived: Vec<RawToast>, gone: Vec<u32>) {
    let (Some(m), Some(n)) = (get(app), app.try_state::<Notch>()) else { return };
    let now = now_ms();
    let mut changed = m.store.lock().gone(&gone);
    for raw in &arrived {
        // The sender's icon through the same cache as the strip's apps; the page draws its alpha only.
        let tile = if !mirror::aumid_ok(&raw.aumid) {
            String::new()
        } else {
            crate::commands::icon(&n, &format!("aumid:{}", raw.aumid))
        };
        if let Some(notice) = Notice::from_raw(raw, tile, now) {
            m.store.lock().put(notice);
            changed = true;
        }
    }
    if changed {
        emit(app);
    }
}

pub fn view(app: &AppHandle) -> MirrorView {
    let quiet = app.try_state::<Notch>().is_some_and(|n| n.settings.lock().dnd);
    get(app).map_or(MirrorView { items: vec![], quiet }, |m| m.store.lock().view(quiet))
}

pub fn emit(app: &AppHandle) {
    let _ = app.emit("notifications_changed", view(app));
}

/// The owner's switch: on asks Windows (once) and polls; off stops and forgets the list.
pub fn set(app: &AppHandle, on: bool) -> std::io::Result<MirrorState> {
    if on {
        notch_win::com();
        // Only with identity is there a Windows prompt; without it, the Windows privacy switch is read again.
        let access = if notch_win::notifications::registered() {
            notch_win::notifications::request_access()
        } else {
            notch_win::notifications::access()
        };
        if let Some(m) = get(app) {
            *m.access.lock() = access;
        }
    }
    // Saved even when blocked: the row then says why (as the page expects), and the mirror starts once it can.
    if let Some(n) = app.try_state::<Notch>() {
        let mut s = n.settings.lock();
        let mut next = s.clone();
        next.mirror = on;
        n.save(&next)?;
        *s = next;
    }
    Ok(sync(app))
}
