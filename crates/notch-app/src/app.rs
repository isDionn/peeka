//! Composition root: one strip window per monitor (AppBar, 30 px), one fixed-size transparent island
//! window on the primary monitor, the taskbar worker, shortcuts, and the ticks that feed the page.
//!
//! UI contract (`ui/src/bridge.ts`): strips load `index.html?monitor=<index>` (labels `strip-<index>`), the island
//! loads `island.html` (label `island`). Events as in bridge.ts: `windows_changed` ({monitor}, per monitor when the
//! list changed), `pins_changed`, `shortcut` ({name, monitor}; name = the snake_case `ShortcutId`). Extra events
//! (not in bridge.ts yet): `notch://fullscreen` (bool: strips hidden), `notch://notice` (String). `status_changed`
//! carries `notch_core::status::Status`, `settings_changed` the page's settings view. Wave 2 (`live.rs`):
//! `media_changed` (`notch_core::media::Media` or null), `alerts_changed` (`notch_core::alerts::AlertsView`),
//! `sysmon_tick` (`notch_core::sysmon::SysmonTick`, only between `sysmon_start` and `sysmon_stop`), `volume_osd`
//! (`notch_core::status::Volume`, after a captured volume key), `audio_level` (`[f32; 2]`, `live::audio_level`). The list lives in `notch_core::contract::EVENTS`.
//! Wave 3 (`plugins.rs`): `plugins_changed`, `consent_changed`, `plugin_surfaces_changed`, `composer_event`,
//! `plugin_stream`; the consent window loads `consent.html` (label `consent`). Wave 4: `lock_changed`
//! (`notch_core::lock::LockState`), `clip_changed` (`clip_history.rs`). Wave 5 (`extras.rs`): `privacy_changed`,
//! `input_tick`, `timer_changed`, `shelf_changed`, `shelf_drag`, `bluetooth_connected`, `music_stopped`, `download_done`, `cpu_high`, `fullscreen_screens` (`{island, strips}`: what the fullscreen app hides, per monitor), `approval_badge` (`{monitor, count}` or null: an approval waits while the cursor is on another monitor's strip). `screen_tint` (`notch_core::tint::ScreenTint`, every 2 s per strip monitor unless paused). Wave 6 (`mirror.rs`): `notifications_changed`
//! (`notch_core::mirror::MirrorView`). Assistant slots (`plugins.rs`, `privacy.rs`): `assistant_event` (`{type, data}`,
//! held while the privacy gate is closed), `assistant_reply` (`{id, result}` or `{id, error: {code}}`: the answer to
//! `assistant_request`). Commands: see `commands.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use notch_core::alerts::Alert;
use notch_core::apps::{AppItem, ListedApp};
use notch_core::clickthrough::{captures, CssRect};
use notch_core::model::{Monitor, Rect};
use notch_core::settings::{self, HideMode, Settings};
use notch_core::shortcuts::{self as keys, ShortcutGate, ShortcutId, DIAGNOSTICS_KEYS, EMERGENCY_SPARE};
use notch_core::status::Status;
use notch_core::{ports, supervise};
use notch_win::appbar::Win32AppBar;
use parking_lot::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// The island window and where it sits (physical px), for the click-through poll.
#[derive(Clone, Copy)]
struct IslandPlace {
    rect: Rect,
    scale: f64,
    hwnd: isize,
    /// The island monitor's refresh rate: the click-through poll runs at it.
    hz: u32,
    /// The window reaches the full `rect` (`window_tall`); else it is the resting band. `rect` stays the full one: the
    /// mascot's eyes and the click poll map the cursor through it.
    tall: bool,
}

/// A strip window (label `strip-<index>`): taller than its 30 px AppBar so the panels draw under the bar. No window
/// region (like the island): the cursor poll (`click_through`) lets clicks through outside the bar + reported rects.
#[derive(Clone, Default)]
pub struct StripPlace {
    hwnd: isize,
    scale: f64,
    /// Window top-left, size and bar height, physical px.
    origin: (i32, i32),
    size: (i32, i32),
    bar: i32,
    /// Something hangs below the bar (`window_tall`): the window reaches down the monitor, else it is short.
    tall: bool,
    pub rects: Vec<CssRect>,
    /// The page's devicePixelRatio and open panel with its last report (`notch_core::diagnostics`).
    pub dpr: Option<f64>,
    pub view: String,
}

/// Rust owns all state; windows only draw.
pub struct Notch {
    pub data_dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub appbar: Win32AppBar,
    /// The last list sent to the page: commands act only on what is in it.
    pub items: Mutex<Vec<AppItem>>,
    /// The island page's clickable rectangles (CSS px, window-relative).
    pub rects: Mutex<Vec<CssRect>>,
    /// The island page's devicePixelRatio and open card with its last report (`notch_core::diagnostics`).
    pub island_view: Mutex<(Option<f64>, String)>,
    /// The last diagnostics file: "Open folder" shows only this one.
    pub diag_last: Mutex<Option<PathBuf>>,
    pub monitors: Mutex<Vec<Monitor>>,
    /// The Start panel's last list (and when it was scanned): `launch_app` accepts these ids too.
    pub apps: Mutex<(Vec<ListedApp>, Option<Instant>)>,
    /// App id -> PNG data URL ("" = the shell had none).
    pub icons: Mutex<HashMap<String, notch_win::icons::Icon>>,
    /// App id -> its strip name (`apps::display_name`), a miss too.
    pub names: Mutex<HashMap<String, String>>,
    /// The primary monitor's DDC/CI brightness; None = not controllable (read once at start, then after each set).
    pub brightness: Mutex<Option<u8>>,
    /// `Radio::RequestAccessAsync` said yes (true until it has answered).
    pub radios_ok: Mutex<bool>,
    island: Mutex<Option<IslandPlace>>,
    /// Strip windows by label.
    pub strips: Mutex<HashMap<String, StripPlace>>,
    gate: Mutex<ShortcutGate>,
    /// Notch's own alert list (Wave 2) and what the attention budget reads besides the DND setting.
    pub alerts: Mutex<notch_core::alerts::AlertList>,
    pub attention: Mutex<notch_core::alerts::Attention>,
    /// The last now-playing state (`get_media`).
    pub media: Mutex<Option<notch_core::media::Media>>,
    /// The HTTP alert adapter while it listens.
    pub http: Mutex<Option<crate::live::Http>>,
    /// Clipboard views on screen: the island is excluded from capture while any is.
    pub capture: Mutex<notch_core::capture::CaptureGuard>,
    /// Ctrl+K: the last results by id (`search_open` acts only on these) and the recently opened ones.
    pub search_last: Mutex<HashMap<String, crate::commands::SearchResult>>,
    pub recents: Mutex<Vec<crate::commands::SearchResult>>,
    /// `open_tray`'s last list (PENDING Wave 0 test 4): `tray_open` acts only on these.
    pub tray: Mutex<Vec<notch_core::tray::TrayIcon>>,
    /// Ctrl+Shift+A / `island_hide`: the island is hidden until this Unix ms (an hour, or until pressed again).
    pub island_hidden: Mutex<Option<u64>>,
    /// `recent_files`' last list (the `.lnk` paths, by index): `open_recent` opens only these.
    pub recent: Mutex<Vec<PathBuf>>,
    /// `app_recent`'s last list: `app_recent_open` opens only these.
    pub jump: Mutex<Vec<PathBuf>>,
    /// Ctrl+Space attachments made by `composer_scan` / `composer_attach_file` (share-folder copies), taken in
    /// order by `composer_submit`.
    pub composer_files: Mutex<Vec<notch_core::plugins::host::Attachment>>,
    /// Started by the Run key (or the guard) with a settings file already there: the island skips the first-run
    /// card (`island.html?autostart=1`).
    quiet: bool,
}

