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
//! (`notch_core::status::Volume`, after a captured volume key). The list lives in `notch_core::contract::EVENTS`.
//! Wave 3 (`plugins.rs`): `plugins_changed`, `consent_changed`, `plugin_surfaces_changed`, `composer_event`,
//! `plugin_stream`; the consent window loads `consent.html` (label `consent`). Wave 4: `lock_changed`
//! (`notch_core::lock::LockState`), `clip_changed` (`clip_history.rs`). Wave 5 (`extras.rs`): `privacy_changed`,
//! `input_tick`, `timer_changed`, `shelf_changed`, `shelf_drag`, `bluetooth_connected`, `music_stopped`, `download_done`, `cpu_high`, `fullscreen_screens` (`{island, strips}`: what the fullscreen app hides, per monitor), `approval_badge` (`{monitor, count}` or null: an approval waits while the cursor is on another monitor's strip). Wave 6 (`mirror.rs`): `notifications_changed`
//! (`notch_core::mirror::MirrorView`). Commands: see `commands.rs`.

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
use notch_core::shortcuts::{self as keys, ShortcutGate, ShortcutId, EMERGENCY_SPARE};
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
}

/// A strip window (label `strip-<index>`): taller than its 30 px AppBar so the panels draw under the bar, clipped to
/// the bar + what the page reported (`clickthrough::strip_region_boxes`).
#[derive(Clone, Default)]
pub struct StripPlace {
    hwnd: isize,
    scale: f64,
    /// Window size and bar height, physical px.
    size: (i32, i32),
    bar: i32,
    pub rects: Vec<CssRect>,
    /// The region last applied: an unchanged report sets nothing.
    applied: Vec<(i32, i32, i32, i32)>,
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
    pub monitors: Mutex<Vec<Monitor>>,
    /// The Start panel's last list (and when it was scanned): `launch_app` accepts these ids too.
    pub apps: Mutex<(Vec<ListedApp>, Option<Instant>)>,
    /// App id -> PNG data URL ("" = the shell had none).
    pub icons: Mutex<HashMap<String, String>>,
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
            crate::commands::set_radio,
            crate::commands::set_dnd,
            crate::commands::open_windows_settings,
            crate::commands::open_tray,
            crate::commands::tray_open,
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
            crate::commands::get_settings,
            crate::commands::set_settings,
            crate::commands::report_hit_rects,
            crate::commands::taskbar_set_mode,
            crate::commands::get_media,
            crate::commands::media_control,
            crate::commands::list_alerts,
            crate::commands::dismiss_alert,
            crate::commands::clear_alerts,
            crate::commands::open_alert,
            crate::commands::sysmon_start,
            crate::commands::sysmon_stop,
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
            crate::commands::clip_pin,
            crate::commands::clip_delete,
            crate::commands::clip_clear,
            crate::commands::clip_reveal,
            crate::commands::clip_share,
            crate::commands::clip_edit,
            crate::commands::clip_open,
            crate::commands::clip_to_shelf,
            crate::commands::clip_preview,
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
            crate::commands::timer_get,
            crate::commands::timer_start,
            crate::commands::timer_control,
            crate::commands::privacy_get,
            crate::commands::quit_app,
            crate::commands::open_start_menu,
            crate::commands::island_hide,
            crate::commands::island_hidden,
            crate::commands::tray_icons,
            crate::commands::recent_files,
            crate::commands::open_recent,
            crate::commands::start_pins,
            crate::commands::assistant_counts,
            crate::commands::assistant_open,
            crate::commands::calendar_next,
            crate::commands::claude_bridge_state,
            crate::commands::claude_bridge_install,
            crate::commands::claude_bridge_remove,
            crate::commands::cc_focus_terminal,
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
    let is_demo = args.iter().any(|a| a == "--demo");
    DEMO.store(is_demo, Ordering::SeqCst);
    if !is_demo {
        notch_win::taskbar::restore_left_behind();
    }
    let _ = APP.set(app.clone());
    let data_dir = notch_core::data_dir().ok_or("No data folder (LOCALAPPDATA)")?;
    if !is_demo {
        notch_core::migrate_data_dir(&data_dir);
    }
    let path = settings::settings_path(&data_dir);
    let quiet = !is_demo && supervise::is_autostart(&args) && path.exists();
    // Demo: defaults, never the owner's file (`load` may also move a corrupt one aside), taskbar left alone.
    let settings =
        if is_demo { Settings { taskbar_hide: HideMode::Off, ..Settings::default() } } else { settings::load(&path) };
    let mode = settings.taskbar_hide;
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
        monitors: Mutex::new(vec![]),
        apps: Mutex::new((vec![], None)),
        icons: Mutex::new(HashMap::new()),
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
        previous(info);
    }));
    layout(app);
    let emergency_key = register_shortcuts(app);
    if !is_demo {
        crate::taskbar::init(app, &data_dir, emergency_key);
        crate::taskbar::apply(mode, false);
    }
    let handle = app.clone();
    notch_win::foreground::watch(move |exe| on_foreground(&handle, &exe));
    // TODO(Wave 0 test 4): the tray path - the real hidden-icons panel moved under the strip, a tray mirror
    // (own `Shell_TrayWnd`), or a plain list - is chosen from the owner's `probe tray` result. Until
    // then `open_tray` returns the plain list (`notch_core::tray`, Wave 6) so the chevron is not dead. Its
    // "Restore taskbar" item calls `taskbar::emergency` like the Start panel and the strip's right-click.
    probe_once(app.clone());
    crate::live::start(app);
    app.manage(crate::downloads::State::default());
    crate::extras::start(app);
    crate::mirror::start(app);
    crate::plugins::start(app, data_dir.clone());
    crate::clip_history::start(app, data_dir);
    ticks(app.clone());
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
    crate::live::keys_stop();
    crate::live::http_stop(app);
    crate::mirror::clear_now(app);
    crate::plugins::stop(app);
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
        .build()
        .map_err(|e| eprintln!("[notch] {label}: {e}"))
        .ok()?;
    if let Ok(hwnd) = w.hwnd() {
        notch_win::style::no_activate(hwnd.0 as isize);
        notch_win::style::tool_window(hwnd.0 as isize); // not on the taskbar, not in Alt+Tab (skip_taskbar alone is only the taskbar)
        notch_win::style::strip_no_activate(hwnd.0 as isize); // a press on a strip or the island leaves the user's app in front
    }
    Some(w)
}

