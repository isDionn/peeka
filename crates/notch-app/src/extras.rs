//! Wave 5's "iyi olurlar" (shapes: `ui/src/bridge.ts` Wave 5 block): window previews, the microphone / camera dot,
//! the timer, the input feed for the mascot, the shelf and the share sheet. Rules live in `notch_core::{preview,
//! privacy, timer, input, shelf}`; this file holds their state and moves results out as events:
//! `privacy_changed` (`PrivacyState`), `input_tick` (`InputTick`), `timer_changed` (`TimerState` or null),
//! `shelf_changed` (null), `shelf_drag` (bool), `bluetooth_connected` ({name, battery}).

use std::time::{Duration, Instant};

use notch_core::alerts::Alert;
use notch_core::input::InputFeed;
use notch_core::preview::Previews;
use notch_core::privacy::{PrivacyState, Usage};
use notch_core::shelf::Shelf;
use notch_core::sources::{disconnected_name, HeadsetDrop};
use notch_core::timer::Timer;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager};

use crate::app::Notch;
use crate::live::now_ms;

#[derive(Default)]
pub struct Extras {
    pub previews: Mutex<Previews>,
    /// One capture at a time: hovering along the strip queues, it does not fan out.
    pub capturing: Mutex<()>,
    pub privacy: Mutex<PrivacyState>,
    pub timer: Mutex<Option<Timer>>,
    pub shelf: Mutex<Shelf>,
    pub headset: Mutex<HeadsetDrop>,
    pub cpu: Mutex<notch_core::sysmon::CpuWatch>,
}

/// `wave5-api.ts` `BluetoothEvent`.
#[derive(Clone, Serialize)]
struct BluetoothEvent {
    name: String,
    battery: Option<u8>,
}

pub fn extras(app: &AppHandle) -> Option<tauri::State<'_, Extras>> {
    app.try_state::<Extras>()
}

/// Called once from `setup`, after `layout` built the island.
pub fn start(app: &AppHandle) {
    app.manage(Extras::default());

    let handle = app.clone();
    if !notch_win::privacy::watch(move || privacy_refresh(&handle)) {
        eprintln!("[notch] could not open ConsentStore: no microphone/camera indicator");
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        notch_win::com();
        let ok = notch_win::bluetooth::watch(
            {
                let handle = handle.clone();
                move |a| {
                    let dropped = disconnected_name(&a)
                        .and_then(|name| extras(&handle)?.headset.lock().on_disconnect(name, now_ms()));
                    if let Some(name) = dropped {
                        music_stopped(&handle, name);
                    }
                    crate::live::put_system(&handle, a)
                }
            },
            move |name, battery| {
                let _ = handle.emit("bluetooth_connected", BluetoothEvent { name, battery });
            },
        );
        if !ok {
            eprintln!("[notch] could not start the Bluetooth watcher: no headset alert");
        }
    });

    input_feed(app.clone());
}

/// `music_stopped` `{name, app}`: the headset left and the music paused ("Music stopped" + "Resume": the page uses
/// `media_control`). `app` is the player's short name, null when Windows names none.
fn music_stopped(app: &AppHandle, name: String) {
    let player = app.try_state::<Notch>().and_then(|n| n.media.lock().as_ref().map(|m| m.app.clone()));
    let _ = app.emit("music_stopped", serde_json::json!({ "name": name, "app": player.filter(|a| !a.is_empty()) }));
}

/// The background "processor pinned" check (scenario 31): every 15 s one `GetSystemTimes` read (~0.001 % of a core,
/// measured), nothing in between. At 95 % or more for 60 s it names the busiest program once and says `cpu_high`
/// `{app}` (`app` null when no program passes 1 %). The expensive per-process read runs only then, on its own thread.
fn cpu_check(app: &AppHandle, x: &Extras, now: u64) {
    if crate::app::demo() || !x.cpu.lock().due(now) {
        return;
    }
    let Some(times) = notch_win::cpu::system_times() else { return };
    if x.cpu.lock().feed(times, now) {
        let app = app.clone();
        std::thread::spawn(move || {
            let busiest = notch_win::cpu::top_blocking(Duration::from_secs(1));
            let _ = app.emit("cpu_high", serde_json::json!({ "app": busiest }));
        });
    }
}

/// `live.rs` hands every now-playing change here.
pub fn on_media(app: &AppHandle, playing: bool) {
    let Some(x) = extras(app) else { return };
    let dropped = x.headset.lock().on_media(playing, now_ms());
    if let Some(name) = dropped {
        music_stopped(app, name);
    }
}