/// `notch --demo`: set once in `setup`, never cleared. Nothing is written to disk: settings,
/// pins and the clipboard live in memory, the plugin host is a fake main assistant (`Host::demo`), the taskbar is never
/// hidden (that needs the crash marker), no guard, no Run key, no share-folder copies; logs go to stderr only.
static DEMO: AtomicBool = AtomicBool::new(false);

pub fn demo() -> bool {
    DEMO.load(Ordering::SeqCst)
}

impl Notch {
    pub fn save(&self, s: &Settings) -> std::io::Result<()> {
        if demo() {
            return Ok(()); // the caller keeps `s` in memory
        }
        settings::save(&settings::settings_path(&self.data_dir), s)
    }

    /// The island and strip windows for "Save diagnostics": geometry, applied region, what the pages last reported.
    pub fn diag_pages(&self) -> Vec<notch_core::diagnostics::PageDiag> {
        use notch_core::clickthrough::{region_boxes, strip_region_boxes};
        use notch_win::diagnostics::{region, window_rect};
        let mut out = vec![];
        let island = *self.island.lock(); // not held while the other locks are taken
        if let Some(p) = island {
            let rects = self.rects.lock().clone();
            let (dpr, view) = self.island_view.lock().clone();
            out.push(notch_core::diagnostics::PageDiag {
                label: "island".into(),
                window: window_rect(p.hwnd),
                region: region(p.hwnd),
                wanted: region_boxes(&rects, p.scale, (p.rect.width(), p.rect.height())),
                scale: p.scale,
                rects,
                dpr,
                view,
            });
        }
        let strips = self.strips.lock();
        let mut labels: Vec<&String> = strips.keys().collect();
        labels.sort();
        for l in labels {
            let s = &strips[l];
            out.push(notch_core::diagnostics::PageDiag {
                label: l.clone(),
                window: window_rect(s.hwnd),
                region: region(s.hwnd),
                wanted: strip_region_boxes(&s.rects, s.scale, s.size, s.bar),
                scale: s.scale,
                rects: s.rects.clone(),
                dpr: s.dpr,
                view: s.view.clone(),
            });
        }
        out
    }

    /// The island window's rectangle (physical px) and scale, once `layout` placed it.
    pub fn island_place(&self) -> Option<(Rect, f64)> {
        self.island.lock().map(|p| (p.rect, p.scale))
    }

    pub fn set_hide_mode(&self, mode: HideMode) -> std::io::Result<()> {
        let mut s = self.settings.lock();
        let mut next = s.clone();
        next.taskbar_hide = mode;
        self.save(&next)?;
        *s = next;
        Ok(())
    }
}

pub fn notice(app: &AppHandle, text: &str) {
    eprintln!("[notch] {text}");
    let _ = app.emit("notch://notice", text);
}

