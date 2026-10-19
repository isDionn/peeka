//! Wave 2's live sources, wired to the state in `app::Notch`: music (SMTC), the alert list and its sources (volume,
//! battery, Bluetooth, the HTTP adapter), the volume-key hook and the system monitor. Each Windows reader runs on its
//! own thread in `notch-win`; this file only moves their results into the state and out as events.

use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use notch_core::alerts::{Alert, AlertsView, Attention};
use notch_core::http_alerts::{self, Adapter};
use notch_core::sources;
use notch_core::status::Battery;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::{notice, Notch};

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The HTTP adapter while it listens.
pub struct Http {
    stop: Arc<AtomicBool>,
    port: u16,
}

pub fn alerts_view(n: &Notch) -> AlertsView {
    let ctx = Attention { dnd: n.settings.lock().dnd, ..*n.attention.lock() };
    let mut list = n.alerts.lock();
    list.focus(&ctx, now_ms()); // Focus Guard (B2): every emit passes here, so holding and the release follow it
    list.view(&ctx)
}

pub fn emit_alerts(app: &AppHandle) {
    if let Some(n) = app.try_state::<Notch>() {
        let _ = app.emit("alerts_changed", alerts_view(&n));
    }
}

/// One of Notch's own alerts into the list, then the event.
pub fn put_system(app: &AppHandle, a: Alert) {
    if let Some(n) = app.try_state::<Notch>() {
        n.alerts.lock().put_system(a, now_ms());
        emit_alerts(app);
    }
}

/// Charger / low battery, judged from two status readings (the 2 s tick).
pub fn on_battery(app: &AppHandle, before: Option<&Battery>, after: Option<&Battery>) {
    if let Some(a) = sources::power_alert(before, after, now_ms()) {
        put_system(app, a);
    }
}

/// Starts the readers that run for the process's life, and the hook / adapter the settings ask for.
pub fn start(app: &AppHandle) {
    if crate::app::demo() {
        // Fake music; the owner's real player is never read (or controlled: `media_control` refuses in demo).
        let m = Some(notch_core::media::demo(now_ms()));
        if let Some(n) = app.try_state::<Notch>() {
            *n.media.lock() = m.clone();
        }
        let _ = app.emit("media_changed", m);
    } else {
        let handle = app.clone();
        notch_win::media::watch(move |m| {
            if let Some(n) = handle.try_state::<Notch>() {
                *n.media.lock() = m.clone();
            }
            crate::extras::on_media(&handle, m.as_ref().is_some_and(|m| m.playing));
            let _ = handle.emit("media_changed", m);
        });
    }

    // The volume callback runs on an audio thread: hand its news to our own thread before touching COM again.
    let (tx, rx) = std::sync::mpsc::channel::<(notch_core::status::Volume, bool)>();
    notch_win::volume::watch(move |v, ours| {
        let _ = tx.send((v, ours));
    });
    let handle = app.clone();
    std::thread::spawn(move || {
        notch_win::com();
        for (v, ours) in rx {
            let Some(n) = handle.try_state::<Notch>() else { continue };
            let _ = handle.emit("status_changed", crate::commands::status(&n));
            // Notch's own changes (keys, the slider) already show; only outside changes go into the list.
            if !ours {
                put_system(&handle, sources::volume_alert(v, now_ms()));
            }
        }
    });

    // The Bluetooth watcher starts in `extras::start` (its alerts come here through `put_system`; Wave 5 added the
    // headset battery event beside them).

    let Some(n) = app.try_state::<Notch>() else { return };
    let (keys, http) = {
        let s = n.settings.lock();
        (s.capture_volume_keys, s.alerts_api)
    };
    if keys {
        keys_start(app);
    }
    if http {
        if let Err(e) = http_start(app) {
            notice(app, &e);
        }
    }
}

/// The volume-key hook (owner decision 11): each key changes the volume here and draws only Notch's indicator.
pub fn keys_start(app: &AppHandle) {
    let handle = app.clone();
    let ok = notch_win::volume::hook_start(move |key| {
        if let Some(v) = notch_win::volume::press(key) {
            let _ = handle.emit("volume_osd", v);
        }
    });
    if !ok {
        notice(app, "Could not capture the volume keys; the Windows volume overlay will show.");
    }
}

pub fn keys_stop() {
    notch_win::volume::hook_stop();
}

/// Opens the HTTP adapter on 127.0.0.1:5199. Err = a reason for the page.
pub fn http_start(app: &AppHandle) -> Result<(), String> {
    let n = app.try_state::<Notch>().ok_or("Peeka is not ready")?;
    if n.http.lock().is_some() {
        return Ok(());
    }
    let key = http_alerts::ensure_key(&http_alerts::key_path(&n.data_dir)).map_err(|_| "Could not write the alert key.")?;
    let listener = TcpListener::bind(("127.0.0.1", http_alerts::PORT))
        .map_err(|_| format!("Could not open the alert gate: port {} is in use.", http_alerts::PORT))?;
    let port = listener.local_addr().map_err(|_| "Could not open the alert gate.")?.port();
    let stop = Arc::new(AtomicBool::new(false));
    *n.http.lock() = Some(Http { stop: stop.clone(), port });
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut adapter = Adapter::default();
        http_alerts::serve(&listener, &stop, |req| {
            let Some(n) = handle.try_state::<Notch>() else {
                return adapter.handle(req, port, &key, &mut notch_core::alerts::AlertList::default(), now_ms()).0;
            };
            let (res, changed) = adapter.handle(req, port, &key, &mut n.alerts.lock(), now_ms());
            if changed {
                emit_alerts(&handle);
            }
            res
        });
    });
    Ok(())
}

/// Closes the adapter; what scripts left in the list goes with it.
pub fn http_stop(app: &AppHandle) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let Some(h) = n.http.lock().take() else { return };
    h.stop.store(true, Ordering::SeqCst);
    let _ = TcpStream::connect(("127.0.0.1", h.port)); // wakes the accept loop so it sees `stop`
    if n.alerts.lock().clear(Some("api")) {
        emit_alerts(app);
    }
}

/// The poller that runs now; a start or stop retires the one before.
static METER: AtomicU64 = AtomicU64::new(0);

/// `audio_level`: the default speaker's peak [left, right] (0..1, linear) about 30 times a second while the music bars
/// are shown (`on`), only while music plays and Peeka is neither locked, presenting nor shared (the bars then fall
/// back to their calm loop). Only the level is read, never the sound. Demo mode never starts it (the music is fake).
pub fn audio_level(app: &AppHandle, on: bool) {
    let mine = METER.fetch_add(1, Ordering::SeqCst) + 1;
    if !on || crate::app::demo() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        notch_win::com();
        let mut meter = None;
        let mut tick = 0u32;
        while METER.load(Ordering::SeqCst) == mine {
            let playing = app.try_state::<Notch>().is_some_and(|n| n.media.lock().as_ref().is_some_and(|m| m.playing));
            // hide_passwords = locked, presentation/busy, or screen shared: the same "private" gate
            if !playing || crate::clip_history::hide_passwords(&app) {
                (meter, tick) = (None, 0);
                std::thread::sleep(std::time::Duration::from_millis(250));
                continue;
            }
            // re-opened every 2 s, so a switch of the default speaker is followed
            if tick % 60 == 0 {
                meter = notch_win::audio::meter();
            }
            tick = tick.wrapping_add(1);
            if let Some(l) = meter.as_ref().and_then(notch_win::audio::peaks) {
                let _ = app.emit("audio_level", l);
            }
            std::thread::sleep(std::time::Duration::from_millis(33));
        }
    });
}