/// Re-reads both capabilities and emits only on a change.
fn privacy_refresh(app: &AppHandle) {
    let (Some(n), Some(x)) = (app.try_state::<Notch>(), extras(app)) else { return };
    let items = n.items.lock().clone();
    let start = n.apps.lock().0.clone();
    let name = |u: &Usage| -> Option<String> {
        if u.packaged {
            let prefix = format!("aumid:{}!", u.key);
            return items.iter().find(|i| i.app_id.starts_with(&prefix)).map(|i| i.name.clone());
        }
        let id = format!("exe:{}", u.key.replace('#', "\\").to_lowercase());
        let exe = u.exe();
        items
            .iter()
            .find(|i| i.app_id == id)
            .map(|i| i.name.clone())
            .or_else(|| start.iter().find(|a| a.exe.is_some() && a.exe == exe).map(|a| a.name.clone()))
    };
    let next = PrivacyState {
        mic: notch_core::privacy::in_use(&notch_win::privacy::read(notch_win::privacy::MIC), name),
        camera: notch_core::privacy::in_use(&notch_win::privacy::read(notch_win::privacy::CAMERA), name),
    };
    let changed = std::mem::replace(&mut *x.privacy.lock(), next.clone()) != next;
    if changed {
        let _ = app.emit("privacy_changed", next);
    }
}

/// `input_tick`: polled once a second (every 3 s after a minute without input), sent only on a change.
fn input_feed(app: AppHandle) {
    std::thread::spawn(move || {
        let (mut feed, t0) = (InputFeed::default(), Instant::now());
        loop {
            let (tick, ago) = notch_win::input::last_input().unwrap_or((0, 0));
            if let Some(n) = app.try_state::<Notch>() {
                let place = n.island_place();
                let cursor = notch_win::style::cursor()
                    .zip(place)
                    .and_then(|(c, (rect, scale))| notch_core::input::island_cursor(c, rect, scale));
                let presence = n.attention.lock().presence;
                if let Some(t) = feed.feed(tick, ago, cursor, presence, t0.elapsed().as_millis() as u64) {
                    let _ = app.emit("input_tick", t);
                }
            }
            std::thread::sleep(Duration::from_millis(notch_core::input::poll_ms(ago)));
        }
    });
}

/// From the app's 1 s tick: a timer that ran out is gone, with an alert.
pub fn tick(app: &AppHandle) {
    let Some(x) = extras(app) else { return };
    let now = now_ms();
    x.headset.lock().tick(now);
    crate::mirror::tick(app);
    cpu_check(app, &x, now);
    let done = {
        let mut t = x.timer.lock();
        let label = t.as_ref().filter(|t| t.done(now)).map(|t| t.view(now).label);
        if label.is_some() {
            *t = None;
        }
        label
    };
    if let Some(label) = done {
        let _ = app.emit("timer_changed", None::<notch_core::timer::TimerState>);
        crate::live::put_system(
            app,
            Alert {
                subtitle: Some(label),
                icon: Some("timer".into()),
                expand: true,
                ..Alert::system("system.timer", "timer", "Time is up".into(), 85, now, 8_000)
            },
        );
    }
}

pub fn emit_timer(app: &AppHandle) {
    let Some(x) = extras(app) else { return };
    let view = x.timer.lock().as_ref().map(|t| t.view(now_ms()));
    let _ = app.emit("timer_changed", view);
}

/// Files dragged over a strip or the island (`app::build` wires every one): `shelf_drag` while over it, onto the shelf
/// when dropped.
pub fn on_drop(app: &AppHandle, d: &DragDropEvent) {
    match d {
        DragDropEvent::Enter { .. } => {
            let _ = app.emit("shelf_drag", true);
        }
        DragDropEvent::Leave => {
            let _ = app.emit("shelf_drag", false);
        }
        DragDropEvent::Drop { paths, .. } => {
            let _ = app.emit("shelf_drag", false);
            let dropped = paths
                .iter()
                .filter_map(|p| {
                    let m = std::fs::metadata(p).ok()?;
                    Some((p.clone(), (!m.is_dir()).then_some(m.len())))
                })
                .collect();
            let changed = extras(app).is_some_and(|x| x.shelf.lock().add(dropped));
            if changed {
                let _ = app.emit("shelf_changed", ());
            }
        }
        _ => {}
    }
}