pub fn run() {
    tauri::Builder::default()
        // A second launch only wakes the first (no second set of strips, no second taskbar worker).
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(on_shortcut).build())
        .invoke_handler(tauri::generate_handler![
            crate::commands::get_monitor,
            crate::commands::list_windows,
            crate::commands::get_pins,
            crate::commands::set_pins,
            crate::commands::import_taskbar_pins,
            crate::commands::show_desktop,
            crate::commands::activate_window,
            crate::commands::close_window,
            crate::commands::new_window,
            crate::commands::launch_app,
            crate::commands::list_apps,
            crate::commands::search,
            crate::commands::open_result,
            crate::commands::get_status,
            crate::commands::set_volume,
            crate::commands::set_brightness,
            crate::commands::audio_get,
            crate::commands::set_audio_output,
            crate::commands::set_mic_muted,
            crate::commands::audio_sessions,
            crate::commands::audio_session_set,
            crate::commands::set_radio,
            crate::commands::set_dnd,
            crate::commands::open_windows_settings,
            crate::commands::open_tray,
            crate::commands::tray_open,
            crate::commands::tray_menu,
            crate::commands::mirror_state,
            crate::commands::mirror_enable,
            crate::commands::mirror_disable,
            crate::commands::mirror_list,
            crate::commands::mirror_dismiss,
            crate::commands::mirror_open_app,
            crate::commands::mirror_ask,
            crate::commands::notif_copy_code,
            crate::commands::power,
            crate::commands::restore_taskbar,
            crate::commands::quit,
            crate::commands::demo_restart,
            crate::commands::get_settings,
            crate::commands::set_settings,
            crate::commands::report_hit_rects,
            crate::commands::window_tall,
            crate::commands::save_diagnostics,
            crate::commands::diagnostics_open_folder,
            crate::commands::wifi_networks,
            crate::commands::wifi_connect,
            crate::commands::bt_devices,
            crate::commands::bt_set,
            crate::commands::taskbar_set_mode,
            crate::commands::get_media,
            crate::commands::media_control,
            crate::commands::list_alerts,
            crate::commands::dismiss_alert,
            crate::commands::clear_alerts,
            crate::commands::open_alert,
            crate::commands::sysmon_start,
            crate::commands::sysmon_stop,
            crate::commands::audio_level_start,
            crate::commands::audio_level_stop,
            crate::commands::plugin_surfaces,
            crate::commands::plugin_action,
            crate::commands::approval_answer,
            crate::commands::composer_submit,
            crate::commands::composer_voice,
            crate::commands::consent_get,
            crate::commands::consent_answer,
            crate::commands::plugin_list,
            crate::commands::plugin_set_scope,
            crate::commands::plugin_set_main,
            crate::commands::plugin_disconnect,
            crate::commands::plugin_remove,
            crate::commands::modules_get,
            crate::commands::modules_set,
            crate::commands::lock_state,
            crate::commands::lock_now,
            crate::commands::lock_release,
            crate::commands::clip_visible,
            crate::commands::clip_list,
            crate::commands::clip_copy,
            crate::commands::clipboard_write,
            crate::commands::clip_paste_plain,
            crate::commands::clip_pin,
            crate::commands::clip_delete,
            crate::commands::clip_clear,
            crate::commands::clip_reveal,
            crate::commands::clip_share,
            crate::commands::clip_edit,
            crate::commands::clip_open,
            crate::commands::clip_to_shelf,
            crate::commands::clip_preview,
            crate::commands::clip_ocr,
            crate::commands::download_open,
            crate::commands::download_show_in_folder,
            crate::commands::clip_drag,
            crate::commands::search_index_state,
            crate::commands::search_open,
            crate::commands::search_ask,
            crate::commands::window_preview,
            crate::commands::share_open,
            crate::commands::shelf_list,
            crate::commands::shelf_ask,
            crate::commands::shelf_add,
            crate::commands::shelf_open,
            crate::commands::shelf_locate,
            crate::commands::shelf_pin,
            crate::commands::shelf_remove,
            crate::commands::shelf_copy_files,
            crate::commands::shelf_share,
            crate::commands::shelf_show_in_folder,
            crate::commands::shelf_zip,
            crate::commands::shelf_drag,
            crate::commands::timer_get,
            crate::commands::timer_start,
            crate::commands::timer_control,
            crate::commands::privacy_get,
            crate::commands::quit_app,
            crate::commands::open_start_menu,
            crate::commands::open_calendar,
            crate::commands::island_hide,
            crate::commands::island_hidden,
            crate::commands::tray_icons,
            crate::commands::recent_files,
            crate::commands::open_recent,
            crate::commands::app_recent,
            crate::commands::app_recent_open,
            crate::commands::set_start_items,
            crate::commands::app_show_in_folder,
            crate::commands::launch_app_admin,
            crate::commands::assistant_counts,
            crate::commands::assistant_open,
            crate::commands::calendar_next,
            crate::commands::claude_bridge_state,
            crate::commands::claude_bridge_install,
            crate::commands::claude_bridge_remove,
            crate::commands::agent_bridges,
            crate::commands::agent_usage,
            crate::commands::agent_bridge_install,
            crate::commands::agent_bridge_remove,
            crate::commands::agent_bridge_preview,
            crate::commands::cc_focus_terminal,
            crate::commands::cc_diff,
            crate::commands::cc_diff_open,
            crate::commands::open_task_manager,
            crate::commands::focus_strip,
            crate::commands::focus_island,
            crate::commands::typing_focus,
            crate::commands::permission_history,
            crate::commands::first_connect_get,
            crate::commands::first_connect_ack,
            crate::commands::shelf_suggest,
            crate::commands::shelf_memory,
            crate::commands::assistant_start,
            crate::commands::composer_kinds,
            crate::commands::composer_scan,
            crate::commands::composer_attach_file,
            crate::commands::window_pick,
            crate::commands::recap_get,
            crate::commands::recap_ack,
            crate::commands::recap_copy_image,
            crate::commands::claude_chat_state,
            crate::commands::claude_chat_send,
            crate::commands::claude_chat_stop,
            crate::commands::claude_chat_new,
            crate::commands::assistant_request,
        ])
        .setup(|app| {
            setup(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Notch could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                shutdown(app);
            }
        });
}