fn place(w: &WebviewWindow, r: Rect) {
    let _ = w.set_position(PhysicalPosition::new(r.left, r.top));
    let _ = w.set_size(PhysicalSize::new(r.width().max(1) as u32, r.height().max(1) as u32));
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
    let secondary = n.settings.lock().secondary_strips;
    let plan = notch_core::screens::plan_layout(&monitors, secondary);
    // Before any window is built: a strip page asks `get_monitor` as soon as it loads, and an unknown monitor left it
    // blank for good (VM run 2: 2 of 4 starts showed no strip while the island was still being built).
    *n.monitors.lock() = monitors.clone();
    let wanted = |i: usize| plan.strips.contains(&i);
    for m in monitors.iter().filter(|m| wanted(m.index)) {
        let label = format!("strip-{}", m.index);
        let Some(w) = build(app, &label, &format!("index.html?monitor={}", m.index)) else { continue };
        let Ok(hwnd) = w.hwnd().map(|h| h.0 as isize) else { continue };
        let bar = ports::reserve(&n.appbar, hwnd, m).unwrap_or_else(|| notch_core::model::strip_rect(m));
        let rect = notch_core::model::strip_window_rect(bar, m);
        place(&w, rect);
        {
            let mut strips = n.strips.lock();
            let s = strips.entry(label.clone()).or_default();
            *s = StripPlace { hwnd, scale: m.scale, size: (rect.width(), rect.height()), bar: bar.height(), applied: vec![], ..std::mem::take(s) };
        }
        apply_strip_region(app, &label); // the bar only until the page reports
        let _ = w.show();
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
    // holds (an open card) stays; only the place, the scale and the click region change (`screens` tests).
    if let Some(spot) = plan.island {
        let url = if n.quiet { "island.html?autostart=1" } else { "island.html" };
        if let Some(w) = build(app, "island", url) {
            notch_win::session::on_taskbar_created(crate::taskbar::taskbar_created);
            if let Ok(hwnd) = w.hwnd() {
                notch_win::session::watch(hwnd.0 as isize, on_session_end, on_session_lock);
            }
            let rect = spot.rect;
            place(&w, rect);
            let _ = w.set_ignore_cursor_events(true); // nothing is clickable until the page reports rectangles
            notch_win::style::set_island(w.hwnd().map_or(0, |h| h.0 as isize));
            *n.island.lock() = Some(IslandPlace { rect, scale: spot.scale, hwnd: w.hwnd().map_or(0, |h| h.0 as isize), hz: spot.hz });
            apply_region(app); // clipped to the reported shape before it is first shown
            let _ = w.show();
        }
    }
    crate::taskbar::set_appbars(n.appbar.handles());
}

/// Clips the island window to the rectangles the page reported (`clickthrough::region_boxes`): if the page's
/// transparency ever fails, the black stays inside the island instead of covering a 760x590 patch of screen. Run on
/// the main thread (the window's own); `layout` and `report_hit_rects` call it.
pub fn apply_region(app: &AppHandle) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let Some(place) = *n.island.lock() else { return };
    let boxes = notch_core::clickthrough::region_boxes(&n.rects.lock(), place.scale, (place.rect.width(), place.rect.height()));
    notch_win::style::set_region(place.hwnd, &boxes);
}