/// Launch order: (1) a marker left behind is restored, (2) strips + AppBars, (3-6) the worker writes the
/// marker, starts the guard, turns auto-hide on and hides the bars.
fn setup(app: &AppHandle) -> Result<(), String> {
    // Here, not in main(): the single-instance plugin has already sent a second launch away, so this can never
    // clean up the AppBars of a Notch that is still running.
    let args: Vec<String> = std::env::args().collect();
    let is_demo = args.iter().any(|a| a == supervise::DEMO_ARG);
    DEMO.store(is_demo, Ordering::SeqCst);
    if !is_demo {
        notch_win::taskbar::restore_left_behind();
        notch_win::tray_host::start();
    }
    let _ = APP.set(app.clone());
    let handle = app.clone();
    // A tray icon changed (or went): the listed entry it matches goes to the page, already overlaid (`tray_x`).
    notch_win::tray_host::on_live(move |exe| {
        let Some(n) = handle.try_state::<Notch>() else { return }; // not managed yet: the first list overlays it
        let listed = n.tray.lock().iter().find(|t| t.exe.eq_ignore_ascii_case(exe)).cloned();
        if let Some(t) = listed {
            let _ = handle.emit("tray_icon", crate::commands::tray_x(&n, t));
        }
    });
    let data_dir = notch_core::data_dir().ok_or("No data folder (LOCALAPPDATA)")?;
    if !is_demo {
        notch_core::migrate_data_dir(&data_dir);
    }
    let path = settings::settings_path(&data_dir);
    let quiet = !is_demo && supervise::is_autostart(&args) && path.exists();
    // Demo: defaults, never the owner's file (`load` may also move a corrupt one aside), taskbar left alone.
    let settings =
        if is_demo { Settings { taskbar_hide: HideMode::Off, ..Settings::default() } } else { settings::load(&path) };
    let mode = settings.taskbar_mode();
    // Always on: from here until a clean exit, the guard treats our end as a crash.
    set_alive(&data_dir, true);
    // Release only: a dev build must not put target\debug into the owner's startup list.
    if !cfg!(debug_assertions) && !is_demo {
        if let Err(error) = notch_win::autostart::set(settings.autostart) {
            eprintln!("[notch] autostart: {error}");
        }
    }
    app.manage(Notch {
        data_dir: data_dir.clone(),
        settings: Mutex::new(settings),
        appbar: Win32AppBar::default(),
        items: Mutex::new(vec![]),
        rects: Mutex::new(vec![]),
        island_view: Mutex::new((None, String::new())),
        diag_last: Mutex::new(None),
        monitors: Mutex::new(vec![]),
        apps: Mutex::new((vec![], None)),
        icons: Mutex::new(HashMap::new()),
        names: Mutex::new(HashMap::new()),
        brightness: Mutex::new(None),
        radios_ok: Mutex::new(true),
        island: Mutex::new(None),
        strips: Mutex::new(HashMap::new()),
        gate: Mutex::new(ShortcutGate::default()),
        alerts: Mutex::new(Default::default()),
        attention: Mutex::new(Default::default()),
        media: Mutex::new(None),
        http: Mutex::new(None),
        capture: Mutex::new(Default::default()),
        search_last: Mutex::new(HashMap::new()),
        recents: Mutex::new(vec![]),
        jump: Mutex::new(vec![]),
        tray: Mutex::new(vec![]),
        island_hidden: Mutex::new(None),
        recent: Mutex::new(vec![]),
        composer_files: Mutex::new(vec![]),
        quiet,
    });
    let gave_up = supervise::gave_up_path(&data_dir);
    if let Some(text) = (!is_demo).then(|| std::fs::read_to_string(&gave_up).ok()).flatten() {
        let _ = std::fs::remove_file(&gave_up);
        let now = crate::live::now_ms();
        crate::live::put_system(app, Alert::system("notch-gave-up", "notch", text, 95, now, 30 * 60_000));
    }
    // panic = "abort" in release: this hook is the only chance to let go of the keyboard hook on a crash.
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        notch_win::volume::unhook();
        notch_win::winkey::unhook();
        previous(info);
    }));
    layout(app);
    let emergency_key = register_shortcuts(app);
    if !is_demo {
        // The brand may leave the taskbar and the Win key alone (two builds side by side must not fight over them).
        if notch_core::brand::HIDE_TASKBAR {
            crate::taskbar::init(app, &data_dir, emergency_key);
        }
        crate::taskbar::apply(mode, false);
        // A lone Win tap opens Peeka's Start while Peeka hides the taskbar (`taskbar::apply` turns it on and off).
        if notch_core::brand::START_KEY_HOOK {
            let handle = app.clone();
            notch_win::winkey::start(move |at| {
                let Some(n) = handle.try_state::<Notch>() else { return };
                let monitor = cursor_monitor(&n).map(|i| i.to_string()).unwrap_or_default();
                let _ = handle.emit("shortcut", serde_json::json!({ "name": "start", "monitor": monitor }));
                if cfg!(debug_assertions) {
                    eprintln!("[winkey] hook -> emit {} us", at.elapsed().as_micros());
                }
            });
        }
    }
    let handle = app.clone();
    notch_win::foreground::watch(move |exe| on_foreground(&handle, &exe));
    let handle = app.clone();
    notch_win::flash::watch(move || {
        let Some(n) = handle.try_state::<Notch>() else { return };
        for m in n.monitors.lock().iter() {
            let _ = handle.emit("windows_changed", serde_json::json!({ "monitor": m.index.to_string() }));
        }
    });
    // TODO(Wave 0 test 4): the tray path - the real hidden-icons panel moved under the strip, a tray mirror
    // (own `Shell_TrayWnd`), or a plain list - is chosen from the owner's `probe tray` result. Until
    // then `open_tray` returns the plain list (`notch_core::tray`, Wave 6) so the chevron is not dead. Its
    // "Restore taskbar" item calls `taskbar::emergency` like the Start panel and the strip's right-click.
    probe_once(app.clone());
    crate::live::start(app);
    if !is_demo {
        // first run: the Windows taskbar's pins become the strip's (once, only while Peeka has none; reads only)
        let handle = app.clone();
        thread::spawn(move || {
            if let Some(n) = handle.try_state::<Notch>() {
                if let Err(e) = crate::commands::import_pins(&handle, &n, true) {
                    eprintln!("[notch] taskbar pins: {e:?}");
                }
            }
        });
    }
    app.manage(crate::downloads::State::default());
    crate::extras::start(app);
    crate::mirror::start(app);
    crate::plugins::start(app, data_dir.clone());
    crate::recap::start(app, &data_dir);
    crate::clip_history::start(app, data_dir);
    ticks(app.clone());
    fullscreen_watch(app.clone());
    click_through(app.clone());
    Ok(())
}

/// The alive file (`notch_core::supervise`): present = a crash if Notch ends now.
fn set_alive(data_dir: &std::path::Path, on: bool) {
    if demo() {
        return;
    }
    let path = supervise::alive_path(data_dir);
    if on {
        let _ = path.parent().map(std::fs::create_dir_all);
        let _ = std::fs::write(&path, std::process::id().to_string());
    } else {
        let _ = std::fs::remove_file(&path);
    }
}

/// `WM_QUERYENDSESSION` (true) / a cancelled `WM_ENDSESSION` (false): the guard must not relaunch while Windows
/// logs off or shuts down.
fn on_session_end(ending: bool) {
    if let Some(dir) = notch_core::data_dir() {
        set_alive(&dir, !ending);
    }
}

/// The handle the session hook's plain `fn` callbacks reach the app through (set once in `setup`).
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// `WTS_SESSION_LOCK` (true) / `WTS_SESSION_UNLOCK` (false): Notch's lock follows.
fn on_session_lock(locked: bool) {
    if let Some(app) = APP.get() {
        crate::plugins::lock(app, notch_core::lock::Reason::Windows, locked);
    }
}

fn shutdown(app: &AppHandle) {
    // A clean exit ("Quit", Windows ending the session): the guard must not bring Notch back.
    if let Some(n) = app.try_state::<Notch>() {
        set_alive(&n.data_dir, false);
    }
    // The Windows bar first, then the strips' AppBars go.
    crate::taskbar::restore_now();
    notch_win::tray_host::stop();
    crate::live::keys_stop();
    notch_win::winkey::unhook();
    crate::live::http_stop(app);
    crate::mirror::clear_now(app);
    crate::plugins::stop(app);
    crate::claude_chat::kill();
    notch_win::sysmon::stop();
    if let Some(n) = app.try_state::<Notch>() {
        for hwnd in n.appbar.handles() {
            ports::AppBar::remove(&n.appbar, hwnd);
        }
    }
    crate::taskbar::forget_strips();
}

fn build(app: &AppHandle, label: &str, url: &str) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window(label) {
        return Some(w);
    }
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(notch_core::PRODUCT_NAME)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .zoom_hotkeys_enabled(false)
        // the window under the cursor (msedgewebview2's render widget) may only exist once the page has loaded
        .on_page_load(|w, p| {
            if let (tauri::webview::PageLoadEvent::Finished, Ok(h)) = (p.event(), w.hwnd()) {
                notch_win::style::share_drop_target(h.0 as isize);
            }
        })
        .build()
        .map_err(|e| eprintln!("[notch] {label}: {e}"))
        .ok()?;
    no_browser_ui(&w);
    if let Ok(hwnd) = w.hwnd() {
        notch_win::style::no_activate(hwnd.0 as isize);
        notch_win::style::no_frame_line(hwnd.0 as isize);
        notch_win::style::tool_window(hwnd.0 as isize); // not on the taskbar, not in Alt+Tab (skip_taskbar alone is only the taskbar)
        notch_win::style::strip_no_activate(hwnd.0 as isize); // a press on a strip or the island leaves the user's app in front
        notch_win::style::share_drop_target(hwnd.0 as isize); // else no file drag over Peeka reaches wry's handler
    }
    // A file dragged over any strip or the island opens the shelf; the strip is most of what the user sees.
    let handle = app.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::DragDrop(d) = e {
            crate::extras::on_drop(&handle, d);
        }
    });
    Some(w)
}

/// No browser leftovers in a Peeka page (RC7 owner): WebView2's own right-click menu (Back, Refresh, Save as, Print) and
/// its browser keys (F5, Ctrl+R, Ctrl+P, Ctrl+F, F12, ...) are off; editing keys (Ctrl+C/V/X/A/Z) still work. Zoom is
/// already off (`zoom_hotkeys_enabled`). Tauri doesn't expose these two settings, so they go on the live WebView2.
pub fn no_browser_ui(w: &WebviewWindow) {
    let _ = w.with_webview(|pw| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        // SAFETY: COM calls on this webview's own settings object, on the main thread (`with_webview` runs there).
        unsafe {
            let off = pw.controller().CoreWebView2().and_then(|c| c.Settings()).and_then(|s| {
                s.SetAreDefaultContextMenusEnabled(false)?;
                s.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)
            });
            if let Err(e) = off {
                eprintln!("[notch] browser ui: {e}");
            }
        }
    });
}

fn place(w: &WebviewWindow, r: Rect) {
    let _ = w.set_position(PhysicalPosition::new(r.left, r.top));
    let _ = w.set_size(PhysicalSize::new(r.width().max(1) as u32, r.height().max(1) as u32));
}

/// Places a strip window short or tall under its bar and records where (the click-through poll maps through it).
fn place_strip(n: &Notch, label: &str, w: &WebviewWindow, hwnd: isize, m: &Monitor, bar: Rect, tall: bool) {
    let rect = notch_core::model::strip_window_rect(bar, m, tall);
    place(w, rect);
    let mut strips = n.strips.lock();
    let s = strips.entry(label.to_string()).or_default();
    *s = StripPlace { hwnd, scale: m.scale, origin: (rect.left, rect.top), size: (rect.width(), rect.height()), bar: bar.height(), tall, ..std::mem::take(s) };
}

/// `window_tall`: a strip or the island page grows its window before anything paints below the bar and shrinks it after all of it closed.
pub fn window_tall(n: &Notch, w: &WebviewWindow, tall: bool) -> Option<()> {
    let label = w.label();
    if label == "island" {
        let (rect, scale) = {
            let mut island = n.island.lock(); // not held while the window moves: the click poll reads it
            let p = island.as_mut()?;
            p.tall = tall;
            (p.rect, p.scale)
        };
        place(w, notch_core::model::island_window_rect(rect, scale, tall));
        return Some(());
    }
    let index: usize = label.strip_prefix("strip-")?.parse().ok()?;
    let m = n.monitors.lock().iter().find(|m| m.index == index)?.clone();
    let (hwnd, bar) = {
        let strips = n.strips.lock();
        let s = strips.get(label)?;
        (s.hwnd, Rect { left: s.origin.0, top: s.origin.1, right: s.origin.0 + s.size.0, bottom: s.origin.1 + s.bar })
    };
    place_strip(n, label, w, hwnd, &m, bar, tall);
    Some(())
}

/// Slow one-time reads off the main thread: radio access and DDC/CI brightness; then the page gets fresh status.
fn probe_once(app: AppHandle) {
    thread::spawn(move || {
        notch_win::com();
        let ok = notch_win::radios::access();
        let level = notch_win::brightness::read();
        let Some(n) = app.try_state::<Notch>() else { return };
        *n.radios_ok.lock() = ok;
        *n.brightness.lock() = level;
        let _ = app.emit("status_changed", crate::commands::status(&n));
    });
}