/// Clips a strip window to its bar + the rectangles its page reported. Main thread, like `apply_region`.
pub fn apply_strip_region(app: &AppHandle, label: &str) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let mut strips = n.strips.lock();
    let Some(s) = strips.get_mut(label) else { return };
    let boxes = notch_core::clickthrough::strip_region_boxes(&s.rects, s.scale, s.size, s.bar);
    if boxes != s.applied {
        notch_win::style::set_region(s.hwnd, &boxes);
        s.applied = boxes;
    }
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
    for s in &list {
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
    emergency
}

fn on_shortcut(app: &AppHandle, pressed: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(n) = app.try_state::<Notch>() else { return };
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
    let list = n.settings.lock().shortcuts.clone();
    let actions = n.gate.lock().on_foreground(&list, Some(exe));
    let gs = app.global_shortcut();
    for action in actions {
        let (id, register) = match action {
            notch_core::shortcuts::GateAction::Register(id) => (id, true),
            notch_core::shortcuts::GateAction::Unregister(id) => (id, false),
        };
        let Some(keys) = list.iter().find(|s| s.id == id).and_then(|s| shortcut_of(&s.keys)) else { continue };
        let _ = if register { gs.register(keys) } else { gs.unregister(keys) };
    }
}

/// One thread for the slow things: status and fullscreen, windows and monitors every 2 s; alert expiry every 1 s.
/// shortcut: polled; volume is an event now (`live.rs`), network / power / windows still wait for theirs
///. Charger and low-battery alerts are judged from these status readings.
fn ticks(app: AppHandle) {
    thread::spawn(move || {
        notch_win::com();
        let (mut status, mut items, mut hidden): (Option<Status>, Vec<AppItem>, bool) = (None, vec![], false);
        // Scenarios 39 / 40: the strips hidden by a fullscreen app (per monitor), the windows we hid, the last badge.
        let mut hidden_strips: Vec<usize> = vec![];
        let mut hidden_labels: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut badge: Option<(usize, usize)> = None;
        // An approval over a fullscreen app drops the strips once, for 4 s (owner decision 16).
        let (mut dropped_for, mut drop_until): (Option<String>, Option<Instant>) = (None, None);
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
                let list = crate::commands::snapshot(&n);
                if list != items {
                    for m in n.monitors.lock().iter() {
                        let _ = app.emit("windows_changed", serde_json::json!({ "monitor": m.index.to_string() }));
                    }
                    items = list;
                }
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
                let full = plan.island_hidden;
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
                    hidden_strips.iter().map(|i| format!("strip-{i}")).chain(hidden.then(|| "island".to_string())).collect()
                };
                for label in &want {
                    if let Some(w) = app.get_webview_window(label).filter(|w| w.is_visible().unwrap_or(false)) {
                        let _ = w.hide();
                    }
                }
                for label in hidden_labels.difference(&want) {
                    if let Some(w) = app.get_webview_window(label) {
                        let _ = w.show();
                    }
                }
                hidden_labels = want;
                // Scenario 40: an approval waits while the cursor is on another monitor: a badge on that strip.
                let approvals = view.items.iter().filter(|a| a.kind == notch_core::alerts::Kind::Approval).count();
                let next_badge =
                    notch_core::screens::approval_badge(cursor_monitor(&n), island_monitor, &strips, &hidden_strips, approvals);
                if next_badge != badge {
                    badge = next_badge;
                    let body = badge.map(|(monitor, count)| serde_json::json!({ "monitor": monitor.to_string(), "count": count }));
                    let _ = app.emit("approval_badge", body);
                }
                let created = crate::taskbar::created_at();
                if created != taskbar_seen {
                    taskbar_seen = created;
                    n.appbar.forget(); // the new Explorer knows no AppBar: register and reserve the 30 px again
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || layout(&handle));
                }
                if notch_win::monitors::list() != *n.monitors.lock() {
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
    thread::spawn(move || loop {
        let place = app.try_state::<Notch>().and_then(|n| *n.island.lock());
        thread::sleep(notch_core::clickthrough::poll_interval(place.map_or(60, |p| p.hz)));
        let Some(n) = app.try_state::<Notch>() else { continue };
        let Some(place) = place else { continue };
        let Some(cursor) = notch_win::style::cursor() else { continue };
        let down = notch_win::style::mouse_down();
        if down && !was_down {
            let root = notch_win::style::root_at(cursor.0, cursor.1);
            let on = notch_core::clickthrough::press_target(root, place.hwnd, n.strips.lock().iter().map(|(l, s)| (l.as_str(), s.hwnd)));
            let _ = app.emit("notch://outside_press", on);
        }
        was_down = down;
        let inside = place.rect.contains(cursor.0, cursor.1)
            && captures(cursor, (place.rect.left, place.rect.top), place.scale, &n.rects.lock());
        let ignore = !inside;
        if IGNORING.swap(ignore, Ordering::SeqCst) != ignore {
            if let Some(w) = app.get_webview_window("island") {
                let _ = w.set_ignore_cursor_events(ignore);
            }
        }
    });
}