/// Strips for every monitor wanted (the primary always, the others when `secondary_strips`), made, reserved and
/// placed; strips no longer wanted (monitor gone, setting off) removed; the island on the primary. Idempotent: the
/// tick runs it again whenever the monitor list changes, `set_settings` when the setting does.
pub fn layout(app: &AppHandle) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let monitors = notch_win::monitors::list();
    let (secondary, island_only) = {
        let s = n.settings.lock();
        (s.secondary_strips, s.island_only)
    };
    let plan = notch_core::screens::plan_layout(&monitors, secondary, island_only);
    // Before any window is built: a strip page asks `get_monitor` as soon as it loads, and an unknown monitor left it
    // blank for good (VM run 2: 2 of 4 starts showed no strip while the island was still being built).
    *n.monitors.lock() = monitors.clone();
    let wanted = |i: usize| plan.strips.contains(&i);
    for m in monitors.iter().filter(|m| wanted(m.index)) {
        let label = format!("strip-{}", m.index);
        let Some(w) = build(app, &label, &format!("index.html?monitor={}", m.index)) else { continue };
        let Ok(hwnd) = w.hwnd().map(|h| h.0 as isize) else { continue };
        let reserved = if notch_core::brand::RESERVE_APPBAR { ports::reserve(&n.appbar, hwnd, m) } else { None };
        let bar = reserved.unwrap_or_else(|| notch_core::model::strip_rect(m));
        let tall = n.strips.lock().get(&label).is_some_and(|s| s.tall); // a monitor change under an open panel keeps it tall
        place_strip(&n, &label, &w, hwnd, m, bar, tall);
        if !FS_HIDDEN.lock().contains(&label) {
            let _ = w.show(); // a monitor / Explorer change during fullscreen must not bring a hidden strip back
        }
    }
    for (label, w) in app.webview_windows() {
        let gone = label.strip_prefix("strip-").and_then(|i| i.parse::<usize>().ok()).is_some_and(|i| !wanted(i));
        if gone {
            if let Ok(h) = w.hwnd() {
                ports::AppBar::remove(&n.appbar, h.0 as isize);
            }
            n.strips.lock().remove(&label);
            let _ = w.close();
        }
    }
    // A monitor change (unplugged, lid closed) lands here: `build` returns the SAME island window, so what its page
    // holds (an open card) stays; only the place, the scale and the click rectangles' mapping change (`screens` tests).
    if let Some(spot) = plan.island {
        let url = if n.quiet { "island.html?autostart=1" } else { "island.html" };
        if let Some(w) = build(app, "island", url) {
            notch_win::session::on_taskbar_created(crate::taskbar::taskbar_created);
            if let Ok(hwnd) = w.hwnd() {
                notch_win::session::watch(hwnd.0 as isize, on_session_end, on_session_lock);
            }
            let rect = spot.rect;
            let tall = n.island.lock().is_some_and(|p| p.tall); // a monitor change under an open card keeps it tall
            place(&w, notch_core::model::island_window_rect(rect, spot.scale, tall));
            let _ = w.set_ignore_cursor_events(true); // nothing is clickable until the page reports rectangles
            notch_win::style::set_island(w.hwnd().map_or(0, |h| h.0 as isize));
            *n.island.lock() = Some(IslandPlace { rect, scale: spot.scale, hwnd: w.hwnd().map_or(0, |h| h.0 as isize), hz: spot.hz, tall });
            if !FS_HIDDEN.lock().iter().any(|l| l == "island") {
                let _ = w.show();
            }
        }
    }
    notch_win::taskbar::hide_secondary(secondary && !island_only); // before `set_appbars` wakes the taskbar worker
    crate::taskbar::set_appbars(n.appbar.handles());
    fullscreen_poke(); // a strip built during fullscreen (monitor plugged in) hides at once, not after the 1 s re-check
}

pub fn shortcut_of(keys: &str) -> Option<Shortcut> {
    keys.parse::<Shortcut>().ok()
}

/// Why `keys` cannot be a global shortcut here (a message for the user), None = it can: the parser refuses it, or Ctrl+Alt+key
/// types a character through AltGr on one of the installed keyboard layouts.
pub fn shortcut_problem(keys: &str) -> Option<String> {
    if shortcut_of(keys).is_none() {
        return Some(format!("{keys} cannot be used as a shortcut."));
    }
    keys::altgr_reason(keys, notch_win::keyboard::ctrl_alt_types)
}

/// Settings > Shortcuts changed: let go of the old keys, take the new ones. If one cannot be taken (another app holds
/// it), everything goes back to the old keys and the page hears why. The spare emergency key is left as it is.
pub fn rebind(app: &AppHandle, old: &[keys::Shortcut], new: &[keys::Shortcut]) -> Result<(), String> {
    let gs = app.global_shortcut();
    for s in old {
        if let Some(k) = shortcut_of(&s.keys) {
            let _ = gs.unregister(k);
        }
    }
    let mut taken = vec![];
    for s in new {
        let Some(k) = shortcut_of(&s.keys) else { continue };
        if gs.register(k).is_err() {
            for t in taken {
                let _ = gs.unregister(t);
            }
            for s in old {
                if let Some(k) = shortcut_of(&s.keys) {
                    let _ = gs.register(k);
                }
            }
            return Err(format!("{} is already used by another app.", keys::pretty(&s.keys)));
        }
        taken.push(k);
    }
    // Everything is held again; the next foreground change lets go where an exception says so.
    if let Some(n) = app.try_state::<Notch>() {
        *n.gate.lock() = ShortcutGate::default();
    }
    Ok(())
}

/// Registers every shortcut from the settings; a failure is a notice, not a crash. True = an emergency key is held.
fn register_shortcuts(app: &AppHandle) -> bool {
    let Some(n) = app.try_state::<Notch>() else { return false };
    let list = n.settings.lock().shortcuts.clone();
    let gs = app.global_shortcut();
    let mut emergency = false;
    let island_only = n.settings.lock().island_only;
    for s in &list {
        if island_only && s.id == ShortcutId::Search {
            continue; // only opens a strip panel
        }
        // A key that types a character through AltGr here is never taken (it would eat that character).
        let why = shortcut_problem(&s.keys);
        let ok = why.is_none() && shortcut_of(&s.keys).is_some_and(|k| gs.register(k).is_ok());
        if s.id == ShortcutId::Emergency {
            emergency = ok
                || (shortcut_problem(EMERGENCY_SPARE).is_none()
                    && shortcut_of(EMERGENCY_SPARE).is_some_and(|k| gs.register(k).is_ok()));
        } else if let Some(why) = why {
            notice(app, &why);
        } else if !ok {
            notice(app, &format!("Could not register shortcut: {}", s.keys));
        }
    }
    // Fixed, not in Settings: rarely used, only for bug reports. Skipped quietly if it would break typing or is taken.
    if shortcut_problem(DIAGNOSTICS_KEYS).is_none() {
        if let Some(k) = shortcut_of(DIAGNOSTICS_KEYS) {
            let _ = gs.register(k);
        }
    }
    emergency
}

/// Island only turned on or off: Ctrl+K (search) is a strip panel, so it is let go of or taken back live.
pub fn sync_search_key(app: &AppHandle, island_only: bool) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let keys = n.settings.lock().shortcuts.iter().find(|s| s.id == ShortcutId::Search).and_then(|s| shortcut_of(&s.keys));
    let Some(keys) = keys else { return };
    let gs = app.global_shortcut();
    if island_only {
        let _ = gs.unregister(keys);
    } else {
        let _ = gs.register(keys);
        *n.gate.lock() = ShortcutGate::default(); // held again; the next foreground change lets go where an exception says so
    }
}

fn on_shortcut(app: &AppHandle, pressed: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(n) = app.try_state::<Notch>() else { return };
    if shortcut_of(DIAGNOSTICS_KEYS).as_ref() == Some(pressed) {
        let _ = crate::commands::save_diagnostics(app.clone(), n);
        return;
    }
    let spare = shortcut_of(EMERGENCY_SPARE);
    let id = n
        .settings
        .lock()
        .shortcuts
        .iter()
        .find(|s| shortcut_of(&s.keys).as_ref() == Some(pressed))
        .map(|s| s.id)
        .or_else(|| (spare.as_ref() == Some(pressed)).then_some(ShortcutId::Emergency));
    match id {
        Some(ShortcutId::Emergency) => crate::taskbar::emergency(app),
        // Rust owns the hidden state (the page reads `island_hidden`): the key toggles it.
        Some(ShortcutId::HideIsland) => crate::commands::set_island_hidden(app, !crate::commands::island_is_hidden(&n)),
        Some(id) => {
            let monitor = cursor_monitor(&n).map(|i| i.to_string()).unwrap_or_default();
            let _ = app.emit("shortcut", serde_json::json!({ "name": id, "monitor": monitor }));
        }
        None => {}
    }
}

/// The monitors that have a strip window now (labels `strip-<index>`), ascending.
fn strip_monitors(n: &Notch) -> Vec<usize> {
    let mut v: Vec<usize> =
        n.strips.lock().keys().filter_map(|l| l.strip_prefix("strip-").and_then(|i| i.parse().ok())).collect();
    v.sort_unstable();
    v
}

/// The monitor under the cursor (a shortcut opens its panel there, decision 19).
fn cursor_monitor(n: &Notch) -> Option<usize> {
    let (x, y) = notch_win::style::cursor()?;
    n.monitors.lock().iter().find(|m| m.rect.contains(x, y)).map(|m| m.index)
}

/// Shortcut exceptions: an app on a shortcut's list came to the front (or left).
fn on_foreground(app: &AppHandle, exe: &str) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let (list, island_only) = {
        let s = n.settings.lock();
        (s.shortcuts.clone(), s.island_only)
    };
    let actions = n.gate.lock().on_foreground(&list, Some(exe));
    let gs = app.global_shortcut();
    for action in actions {
        let (id, register) = match action {
            notch_core::shortcuts::GateAction::Register(id) => (id, true),
            notch_core::shortcuts::GateAction::Unregister(id) => (id, false),
        };
        if island_only && id == ShortcutId::Search {
            continue;
        }
        let Some(keys) = list.iter().find(|s| s.id == id).and_then(|s| shortcut_of(&s.keys)) else { continue };
        let _ = if register { gs.register(keys) } else { gs.unregister(keys) };
    }
}

/// The windows the fullscreen check hid (labels); `layout` leaves them hidden.
static FS_HIDDEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Wakes `fullscreen_watch` (window events, `ABN_FULLSCREENAPP`); a full channel = a check is already due.
static FS_WAKE: std::sync::OnceLock<std::sync::mpsc::SyncSender<()>> = std::sync::OnceLock::new();

fn fullscreen_poke() {
    if let Some(tx) = FS_WAKE.get() {
        let _ = tx.try_send(());
    }
}

/// Fullscreen on its own thread, so a slow status read never holds it: woken by the front window's events
/// (`notch_win::foreground::on_front_changed`), else every 1 s. A fullscreen app hides the strips on its monitor; on
/// the island's monitor the island folds to its handle (the page, from `notch://fullscreen`), or hides for
/// presentation / exclusive games (`screens::screen_plan`). Never lifts or focuses anything over the app.
fn fullscreen_watch(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let _ = FS_WAKE.set(tx);
    notch_win::foreground::on_front_changed(fullscreen_poke);
    thread::spawn(move || {
        notch_win::com();
        let mut hidden = false;
        // Scenarios 39 / 40: the strips hidden by a fullscreen app (per monitor), the last badge.
        let mut hidden_strips: Vec<usize> = vec![];
        let mut badge: Option<(usize, usize)> = None;
        // An approval over a fullscreen app drops the strips once, for 4 s (owner decision 16).
        let (mut dropped_for, mut drop_until): (Option<String>, Option<Instant>) = (None, None);
        loop {
            if rx.recv_timeout(Duration::from_secs(1)).is_ok() {
                thread::sleep(Duration::from_millis(40)); // a drag or an F11 animation sends a burst: one check
                while rx.try_recv().is_ok() {}
            }
            let Some(n) = app.try_state::<Notch>() else { continue };
            let presence = notch_win::presence::read();
            let strips = strip_monitors(&n);
            let island_monitor = n.monitors.lock().iter().find(|m| m.primary).map_or(0, |m| m.index);
            // Which screen the fullscreen app is on decides what hides (scenario 39, `screens::screen_plan`).
            let plan = notch_core::screens::screen_plan(
                presence,
                notch_win::apps::foreground_cover_monitor(),
                island_monitor,
                &strips,
            );
            let (full, handle) = (plan.island_hidden, plan.island_handle);
            let changed = {
                let mut a = n.attention.lock();
                let next = notch_core::alerts::Attention { fullscreen: full, presence: plan.island_presence, ..*a };
                std::mem::replace(&mut *a, next) != next
            };
            if changed {
                crate::live::emit_alerts(&app);
                // The attention budget also gates the plugins' protrusion and the approval drop.
                crate::plugins::emit_surfaces(&app);
            }
            if full != hidden || plan.hidden_strips != hidden_strips {
                hidden = full;
                hidden_strips = plan.hidden_strips.clone();
                let _ = app.emit("notch://fullscreen", full);
                let strips_out: Vec<String> = hidden_strips.iter().map(usize::to_string).collect();
                let _ = app.emit("fullscreen_screens", serde_json::json!({ "island": full, "strips": strips_out }));
            }
            let view = crate::live::alerts_view(&n);
            if hidden && view.drop_strip_ms.is_some() && view.top != dropped_for {
                dropped_for = view.top.clone();
                drop_until = view.drop_strip_ms.map(|ms| Instant::now() + Duration::from_millis(ms));
            }
            if drop_until.is_some_and(|t| t <= Instant::now()) {
                drop_until = None;
            }
            // The island and each strip window follow their own monitor; during an approval's drop all show.
            let want: std::collections::HashSet<String> = if drop_until.is_some() {
                Default::default()
            } else {
                hidden_strips.iter().map(|i| format!("strip-{i}")).chain((hidden && !handle).then(|| "island".to_string())).collect()
            };
            for label in &want {
                if let Some(w) = app.get_webview_window(label).filter(|w| w.is_visible().unwrap_or(false)) {
                    let _ = w.hide();
                }
            }
            let mut was = FS_HIDDEN.lock();
            for label in was.iter().filter(|l| !want.contains(*l)) {
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.show();
                }
            }
            *was = want.into_iter().collect();
            drop(was);
            // Scenario 40: an approval waits while the cursor is on another monitor: a badge on that strip.
            let approvals = view.items.iter().filter(|a| a.kind == notch_core::alerts::Kind::Approval).count();
            let next_badge =
                notch_core::screens::approval_badge(cursor_monitor(&n), island_monitor, &strips, &hidden_strips, approvals);
            if next_badge != badge {
                badge = next_badge;
                let body = badge.map(|(monitor, count)| serde_json::json!({ "monitor": monitor.to_string(), "count": count }));
                let _ = app.emit("approval_badge", body);
            }
        }
    });
}

/// One thread for the slow things: status and monitors every 2 s, windows every 12 s; alert expiry every 1 s.
/// shortcut: polled; volume is an event now (`live.rs`), network / power / windows still wait for theirs
///. Charger and low-battery alerts are judged from these status readings.
fn ticks(app: AppHandle) {
    thread::spawn(move || {
        notch_win::com();
        let mut status: Option<Status> = None;
        let mut taskbar_seen = crate::taskbar::created_at();
        for tick in 0u64.. {
            if let Some(n) = app.try_state::<Notch>() {
                if n.alerts.lock().prune(crate::live::now_ms()) {
                    crate::live::emit_alerts(&app);
                }
            }
            crate::clip_history::tick(&app);
            crate::extras::tick(&app);
            notch_win::style::keep_on_top(); // the backstop for a window that climbed over Notch without a foreground change
            if tick % 2 == 0 {
                crate::downloads::poll(&app);
                // Always on, in every taskbar mode: a guard that brings Notch back after a crash (budget in
                // `keep_guard`; the worker also asks for it before full hide).
                if !demo() {
                    notch_win::taskbar::ensure_guard();
                }
                let Some(n) = app.try_state::<Notch>() else { break };
                let now = crate::commands::status(&n);
                if status.as_ref() != Some(&now) {
                    let _ = app.emit("status_changed", &now);
                    let before = status.as_ref().and_then(|s| s.battery.as_ref());
                    crate::live::on_battery(&app, before, now.battery.as_ref());
                    status = Some(now);
                }
                // The slow safety re-scan: window events (`notch_win::flash::poke`) relist the strips at once.
                if tick % 12 == 0 {
                    let before = n.items.lock().clone();
                    if crate::commands::snapshot(&n) != before {
                        for m in n.monitors.lock().iter() {
                            let _ = app.emit("windows_changed", serde_json::json!({ "monitor": m.index.to_string() }));
                        }
                    }
                }
                let created = crate::taskbar::created_at();
                if created != taskbar_seen {
                    taskbar_seen = created;
                    n.appbar.forget(); // the new Explorer knows no AppBar: register and reserve the 30 px again
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || layout(&handle));
                }
                // A strip whose ABM_NEW was lost (Explorer busy at launch, see `tray_host`) is unreserved and maximised
                // windows go under it: try again every 3 s until each strip holds its 30 px.
                let unreserved = notch_core::brand::RESERVE_APPBAR && n.appbar.handles().len() < n.strips.lock().len();
                if notch_win::monitors::list() != *n.monitors.lock() || (unreserved && tick % 3 == 0) {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || layout(&handle));
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

/// Cursor poll for the island at the island monitor's refresh rate (`poll_interval`; `layout` re-reads
/// it on every monitor/display change): inside a clickable rectangle the window takes the mouse, outside it lets
/// clicks through. `set_ignore_cursor_events` is called only on a change.
/// The same poll sees a mouse press outside a strip (another app, the island, another strip): a strip window never
/// takes the focus, so its page gets neither the press nor a blur; `notch://outside_press` closes its open panel.
/// Payload: the monitor index of the strip pressed on, "island" = the island window, "" = anything else. The island's open card closes on every press that is not on it.
fn click_through(app: AppHandle) {
    static IGNORING: AtomicBool = AtomicBool::new(true);
    let mut was_down = false;
    let mut held = false; // a press that started on the island, until its release
    let mut strip_ignoring: HashMap<isize, bool> = HashMap::new(); // per strip window: what was last set
    thread::spawn(move || loop {
        let place = app.try_state::<Notch>().and_then(|n| *n.island.lock());
        thread::sleep(notch_core::clickthrough::poll_interval(place.map_or(60, |p| p.hz)));
        let Some(n) = app.try_state::<Notch>() else { continue };
        let Some(cursor) = notch_win::style::cursor() else { continue };
        // strips first (they work without an island): the bar and the page's rects take the mouse, the rest passes through
        let wanted: Vec<(String, isize, bool)> = n.strips.lock().iter()
            .map(|(l, s)| (l.clone(), s.hwnd, !notch_core::clickthrough::strip_captures(cursor, s.origin, s.size, s.bar, s.scale, &s.rects)))
            .collect();
        for (label, hwnd, ignore) in wanted {
            if strip_ignoring.insert(hwnd, ignore) != Some(ignore) {
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.set_ignore_cursor_events(ignore);
                }
            }
        }
        let Some(place) = place else { continue };
        let down = notch_win::style::mouse_down();
        if down && !was_down {
            let root = notch_win::style::root_at(cursor.0, cursor.1);
            let on = notch_core::clickthrough::press_target(root, place.hwnd, n.strips.lock().iter().map(|(l, s)| (l.as_str(), s.hwnd)));
            let _ = app.emit("notch://outside_press", on);
        }
        // a drag that starts on the island (the music scrubber) keeps the mouse until release: going click-through
        // mid-drag would lose the pointerup and the hover, and the progress row would fold away under the cursor
        if down && !was_down {
            held = !IGNORING.load(Ordering::SeqCst);
        }
        held &= down;
        was_down = down;
        let inside = place.rect.contains(cursor.0, cursor.1)
            && captures(cursor, (place.rect.left, place.rect.top), place.scale, &n.rects.lock());
        let ignore = !inside && !held;
        if IGNORING.swap(ignore, Ordering::SeqCst) != ignore {
            if let Some(w) = app.get_webview_window("island") {
                let _ = w.set_ignore_cursor_events(ignore);
            }
            // a click-through window gets no pointerleave, so the page's hover would stick: tell it the cursor left
            if ignore {
                let _ = app.emit("notch://island_leave", ());
            }
        }
    });
}
