//! Typed commands for the UI. Names and shapes are `ui/src/bridge.ts` `Commands`; the name list lives in
//! `notch_core::contract::COMMANDS` and a test there checks it against this file's registration in `app.rs` and the
//! UI's `commands.generated.ts`.
//! The page is untrusted input: app and window actions take an id or handle and act only if it is in a list Notch
//! itself sent (`Notch::items` for the strip, `Notch::apps` for the Start panel); `open_windows_settings` takes only
//! the fixed `fidelity::SETTINGS_URIS`; `power` only the four `PowerAction`s. Nothing the page sends reaches `ShellExecute` or
//! a process as is.
//!
//! Errors (bridge.ts `CmdError`): `unknown` (not in Notch's list), `refused` (Windows said no), `invalid` (bad
//! input), `io` (the settings file could not be written), `unsupported` (this machine cannot, e.g. DDC/CI
//! brightness), `denied` (Windows denied radio access: the page opens ms-settings), `missing` (no such radio),
//! `not_yet` (Wave 0 has not picked the way yet: the tray).
//! Heavy commands (icons, Start Menu scan, WinRT, DDC/CI) are `async`: they run off the main thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use notch_core::apps::{self, AppItem, Hit, ListedApp};
use notch_core::clickthrough::{sanitize, CssRect};
pub use notch_core::cmd::CmdError;
use notch_core::cmd::{self, Route};
use notch_core::ports::{AppControl, Desktop};
use notch_core::settings::{self, HideMode, UiPatch, UiSettings};
use notch_core::status::Status;
use notch_win::apps::Win32Control;
use notch_win::power::PowerAction;
use notch_win::radios::{Kind, RadioError};
use notch_win::Win32Desktop;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app::Notch;

type Res<T> = Result<T, CmdError>;

/// The Start Menu is scanned again after this long (an app installed meanwhile shows up).
const APPS_TTL: Duration = Duration::from_secs(300);

/// bridge.ts `AppRef` / `PinnedApp`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    pub app_id: String,
    pub name: String,
    pub icon: String,
    /// Settings > Gorunum colour icons on: the same PNG in colour (`icon` is painted as a mask). Absent when off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_icon: Option<String>,
}

/// bridge.ts `WindowInfo`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub app_id: String,
    pub name: String,
    pub icon: String,
    pub hwnd: isize,
    pub title: String,
    pub active: bool,
    pub monitor: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_icon: Option<String>,
    /// Notch cannot close it (an elevated app): the menu offers "Görev Yöneticisi'ni aç" (`open_task_manager`).
    pub elevated: bool,
}

/// bridge.ts `MonitorInfo`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    id: String,
    primary: bool,
    has_battery: bool,
    radios: &'static str,
    brightness: bool,
    user: String,
    /// The monitor's refresh rate in Hz (0 = Windows did not say).
    hz: u32,
}

/// `wave4-api.ts` `SearchResult`: `kind` app | window | setting | file | plugin; `plugin` + `group` only on plugin rows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    id: String,
    kind: &'static str,
    title: String,
    subtitle: Option<String>,
    app_id: String,
    icon: String,
    hwnd: Option<isize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin: Option<notch_core::plugins::items::PluginRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
}

impl SearchResult {
    fn plain(id: String, kind: &'static str, title: String, subtitle: Option<String>) -> Self {
        let (app_id, icon) = (String::new(), String::new());
        Self { id, kind, title, subtitle, app_id, icon, hwnd: None, plugin: None, group: None }
    }
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    ok: bool,
    error: Option<String>,
}

/// The app's icon (cached per id, a miss too). COM is set up here because async commands run on pool threads.
pub(crate) fn icon(n: &Notch, app_id: &str) -> String {
    if let Some(i) = n.icons.lock().get(app_id) {
        return i.clone();
    }
    notch_win::com();
    let i = apps::launch_target(app_id).and_then(|s| notch_win::icons::icon(&s)).unwrap_or_default();
    n.icons.lock().insert(app_id.to_string(), i.clone());
    i
}

fn app_ref(n: &Notch, app_id: &str, name: &str) -> AppRef {
    let icon = icon(n, app_id);
    AppRef { app_id: app_id.to_string(), name: name.to_string(), color_icon: color(n, &icon), icon }
}

/// The colour copy of an icon, only while the setting is on (the extracted PNG is already in colour).
fn color(n: &Notch, icon: &str) -> Option<String> {
    (n.settings.lock().color_icons && !icon.is_empty()).then(|| icon.to_string())
}

/// Pins + open windows now; also what later commands are checked against.
pub fn snapshot(n: &Notch) -> Vec<AppItem> {
    let pins = n.settings.lock().pins.clone();
    let list = apps::merge(&pins, &Win32Desktop.windows());
    *n.items.lock() = list.clone();
    list
}

/// The Start panel's list, scanned again when older than `APPS_TTL`.
fn listed(n: &Notch) -> Vec<ListedApp> {
    let fresh = n.apps.lock().1.is_some_and(|t| t.elapsed() < APPS_TTL);
    if !fresh {
        notch_win::com();
        let list = notch_win::startmenu::scan();
        *n.apps.lock() = (list, Some(Instant::now()));
    }
    n.apps.lock().0.clone()
}

/// What Windows says plus Notch's own parts (DND from the settings, the cached brightness).
pub fn status(n: &Notch) -> Status {
    let mut s = notch_win::status::read();
    s.dnd = n.settings.lock().dnd;
    s.brightness = *n.brightness.lock();
    s
}

fn emit_status(app: &AppHandle, n: &Notch) {
    let _ = app.emit("status_changed", status(n));
}

/// The page's settings view: exception names and icons from the Start list where an exe matches.
pub fn ui_settings(n: &Notch) -> UiSettings {
    let s = n.settings.lock().clone();
    let apps = n.apps.lock().0.clone();
    let ui = settings::to_ui(&s, |exe| {
        apps.iter().find(|a| a.exe.as_deref() == Some(exe)).map(|a| (a.name.clone(), icon(n, &a.app_id)))
    });
    UiSettings { demo: crate::app::demo(), ..ui }
}

/// Demo mode refuses what would write to disk or touch the owner's real players, windows or notifications.
fn not_in_demo() -> Res<()> {
    if crate::app::demo() {
        Err(CmdError::Unsupported)
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn get_monitor(n: State<'_, Notch>, monitor: String) -> Res<MonitorInfo> {
    let m = n.monitors.lock().iter().find(|m| m.index.to_string() == monitor).cloned().ok_or(CmdError::Unknown)?;
    Ok(MonitorInfo {
        primary: m.primary,
        has_battery: notch_win::status::battery().is_some(),
        radios: if *n.radios_ok.lock() { "ok" } else { "denied" },
        brightness: m.primary && n.brightness.lock().is_some(),
        user: std::env::var("USERNAME").unwrap_or_default(),
        hz: m.hz,
        id: monitor,
    })
}

/// The flat per-window view of `items` for one monitor (`monitor` = its index as a string).
fn windows_on(n: &Notch, items: &[AppItem], monitor: &str, foreground: isize) -> Vec<WindowInfo> {
    items
        .iter()
        .flat_map(|i| i.windows.iter().map(move |w| (i, w)))
        .filter(|(_, w)| w.monitor.map(|m| m.to_string()).as_deref() == Some(monitor))
        .map(|(i, w)| {
            let icon = icon(n, &i.app_id);
            WindowInfo {
                app_id: i.app_id.clone(),
                name: i.name.clone(),
                color_icon: color(n, &icon),
                icon,
                hwnd: w.hwnd,
                title: w.title.clone(),
                active: w.hwnd == foreground,
                monitor: monitor.to_string(),
                elevated: w.elevated,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn list_windows(n: State<'_, Notch>, monitor: String) -> Res<Vec<WindowInfo>> {
    let items = snapshot(&n);
    Ok(windows_on(&n, &items, &monitor, notch_win::apps::foreground()))
}

#[tauri::command]
pub async fn get_pins(n: State<'_, Notch>) -> Res<Vec<AppRef>> {
    let pins = n.settings.lock().pins.clone();
    Ok(pins.iter().map(|p| app_ref(&n, &p.app_id, &p.name)).collect())
}

/// New pin order; each id must already be pinned or be in Notch's last strip list.
#[tauri::command]
pub async fn set_pins(app: AppHandle, n: State<'_, Notch>, app_ids: Vec<String>) -> Res<Vec<AppRef>> {
    let items = n.items.lock().clone();
    let next = {
        let mut s = n.settings.lock();
        let pins = cmd::pins_order(&s.pins, &items, &app_ids)?;
        let mut next = s.clone();
        next.pins = pins;
        n.save(&next).map_err(|_| CmdError::Io)?;
        *s = next.clone();
        next
    };
    let _ = app.emit("pins_changed", ());
    Ok(next.pins.iter().map(|p| app_ref(&n, &p.app_id, &p.name)).collect())
}

#[tauri::command]
pub fn activate_window(n: State<'_, Notch>, hwnd: isize) -> Res<()> {
    apps::find_window(&n.items.lock(), hwnd).ok_or(CmdError::Unknown)?;
    Win32Control.focus(hwnd).then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn close_window(n: State<'_, Notch>, hwnd: isize) -> Res<()> {
    Ok(apps::close_window(&Win32Control, &n.items.lock(), hwnd)?)
}

/// Starts an app from the strip's list or the Start panel's list.
#[tauri::command]
pub fn launch_app(n: State<'_, Notch>, app_id: String) -> Res<()> {
    let items = n.items.lock().clone();
    let apps = n.apps.lock().0.clone();
    Ok(apps::launch_any(&Win32Control, &items, &apps, &app_id)?)
}

#[tauri::command]
pub fn new_window(n: State<'_, Notch>, app_id: String) -> Res<()> {
    Ok(apps::launch(&Win32Control, &n.items.lock(), &app_id)?)
}

#[tauri::command]
pub async fn list_apps(n: State<'_, Notch>) -> Res<Vec<AppRef>> {
    Ok(listed(&n).iter().map(|a| app_ref(&n, &a.app_id, &a.name)).collect())
}

/// shortcut: queries longer than this are cut; nobody types more into Ctrl+K.
const MAX_QUERY: usize = 200;

#[tauri::command]
pub async fn search(app: AppHandle, n: State<'_, Notch>, query: String) -> Res<Vec<SearchResult>> {
    let query: String = query.chars().take(MAX_QUERY).collect();
    let q = query.trim().to_string();
    // Plugins hear the query first, so they answer while the index is read.
    let asked = if q.is_empty() { None } else { ask_plugins(&app, &q) };
    let apps = listed(&n);
    let items = snapshot(&n);
    let names: HashMap<&str, &str> = apps.iter().map(|a| (a.app_id.as_str(), a.name.as_str())).collect();
    let mut out: Vec<SearchResult> = apps::search(&query, &apps, &items)
        .into_iter()
        .filter_map(|hit| {
            let id = hit.id();
            match hit {
                Hit::App(a) => {
                    let mut r =
                        SearchResult::plain(id, "app", names.get(a.as_str())?.to_string(), Some("Uygulama".into()));
                    r.icon = icon(&n, &a);
                    r.app_id = a;
                    Some(r)
                }
                Hit::Window(h) => {
                    let (item, w) = apps::find_window(&items, h)?;
                    let mut r = SearchResult::plain(id, "window", w.title.clone(), Some(item.name.clone()));
                    r.app_id = item.app_id.clone();
                    r.icon = icon(&n, &item.app_id);
                    r.hwnd = Some(h);
                    Some(r)
                }
            }
        })
        .collect();
    if q.is_empty() {
        // Recents first (mixed kinds), then the Wave 1 suggestions.
        let mut recents = n.recents.lock().clone();
        out.retain(|o| !recents.iter().any(|r| r.id == o.id));
        recents.append(&mut out);
        out = recents;
    } else {
        for (uri, name) in notch_core::search::settings(&q, 5) {
            out.push(SearchResult::plain(format!("set:{uri}"), "setting", name.into(), Some("Windows ayarı".into())));
        }
        let sql = notch_core::search::files_sql(&q, FILES_MAX as u32).filter(|_| q.chars().count() >= 2);
        if let Some(sql) = sql.filter(|_| notch_win::winsearch::index_on()) {
            let data = n.data_dir.clone();
            for path in notch_win::winsearch::files(sql, FILES_MAX, FILES_TIMEOUT) {
                if cmd::inside_dir(&path, &data) {
                    continue; // never Notch's own files (the vault, the pano images)
                }
                let (dir, name) = match path.rsplit_once('\\') {
                    Some((d, f)) => (Some(d.to_string()), f.to_string()),
                    None => (None, path.clone()),
                };
                out.push(SearchResult::plain(format!("file:{path}"), "file", name, dir));
            }
        }
        if let Some((req, started)) = asked {
            let wait = PLUGIN_WAIT.saturating_sub(started.elapsed());
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
            let hits = app.try_state::<crate::plugins::Plugins>().map(|p| p.host.lock().search_take(req));
            for h in hits.unwrap_or_default() {
                let mut r = SearchResult::plain(format!("plg:{}:{}", h.plugin.id, h.id), "plugin", h.title, h.subtitle);
                r.group = h.group;
                r.plugin = Some(h.plugin);
                out.push(r);
            }
        }
    }
    *n.search_last.lock() = out.iter().map(|r| (r.id.clone(), r.clone())).collect();
    Ok(out)
}

/// shortcut: plugins get this long to answer a query (from when it was sent); a slower answer misses this search.
const PLUGIN_WAIT: Duration = Duration::from_millis(250);
const FILES_MAX: usize = 8;
const FILES_TIMEOUT: Duration = Duration::from_millis(1500);
const RECENTS: usize = 8;

fn ask_plugins(app: &AppHandle, q: &str) -> Option<(u64, Instant)> {
    let p = app.try_state::<crate::plugins::Plugins>()?;
    let (req, outs) = p.host.lock().search_query(q);
    let any = !outs.is_empty();
    crate::plugins::run(app, outs);
    any.then(|| (req, Instant::now()))
}

/// `search_index_state`: can the Windows Search index answer ("off" = the page shows its empty state).
#[derive(Serialize)]
pub struct IndexState {
    files: &'static str,
}

#[tauri::command]
pub async fn search_index_state() -> IndexState {
    IndexState { files: if notch_win::winsearch::index_on() { "on" } else { "off" } }
}

/// Opens a Ctrl+K result by id. Apps and windows: the same checks as `launch_app` / `activate_window`;
/// a settings page, a file or a plugin row only if Notch listed it (last search or recents); a page must also be one
/// of `search::SETTINGS` (Ctrl+K's 43). `open_windows_settings` has its own, smaller list: the 8 fixed links the
/// strip and panels draw (`fidelity::SETTINGS_URIS`), opened with no search behind them.
#[tauri::command]
pub fn search_open(app: AppHandle, n: State<'_, Notch>, id: String) -> Res<()> {
    let listed = n.search_last.lock().get(&id).cloned();
    let known = listed.or_else(|| n.recents.lock().iter().find(|r| r.id == id).cloned());
    match cmd::search_route(&id, known.is_some())? {
        Route::Setting(target) | Route::File(target) => {
            Win32Control.launch(target).then_some(()).ok_or(CmdError::Refused)?
        }
        Route::Plugin(plugin, row) => on_host(&app, |h, _| just(h.search_open(plugin, row)))?,
        Route::Hit(Hit::App(app_id)) => launch_app(n.clone(), app_id)?,
        Route::Hit(Hit::Window(hwnd)) => activate_window(n.clone(), hwnd)?,
    }
    if let Some(r) = known.filter(|r| r.kind != "plugin") {
        let mut list = n.recents.lock();
        list.retain(|x| x.id != r.id);
        list.insert(0, r);
        list.truncate(RECENTS);
    }
    Ok(())
}

/// "Asistana sor" under Ctrl+K: the query goes to the main assistant as a Ctrl+Space turn and the island opens its
/// box (`shortcut` `ask`). `not_connected` = no main assistant.
#[tauri::command]
pub fn search_ask(app: AppHandle, n: State<'_, Notch>, query: String) -> Res<Turn> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let query: String = query.chars().take(MAX_QUERY).collect();
    let turn = on_host(&app, |h, now| h.composer_submit(&query, &[], now).map(|(turn, o)| (Turn { turn }, o)))?;
    let monitor = notch_win::style::cursor()
        .and_then(|(x, y)| n.monitors.lock().iter().find(|m| m.rect.contains(x, y)).map(|m| m.index.to_string()))
        .unwrap_or_default();
    let _ = app.emit("shortcut", serde_json::json!({ "name": "ask", "monitor": monitor }));
    Ok(turn)
}

/// A Ctrl+K result: the same checks as `launch_app` / `activate_window`.
#[tauri::command]
pub fn open_result(n: State<'_, Notch>, id: String) -> Res<()> {
    match Hit::parse(&id).ok_or(CmdError::Invalid)? {
        Hit::App(app_id) => launch_app(n, app_id),
        Hit::Window(hwnd) => activate_window(n, hwnd),
    }
}

#[tauri::command]
pub async fn get_status(n: State<'_, Notch>) -> Res<Status> {
    Ok(status(&n))
}

#[tauri::command]
pub async fn set_volume(app: AppHandle, n: State<'_, Notch>, value: u8) -> Res<()> {
    if value > 100 {
        return Err(CmdError::Invalid);
    }
    notch_win::status::set_volume(value).then_some(()).ok_or(CmdError::Refused)?;
    emit_status(&app, &n);
    Ok(())
}

#[tauri::command]
pub async fn set_brightness(app: AppHandle, n: State<'_, Notch>, value: u8) -> Res<()> {
    if value > 100 {
        return Err(CmdError::Invalid);
    }
    if n.brightness.lock().is_none() {
        return Err(CmdError::Unsupported);
    }
    notch_win::brightness::set(value).then_some(()).ok_or(CmdError::Refused)?;
    *n.brightness.lock() = Some(value);
    emit_status(&app, &n);
    Ok(())
}

#[tauri::command]
pub async fn set_radio(app: AppHandle, n: State<'_, Notch>, kind: Kind, on: bool) -> Res<()> {
    notch_win::com();
    notch_win::radios::set(kind, on).map_err(|e| match e {
        RadioError::Denied => CmdError::Denied,
        RadioError::Missing => CmdError::Missing,
        RadioError::Failed => CmdError::Refused,
    })?;
    emit_status(&app, &n);
    Ok(())
}

#[tauri::command]
pub fn set_dnd(app: AppHandle, n: State<'_, Notch>, on: bool) -> Res<()> {
    {
        let mut s = n.settings.lock();
        let mut next = s.clone();
        next.dnd = on;
        n.save(&next).map_err(|_| CmdError::Io)?;
        *s = next;
    }
    emit_status(&app, &n);
    crate::live::emit_alerts(&app); // DND changes what may open the island
    crate::plugins::emit_surfaces(&app); // and whether a plugin's protrusion shows
    Ok(())
}

/// Only the strip's and panels' fixed links (`fidelity::SETTINGS_URIS`); Ctrl+K pages go through `search_open`.
#[tauri::command]
pub fn open_windows_settings(uri: String) -> Res<()> {
    let uri = notch_core::fidelity::settings_uri(&uri).ok_or(CmdError::Invalid)?;
    Win32Control.launch(uri).then_some(()).ok_or(CmdError::Refused)
}

/// PENDING Wave 0 test 4 (`probe tray`): until it picks the real hidden-icons panel or the tray mirror, the chevron
/// gets the read-only `NotifyIconSettings` list (`notch_core::tray`; no live state, no badges, no app menus) and
/// the page draws it under the strip of `monitor`. If the test picks another way, this list goes.
#[tauri::command]
pub async fn open_tray(n: State<'_, Notch>, monitor: String) -> Res<Vec<notch_core::tray::TrayIcon>> {
    let _ = monitor;
    let mut list = notch_win::tray::list();
    for t in &mut list {
        t.icon = icon(&n, &t.id);
    }
    *n.tray.lock() = list.clone();
    Ok(list)
}

/// A click in the tray list: the app's open window forward, else its exe started. Only ids `open_tray` sent.
#[tauri::command]
pub fn tray_open(n: State<'_, Notch>, id: String) -> Res<()> {
    let target = notch_core::tray::open(&n.tray.lock(), &n.items.lock(), &id).ok_or(CmdError::Unknown)?;
    let ok = match target {
        notch_core::tray::Open::Focus(hwnd) => Win32Control.focus(hwnd),
        notch_core::tray::Open::Launch(exe) => Win32Control.launch(&exe),
    };
    ok.then_some(()).ok_or(CmdError::Refused)
}

/// The UI asks first (hold-to-confirm on restart / shut down); here only the enum is accepted.
#[tauri::command]
pub fn power(action: PowerAction) -> Res<()> {
    notch_win::power::run(action).then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn restore_taskbar(app: AppHandle) {
    crate::taskbar::emergency(&app);
}

/// The UI asks first. `RunEvent::Exit` then puts the Windows taskbar back and removes the AppBars.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn get_settings(n: State<'_, Notch>) -> Res<UiSettings> {
    listed(&n);
    Ok(ui_settings(&n))
}

#[tauri::command]
pub async fn set_settings(app: AppHandle, n: State<'_, Notch>, patch: UiPatch) -> Res<SaveResult> {
    let fail = |e: String| Ok(SaveResult { ok: false, error: Some(e) });
    let apps = n.apps.lock().0.clone();
    let old = n.settings.lock().clone();
    let next = match settings::apply_patch(&old, patch, crate::app::shortcut_problem, |id| {
        apps.iter().find(|a| a.app_id == id).and_then(|a| a.exe.clone())
    }) {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    if next.shortcuts != old.shortcuts {
        if let Err(e) = crate::app::rebind(&app, &old.shortcuts, &next.shortcuts) {
            return fail(e);
        }
    }
    // The Run key changes before the file says so; a failed save puts it back.
    if next.autostart != old.autostart && !crate::app::demo() && notch_win::autostart::set(next.autostart).is_err() {
        return fail("Windows ile başlatma ayarı değiştirilemedi.".into());
    }
    // The adapter must bind before the setting says "on" (the port may be taken).
    if next.alerts_api && !old.alerts_api {
        if crate::app::demo() {
            return fail("Demo kipinde uyarı API'si açılmaz (anahtar dosyası yazılırdı).".into());
        }
        if let Err(e) = crate::live::http_start(&app) {
            return fail(e);
        }
    }
    if n.save(&next).is_err() {
        if next.shortcuts != old.shortcuts {
            let _ = crate::app::rebind(&app, &next.shortcuts, &old.shortcuts);
        }
        if next.alerts_api && !old.alerts_api {
            crate::live::http_stop(&app);
        }
        if next.autostart != old.autostart {
            let _ = notch_win::autostart::set(old.autostart);
        }
        return fail("Ayarlar kaydedilemedi.".into());
    }
    let strips_changed = next.secondary_strips != old.secondary_strips;
    let icons_changed = next.color_icons != old.color_icons;
    let clip = (next.clip_config() != old.clip_config()).then(|| next.clip_config());
    let (keys, http) = (next.capture_volume_keys, next.alerts_api);
    *n.settings.lock() = next;
    if keys != old.capture_volume_keys {
        if keys {
            crate::live::keys_start(&app);
        } else {
            crate::live::keys_stop();
        }
    }
    if !http && old.alerts_api {
        crate::live::http_stop(&app);
    }
    if let Some(cfg) = clip {
        crate::pano::configure(&app, cfg);
    }
    if strips_changed {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::app::layout(&handle));
    }
    let _ = app.emit("settings_changed", ui_settings(&n));
    if icons_changed {
        // The strips fetch pins and windows again, now with (or without) `colorIcon`.
        let _ = app.emit("pins_changed", ());
        for m in n.monitors.lock().iter() {
            let _ = app.emit("windows_changed", serde_json::json!({ "monitor": m.index.to_string() }));
        }
    }
    Ok(SaveResult { ok: true, error: None })
}

/// The page's rectangles become its window's region (island: also the click-through poll's rectangles; strip: the
/// bar is always in, `clickthrough::strip_region_boxes`).
#[tauri::command]
pub fn report_hit_rects(app: AppHandle, n: State<'_, Notch>, page: String, monitor: String, rects: Vec<CssRect>) -> Res<()> {
    let rects = sanitize(rects).ok_or(CmdError::Invalid)?;
    match page.as_str() {
        "island" => {
            *n.rects.lock() = rects;
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || crate::app::apply_region(&handle)); // the window's own thread
        }
        "strip" => {
            let label = format!("strip-{monitor}");
            n.strips.lock().get_mut(&label).ok_or(CmdError::Unknown)?.rects = rects;
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || crate::app::apply_strip_region(&handle, &label));
        }
        _ => return Err(CmdError::Invalid),
    }
    Ok(())
}

/// The taskbar mode by hand (also lifts the emergency key's "off"): Ayarlar' radio, `full` | `auto` | `off`
/// ("Windows görev çubuğu kalsın"). The page reads the current one as `taskbarHide` in the settings.
#[tauri::command]
pub fn taskbar_set_mode(app: AppHandle, n: State<'_, Notch>, mode: HideMode) -> Res<()> {
    not_in_demo()?; // demo never hides the taskbar: hiding needs the crash marker on disk
    n.set_hide_mode(mode).map_err(|_| CmdError::Io)?;
    crate::taskbar::apply(mode, true);
    let _ = app.emit("settings_changed", ui_settings(&n));
    Ok(())
}

#[tauri::command]
pub fn get_media(n: State<'_, Notch>) -> Option<notch_core::media::Media> {
    n.media.lock().clone()
}

/// Play/pause, next, previous, seek (`positionMs`) on the session Notch shows. `refused` = no session or the player
/// said no; `invalid` = seek without a position.
#[tauri::command]
pub async fn media_control(action: notch_core::media::MediaAction, position_ms: Option<u64>) -> Res<()> {
    if action == notch_core::media::MediaAction::Seek && position_ms.is_none() {
        return Err(CmdError::Invalid);
    }
    not_in_demo()?;
    notch_win::media::control(action, position_ms).then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn list_alerts(n: State<'_, Notch>) -> notch_core::alerts::AlertsView {
    crate::live::alerts_view(&n)
}

#[tauri::command]
pub fn dismiss_alert(app: AppHandle, n: State<'_, Notch>, id: String) -> Res<()> {
    if !n.alerts.lock().remove(&id) {
        return Err(CmdError::Unknown);
    }
    crate::live::emit_alerts(&app);
    Ok(())
}

/// The Notifications list's "clear all": every item, Notch's own too.
#[tauri::command]
pub fn clear_alerts(app: AppHandle, n: State<'_, Notch>) {
    if n.alerts.lock().clear(None) {
        crate::live::emit_alerts(&app);
    }
    if crate::mirror::get(&app).is_some_and(|m| m.store.lock().clear()) {
        crate::mirror::emit(&app); // the mirrored Windows notifications are in the same list on screen
    }
}

/// The owner clicked an alert's "Aç": the page sends only the id; a stored link is checked again (http(s) only)
/// and opened by Windows, the Task Manager action starts `Taskmgr.exe` by its full path (no arguments). `unknown` =
/// no such alert or it has no action.
#[tauri::command]
pub fn open_alert(n: State<'_, Notch>, id: String) -> Res<()> {
    use notch_core::alerts::Action;
    let action = n.alerts.lock().get(&id).and_then(|a| a.action.clone()).ok_or(CmdError::Unknown)?;
    let target = match action {
        Action::Link(link) => {
            notch_core::alerts::web_link(&serde_json::Value::String(link)).ok_or(CmdError::Invalid)?
        }
        Action::TaskManager => return open_task_manager(),
    };
    Win32Control.launch(&target).then_some(()).ok_or(CmdError::Refused)
}

/// Tab order between Notch's own windows: `label` takes the keyboard focus only while a Notch window already holds
/// it, so the focus is never taken from another app; `refused` otherwise, `unknown` = no such window.
fn focus_own(app: &AppHandle, label: &str) -> Res<()> {
    let target = app.get_webview_window(label).ok_or(CmdError::Unknown)?;
    let fg = notch_win::apps::foreground();
    let ours = app.webview_windows().values().any(|w| w.hwnd().is_ok_and(|h| h.0 as isize == fg));
    if !ours {
        return Err(CmdError::Refused);
    }
    if let Ok(h) = target.hwnd() {
        notch_win::style::typing_begin(h.0 as isize, fg, true); // Tab between Notch windows is keyboard use: this one may activate
    }
    target.set_focus().map_err(|_| CmdError::Refused)
}

/// The island's Tab past its last control: the strip of `monitor` takes the focus.
#[tauri::command]
pub fn focus_strip(app: AppHandle, monitor: String) -> Res<()> {
    focus_own(&app, &format!("strip-{monitor}"))
}

/// A panel that needs typing (Search on a strip, the composer on the island) is open (`on`) or closed: while open its
/// window may take the keyboard focus; closing hands the focus back to the app that was in front.
/// `label` is `island` or `strip-<monitor>`; `unknown` for anything else.
#[tauri::command]
pub fn typing_focus(app: AppHandle, label: String, on: bool) -> Res<()> {
    if label != "island" && !label.starts_with("strip-") {
        return Err(CmdError::Unknown);
    }
    let w = app.get_webview_window(&label).ok_or(CmdError::Unknown)?;
    let hwnd = w.hwnd().map_err(|_| CmdError::Refused)?.0 as isize;
    if on {
        let ours = |fg: isize| app.webview_windows().values().any(|w| w.hwnd().is_ok_and(|h| h.0 as isize == fg));
        notch_win::style::typing_focus_in(hwnd, ours);
        w.set_focus().map_err(|_| CmdError::Refused)
    } else {
        notch_win::style::typing_focus_out(hwnd);
        Ok(())
    }
}

/// The strip's Tab back: the island (one for every monitor) takes the focus.
#[tauri::command]
pub fn focus_island(app: AppHandle) -> Res<()> {
    focus_own(&app, "island")
}

/// "Görev Yöneticisi'ni aç" (an elevated window's menu, an alert's button): `Taskmgr.exe` by its full path, no
/// arguments.
#[tauri::command]
pub fn open_task_manager() -> Res<()> {
    let exe = notch_win::system_exe("Taskmgr.exe").ok_or(CmdError::Refused)?;
    Win32Control.launch(&exe).then_some(()).ok_or(CmdError::Refused)
}

/// The system monitor card opened: one `sysmon_tick` a second until `sysmon_stop` (a second start is harmless).
#[tauri::command]
pub fn sysmon_start(app: AppHandle) {
    notch_win::sysmon::start(move |t| {
        let _ = app.emit("sysmon_tick", t);
    });
}

#[tauri::command]
pub fn sysmon_stop() {
    notch_win::sysmon::stop();
}

/* ---------- plugins (Wave 3; shapes: ui/src/plugin-api.ts, rules: notch_core::plugins) ---------- */

use notch_core::plugins::host::{
    AttachKind, Attachment, Decision, Host, ModuleEntry, OwnerErr, PluginInfo, Surface, SurfacesView,
};
use notch_core::plugins::Scope;

/// One owner action on the host, then its outputs run (the host lock is released first).
fn on_host<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut Host, u64) -> Result<(T, Vec<notch_core::plugins::host::Out>), OwnerErr>,
) -> Res<T> {
    let p = app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?;
    let (value, outs) = {
        let mut h = p.host.lock();
        f(&mut h, crate::live::now_ms())?
    };
    crate::plugins::run(app, outs);
    Ok(value)
}

fn just(
    outs: Result<Vec<notch_core::plugins::host::Out>, OwnerErr>,
) -> Result<((), Vec<notch_core::plugins::host::Out>), OwnerErr> {
    outs.map(|o| ((), o))
}

#[tauri::command]
pub fn plugin_surfaces(app: AppHandle) -> Res<SurfacesView> {
    crate::plugins::surfaces(&app).ok_or(CmdError::Unknown)
}

/// A plugin's button (protrusion or Modules tab); ignored within ~300 ms of the item changing.
#[tauri::command]
pub fn plugin_action(app: AppHandle, plugin_id: String, action_id: String) -> Res<()> {
    on_host(&app, |h, now| just(h.action(&plugin_id, &action_id, now)))
}

/// `surface` (extra, optional): "protrusion" when the click came from the protrusion row; at high risk Rust then
/// refuses everything (only "Ayrıntı" may be there). Missing = the card.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn approval_answer(
    app: AppHandle,
    plugin_id: String,
    id: String,
    decision: Decision,
    choice_id: Option<String>,
    text: Option<String>,
    surface: Option<Surface>,
) -> Res<()> {
    on_host(&app, |h, now| {
        just(h.approval_respond(
            &plugin_id,
            &id,
            decision,
            choice_id.as_deref(),
            text.as_deref(),
            surface.unwrap_or(Surface::Card),
            now,
        ))
    })
}

#[derive(Serialize)]
pub struct Turn {
    turn: u64,
}

/// Ctrl+Space's box to the main assistant. The page sends only each attachment's kind; Rust resolves it from what
/// Notch itself holds (`fidelity::resolve`: the owner's scans and picked files, the newest pano link, the shelf).
/// `not_connected` = nobody to send to ("Asistan bağlı değil"); `not_yet` for `window_image`; `invalid` for a kind
/// with nothing behind it.
#[tauri::command]
pub fn composer_submit(
    app: AppHandle,
    n: State<'_, Notch>,
    text: String,
    attachments: Vec<notch_core::fidelity::UiAttachment>,
) -> Res<Turn> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    use notch_core::fidelity::UiAttachKind;
    // The shelf goes as one-shot copies, made only once a main assistant is there to send them to.
    let shelf: Vec<String> = if attachments.iter().any(|a| a.kind == UiAttachKind::Shelf) {
        let main = main_holds(&app, None)?;
        let ids: Vec<String> = extras(&app)?.shelf.lock().list().into_iter().map(|i| i.id).collect();
        cmd::shelf_copies(main, ids.iter().map(String::as_str), |id| shelf_copy(&app, id))?
    } else {
        vec![]
    };
    let link = app
        .try_state::<crate::plugins::Plugins>()
        .and_then(|p| notch_core::fidelity::newest_link(&p.host.lock().clipboard).map(str::to_string));
    let mut pending = n.composer_files.lock().clone();
    let list = notch_core::fidelity::resolve(&attachments, &mut pending, link.as_deref(), &shelf)?;
    let turn = on_host(&app, |h, now| h.composer_submit(&text, &list, now).map(|(turn, o)| (Turn { turn }, o)))?;
    *n.composer_files.lock() = pending; // what was sent is used up; the rest waits for the next turn
    Ok(turn)
}

#[tauri::command]
pub fn composer_voice(app: AppHandle) -> Res<()> {
    on_host(&app, |h, _| just(h.composer_voice()))
}

/// The consent window's content; the first call starts the 300 ms guard and the 2 minutes.
#[tauri::command]
pub fn consent_get(app: AppHandle) -> Res<Option<notch_core::plugins::consent::ConsentView>> {
    on_host(&app, |h, now| Ok((h.consent_get(now), vec![])))
}

/// `ignored` = within 300 ms of display (the window stays). Unknown scope names are dropped; only requested scopes
/// can be granted, high ones only when listed here.
#[tauri::command]
pub fn consent_answer(
    app: AppHandle,
    request_id: String,
    allow: bool,
    scopes: Vec<String>,
    main_assistant: bool,
    never: bool,
) -> Res<()> {
    let request: u64 = request_id.parse().map_err(|_| CmdError::Invalid)?;
    let scopes: Vec<Scope> = scopes.iter().filter_map(|s| Scope::parse(s)).collect();
    on_host(&app, |h, now| just(h.consent_respond(request, allow, Some(&scopes), main_assistant, never, now)))
}

#[tauri::command]
pub fn plugin_list(app: AppHandle) -> Res<Vec<PluginInfo>> {
    on_host(&app, |h, now| Ok((h.plugin_list(now), vec![])))
}

#[tauri::command]
pub fn plugin_set_scope(app: AppHandle, id: String, scope: String, on: bool) -> Res<()> {
    let scope = Scope::parse(&scope).ok_or(CmdError::Invalid)?;
    on_host(&app, |h, now| just(h.set_scope(&id, scope, on, now)))
}

#[tauri::command]
pub fn plugin_set_main(app: AppHandle, id: Option<String>) -> Res<()> {
    on_host(&app, |h, _| just(h.set_main(id.as_deref())))
}

#[tauri::command]
pub fn plugin_disconnect(app: AppHandle, id: String) -> Res<()> {
    on_host(&app, |h, _| just(h.disconnect_plugin(&id)))
}

/// "Kaldır": the token digest goes and its connection closes at once.
#[tauri::command]
pub fn plugin_remove(app: AppHandle, id: String) -> Res<()> {
    on_host(&app, |h, now| just(h.revoke(&id, now)))
}

#[tauri::command]
pub fn modules_get(app: AppHandle) -> Res<Vec<ModuleEntry>> {
    on_host(&app, |h, _| Ok((h.modules_get(), vec![])))
}

#[tauri::command]
pub fn modules_set(app: AppHandle, order: Vec<String>, off: Vec<String>) -> Res<()> {
    on_host(&app, |h, _| just(h.modules_set(order, off)))
}

/* ---------- Wave 4: Notch's lock and the pano's capture exclusion ---------- */

#[tauri::command]
pub fn lock_state(app: AppHandle) -> notch_core::lock::LockState {
    app.try_state::<crate::plugins::Plugins>()
        .map(|p| p.host.lock().lock_state())
        .unwrap_or(notch_core::lock::LockState { locked: false, reason: None })
}

/// The owner's "Kilitle".
#[tauri::command]
pub fn lock_now(app: AppHandle) {
    crate::plugins::lock(&app, notch_core::lock::Reason::Manual, true);
}

/// The owner's click in Notch: lifts "Kilitle" and `lock.signal`; a Windows lock stays until Windows unlocks.
#[tauri::command]
pub fn lock_release(app: AppHandle) -> Res<()> {
    let p = app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?;
    let outs = p.host.lock().lock_release();
    crate::plugins::run(&app, outs);
    Ok(())
}

/// The pano card or the Pano tab is about to draw (`on: true`, the page awaits this before its first frame) or has
/// gone (`on: false`). Sync, so it runs on the main thread that owns the island window. Returns whether the island
/// is excluded from capture now (false = Windows refused: the page may still draw, a known limit).
#[tauri::command]
pub fn clip_visible(app: AppHandle, n: State<'_, Notch>, on: bool) -> bool {
    let hwnd = app.get_webview_window("island").and_then(|w| w.hwnd().ok()).map_or(0, |h| h.0 as isize);
    let a = notch_win::capture::IslandAffinity(hwnd);
    let mut g = n.capture.lock();
    if on {
        g.open(&a)
    } else {
        g.close(&a);
        g.is_open()
    }
}

/* ---------- Wave 4: the pano (shapes: ui/src/wave4-api.ts; rules: notch_core::clip) ---------- */

use notch_core::clip::ItemView;

fn pano(app: &AppHandle) -> Res<tauri::State<'_, crate::pano::PanoState>> {
    app.try_state::<crate::pano::PanoState>().ok_or(CmdError::Unknown)
}

#[tauri::command]
pub fn clip_list(app: AppHandle) -> Res<Vec<ItemView>> {
    let hide = crate::pano::hide_passwords(&app);
    Ok(pano(&app)?.pano.lock().list(hide))
}

/// Copy-back: a password without revealing it (never while locked); every write carries the "keep out of
/// history / cloud / monitors" formats.
#[tauri::command]
pub async fn clip_copy(app: AppHandle, id: String) -> Res<()> {
    let locked = crate::plugins::locked(&app);
    let payload = pano(&app)?.pano.lock().payload(&id, locked, &notch_win::dpapi::Dpapi)?;
    if !notch_win::clipboard::write(&payload) {
        return Err(CmdError::Refused);
    }
    drop(payload); // a password's plaintext is zeroed here
    let change = pano(&app)?.pano.lock().bump(&id, crate::live::now_ms());
    crate::pano::emit(&app, change.into_iter().collect());
    Ok(())
}

#[tauri::command]
pub fn clip_pin(app: AppHandle, id: String, on: bool) -> Res<()> {
    let change = pano(&app)?.pano.lock().pin(&id, on)?;
    crate::pano::emit(&app, vec![change]);
    Ok(())
}

#[tauri::command]
pub fn clip_delete(app: AppHandle, id: String) -> Res<()> {
    let change = pano(&app)?.pano.lock().delete(&id)?;
    crate::pano::emit(&app, vec![change]);
    Ok(())
}

/// "Hepsini sil" (the password file too); `passwords: true` = Settings › Pano's "Parolaları hepsini sil".
#[tauri::command]
pub fn clip_clear(app: AppHandle, passwords: Option<bool>) -> Res<()> {
    let change = pano(&app)?.pano.lock().clear(passwords.unwrap_or(false));
    crate::pano::emit(&app, vec![change]);
    Ok(())
}

/// `wave4-api.ts` `ClipReveal`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipReveal {
    text: String,
    ttl_ms: u64,
}

/// The eye button: the plaintext for at most 5 s. Refused (`denied`) while Notch is locked.
#[tauri::command]
pub async fn clip_reveal(app: AppHandle, id: String) -> Res<ClipReveal> {
    let locked = crate::plugins::locked(&app);
    let secret = pano(&app)?.pano.lock().reveal(&id, locked, &notch_win::dpapi::Dpapi)?;
    let text = String::from_utf8_lossy(secret.bytes()).into_owned();
    Ok(ClipReveal { text, ttl_ms: notch_core::clip::REVEAL_MS })
}

/// "Asistana sor": the one item to the main assistant only (one-shot share, no scope). `denied` on a
/// password item, `not_connected` without a main assistant.
#[tauri::command]
pub fn clip_share(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let attachments = pano(&app)?.pano.lock().share(&id)?;
    on_host(&app, |h, now| h.composer_submit("", &attachments, now).map(|(_, o)| ((), o)))
}

/// A screenshot (any image item) opens in Windows's default app for it.
#[tauri::command]
pub fn clip_edit(app: AppHandle, id: String) -> Res<()> {
    let path = pano(&app)?.pano.lock().image_path(&id)?;
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// Open the clip with its default app: an image through a temp copy, a file item's first file. `denied` while
/// locked, for a password and for a file Windows would run.
#[tauri::command]
pub fn clip_open(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = pano(&app)?.pano.lock().open_path(&id, false, &crate::pano::temp_open())?;
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// An image or file clip onto the shelf (`shelf_changed`); text and passwords do not go.
#[tauri::command]
pub fn clip_to_shelf(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let items = pano(&app)?.pano.lock().shelf_sources(&id, false, &crate::pano::temp_shelf())?;
    if extras(&app)?.shelf.lock().add(items) {
        let _ = app.emit("shelf_changed", ());
    }
    Ok(())
}

/// The big preview of an image clip: a PNG data URL, 1024 px on the longer side at most. Async: the decode runs off
/// the main thread.
#[tauri::command]
pub async fn clip_preview(app: AppHandle, id: String) -> Res<String> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = pano(&app)?.pano.lock().image_path(&id)?;
    let png = std::fs::read(path).map_err(|_| CmdError::Io)?;
    let preview = notch_win::clip_image::preview_png(&png, 1024).ok_or(CmdError::Io)?;
    Ok(notch_core::clip::data_url(&preview))
}

/// Drag out (image and file items). Sync: Windows's drag loop runs on the UI thread that got the mouse press and
/// returns when the drop ends. `refused` = nothing was dropped.
#[tauri::command]
pub fn clip_drag(app: AppHandle, id: String) -> Res<()> {
    let paths = pano(&app)?.pano.lock().drag_paths(&id)?;
    let dropped = notch_win::drag::files(&paths);
    let _ = app.emit("clip_drag_end", ()); // dropped or given up: the page shows the source again
    dropped.then_some(()).ok_or(CmdError::Refused)
}

/* ---------- Peeka Faz C: downloads (rules: notch_core::downloads, state: downloads.rs) ---------- */

fn download_file(app: &AppHandle, id: &str) -> Res<PathBuf> {
    crate::downloads::file(app, id).ok_or(CmdError::Missing)
}

/// "Aç" on a finished download, with its default app. Not for a file Windows would run (`denied`: the owner finds it
/// with "Klasörde göster"). `missing` = not an id Notch announced, or the file is gone.
#[tauri::command]
pub fn download_open(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = download_file(&app, &id)?;
    if notch_core::shelf::runnable(&path) {
        return Err(CmdError::Denied);
    }
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// "Klasörde göster": Explorer with the finished download selected.
#[tauri::command]
pub fn download_show_in_folder(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = download_file(&app, &id)?;
    notch_win::downloads::show_in_folder(&path).then_some(()).ok_or(CmdError::Refused)
}

/* ---------- Wave 5 (shapes: ui/src/bridge.ts, Wave 5 block; rules: notch_core::{preview, shelf, timer}) ---------- */

use notch_core::preview::Plan;
use notch_core::shelf::{ShareTarget, ShelfItem};
use notch_core::timer::{TimerAction, TimerState};

fn extras(app: &AppHandle) -> Res<tauri::State<'_, crate::extras::Extras>> {
    crate::extras::extras(app).ok_or(CmdError::Unknown)
}

/// A window from Notch's own list as a PNG data URL (`unknown` for any other handle, `refused` when Windows would
/// not draw it, `missing` when it is minimised and was never seen). Async: off the main thread.
#[tauri::command]
pub async fn window_preview(app: AppHandle, n: State<'_, Notch>, hwnd: isize) -> Res<String> {
    apps::find_window(&n.items.lock(), hwnd).ok_or(CmdError::Unknown)?;
    let x = extras(&app)?;
    let _one = x.capturing.lock();
    let now = crate::live::now_ms();
    let plan = x.previews.lock().plan(hwnd, notch_win::preview::minimised(hwnd), now);
    match plan {
        Plan::Cached(png) => Ok(png),
        Plan::Nothing => Err(CmdError::Missing),
        Plan::Capture => {
            let png = notch_win::preview::capture(hwnd).ok_or(CmdError::Refused)?;
            let items = n.items.lock().clone();
            let mut p = x.previews.lock();
            p.retain(|h| apps::find_window(&items, h).is_some());
            p.store(hwnd, png.clone(), now);
            Ok(png)
        }
    }
}

/// What `share_open` would hand Windows: a shelf item's file, or a pano item (`denied` for a password, `unknown`
/// for an id Notch did not list).
fn share_target(app: &AppHandle, id: &str) -> Res<(String, ShareTarget)> {
    if let Some(p) = extras(app)?.shelf.lock().path(id) {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Ok((name, ShareTarget::Files(vec![p.to_path_buf()])));
    }
    let target = pano(app)?.pano.lock().share_sheet(id)?;
    Ok((notch_core::PRODUCT_NAME.to_string(), target))
}

/// The Windows share sheet for a shelf or pano item; `denied` while Notch is locked. Sync: the sheet belongs to the
/// island window's (main) thread.
#[tauri::command]
pub fn share_open(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let (title, target) = share_target(&app, &id)?;
    let hwnd = app.get_webview_window("island").and_then(|w| w.hwnd().ok()).ok_or(CmdError::Unknown)?.0 as isize;
    notch_win::share::open(hwnd, &title, target).then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn shelf_list(app: AppHandle) -> Res<Vec<ShelfItem>> {
    Ok(extras(&app)?.shelf.lock().list())
}

/// The shelf file to the main assistant only (one-shot share) as a copy (`shelf_copy`);
/// `not_connected` without one (checked before copying).
#[tauri::command]
pub fn shelf_ask(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let copies = cmd::shelf_copies(main_holds(&app, None)?, [id.as_str()], |id| shelf_copy(&app, id))?;
    let path = copies.into_iter().next().ok_or(CmdError::NotConnected)?;
    let attachments = vec![notch_core::plugins::host::Attachment {
        kind: notch_core::plugins::host::AttachKind::Rack,
        path: Some(path),
        text: None,
    }];
    on_host(&app, |h, now| h.composer_submit("", &attachments, now).map(|(_, o)| ((), o)))
}

#[tauri::command]
pub fn timer_get(app: AppHandle) -> Res<Option<TimerState>> {
    Ok(extras(&app)?.timer.lock().as_ref().map(|t| t.view(crate::live::now_ms())))
}

/// A new timer (replaces a running one). `invalid` = 0 s or over 24 h; the label is trimmed and cut to 40 chars
/// (`Timer::start`).
#[tauri::command]
pub fn timer_start(app: AppHandle, label: String, seconds: u64) -> Res<TimerState> {
    let now = crate::live::now_ms();
    let t = notch_core::timer::Timer::start(&label, seconds, now).ok_or(CmdError::Invalid)?;
    let view = t.view(now);
    *extras(&app)?.timer.lock() = Some(t);
    crate::extras::emit_timer(&app);
    Ok(view)
}

/// pause | resume | add5 | stop; `unknown` with no timer running.
#[tauri::command]
pub fn timer_control(app: AppHandle, action: TimerAction) -> Res<()> {
    {
        let x = extras(&app)?;
        let mut t = x.timer.lock();
        let keep = t.as_mut().ok_or(CmdError::Unknown)?.apply(action, crate::live::now_ms());
        if !keep {
            *t = None;
        }
    }
    crate::extras::emit_timer(&app);
    Ok(())
}

#[tauri::command]
pub fn privacy_get(app: AppHandle) -> Res<notch_core::privacy::PrivacyState> {
    Ok(extras(&app)?.privacy.lock().clone())
}

/* ---------- Windows notification mirror (Wave 6; rules: notch_core::mirror, state: mirror.rs) ---------- */

use notch_core::mirror::{MirrorState, MirrorView};

#[tauri::command]
pub async fn mirror_state(app: AppHandle) -> Res<MirrorState> {
    Ok(crate::mirror::state(&app))
}

/// The owner turned the mirror on: Windows's access prompt (first time), then the poll. Always the new state: a
/// `blocker` says why it is still off (Developer Mode, the package, Windows's no). Never registers a package.
#[tauri::command]
pub async fn mirror_enable(app: AppHandle) -> Res<MirrorState> {
    not_in_demo()?;
    crate::mirror::set(&app, true).map_err(|_| CmdError::Io)
}

/// Off: the poll stops and the list is forgotten.
#[tauri::command]
pub async fn mirror_disable(app: AppHandle) -> Res<MirrorState> {
    crate::mirror::set(&app, false).map_err(|_| CmdError::Io)
}

#[tauri::command]
pub fn mirror_list(app: AppHandle) -> Res<MirrorView> {
    Ok(crate::mirror::view(&app))
}

/// Gone from Notch's list only (Windows's Notification Center keeps it).
#[tauri::command]
pub fn mirror_dismiss(app: AppHandle, id: String) -> Res<()> {
    let m = crate::mirror::get(&app).ok_or(CmdError::Unknown)?;
    if !m.store.lock().remove(&id) {
        return Err(CmdError::Unknown);
    }
    crate::mirror::emit(&app);
    Ok(())
}

/// "Uygulamayı aç": the sender's app through `shell:AppsFolder\<its app id>`; the page sends only the card id.
/// The card leaves the list (the owner acted on it).
#[tauri::command]
pub fn mirror_open_app(app: AppHandle, id: String) -> Res<()> {
    let m = crate::mirror::get(&app).ok_or(CmdError::Unknown)?;
    let target = m.store.lock().open_target(&id).ok_or(CmdError::Unknown)?;
    Win32Control.launch(&target).then_some(()).ok_or(CmdError::Refused)?;
    m.store.lock().remove(&id);
    crate::mirror::emit(&app);
    Ok(())
}

/// "Asistan yanıtlasın": this one notification's text, once, to the main assistant only (one-shot share,
/// the same path as Ctrl+Space). `not_connected` without one, `denied` while Notch is locked.
/// "Kodu kopyala" on a mirrored notification that has a one-time code (`hasCode`): the code goes on the clipboard with
/// the same "keep out of history / cloud / monitors" markers as a password, never into Notch's own pano, and leaves it
/// after 60 s if nothing else was copied meanwhile (`mirror::tick`). `denied` while Notch is locked; `missing` for an
/// id Notch does not list or one without a code. The code is never logged and never returned to the page.
#[tauri::command]
pub fn notif_copy_code(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let m = crate::mirror::get(&app).ok_or(CmdError::Unknown)?;
    let code = m.store.lock().code(&id).ok_or(CmdError::Missing)?;
    let seq = notch_win::clipboard::write_seq(&notch_core::clip::Payload::Text(code)).ok_or(CmdError::Refused)?;
    m.clear.lock().arm(seq, crate::live::now_ms());
    Ok(())
}

#[tauri::command]
pub fn mirror_ask(app: AppHandle, id: String) -> Res<Turn> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let text =
        crate::mirror::get(&app).ok_or(CmdError::Unknown)?.store.lock().ask_text(&id).ok_or(CmdError::Unknown)?;
    on_host(&app, |h, now| h.composer_submit(&text, &[], now).map(|(turn, o)| (Turn { turn }, o)))
}

/* ---------- Sadakat 3 (shapes: ui/src/fidelity-api.ts, fidelity-cards-api.ts, bridge.ts "SADAKAT BLOĞU") ---------- */

/// "Uygulamadan çık": `WM_CLOSE` to every window of an app in Notch's last strip list (the app may still ask to
/// save; nothing is killed). `unknown` for any other id.
#[tauri::command]
pub fn quit_app(n: State<'_, Notch>, app_id: String) -> Res<()> {
    Ok(apps::close_app(&Win32Control, &n.items.lock(), &app_id)?)
}

/// "Windows Başlat'ı aç": the Windows key, as if pressed.
#[tauri::command]
pub fn open_start_menu() -> Res<()> {
    notch_win::press_windows_key().then_some(()).ok_or(CmdError::Refused)
}

/// The island is hidden for an hour (`on`) or back now; also Ctrl+Shift+A (`app::on_shortcut`).
pub fn set_island_hidden(app: &AppHandle, on: bool) {
    let Some(n) = app.try_state::<Notch>() else { return };
    *n.island_hidden.lock() = on.then(|| crate::live::now_ms() + notch_core::fidelity::HIDE_MS);
    let _ = app.emit("island_hidden_changed", on);
}

pub fn island_is_hidden(n: &Notch) -> bool {
    notch_core::fidelity::island_hidden(*n.island_hidden.lock(), crate::live::now_ms())
}

/// The hour is up: the island comes back by itself (called from the plugin tick, once a second).
pub fn island_hide_expire(app: &AppHandle) {
    let Some(n) = app.try_state::<Notch>() else { return };
    let until = *n.island_hidden.lock(); // copied out: `island_is_hidden` would lock the same mutex again
    if until.is_some() && !notch_core::fidelity::island_hidden(until, crate::live::now_ms()) {
        set_island_hidden(app, false);
    }
}

#[tauri::command]
pub fn island_hide(app: AppHandle, on: bool) {
    set_island_hidden(&app, on);
}

#[tauri::command]
pub fn island_hidden(n: State<'_, Notch>) -> bool {
    island_is_hidden(&n)
}

/// fidelity-api.ts `TrayIconX`: `open_tray`'s list plus the colour icon while the setting is on. No `badge`:
/// `NotifyIconSettings` has no count, and Notch does not guess one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayIconX {
    #[serde(flatten)]
    icon: notch_core::tray::TrayIcon,
    #[serde(skip_serializing_if = "Option::is_none")]
    color_icon: Option<String>,
}

#[tauri::command]
pub async fn tray_icons(n: State<'_, Notch>, monitor: String) -> Res<Vec<TrayIconX>> {
    let list = open_tray(n.clone(), monitor).await?;
    Ok(list.into_iter().map(|t| TrayIconX { color_icon: color(&n, &t.icon), icon: t }).collect())
}

/// Başlat "Önerilenler": the newest files in the owner's Recent folder (`shell:recent`, its `.lnk` files only;
/// read, never changed). The page gets names and ages, never a path.
#[tauri::command]
pub async fn recent_files(n: State<'_, Notch>) -> Res<Vec<notch_core::fidelity::RecentItem>> {
    let dir = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(r"Microsoft\Windows\Recent"));
    let lnks = dir
        .and_then(|d| std::fs::read_dir(d).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let t = e.metadata().ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
            Some((e.path(), t.as_millis() as u64))
        })
        .collect();
    let (rows, paths) = notch_core::fidelity::recent(lnks, crate::live::now_ms());
    *n.recent.lock() = paths;
    Ok(rows)
}

/// Opens a row of the last `recent_files` list (its shortcut, so Windows picks the app). `unknown` otherwise.
#[tauri::command]
pub fn open_recent(n: State<'_, Notch>, id: String) -> Res<()> {
    let path = notch_core::fidelity::recent_target(&n.recent.lock(), &id).ok_or(CmdError::Unknown)?.to_path_buf();
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// Başlat's 12 pins. shortcut: Windows 11 keeps its Start pins in an undocumented binary (`start2.bin`) Notch
/// cannot read, so the list is always empty and the page falls back to its own (strip pins + apps); read it here
/// if Windows ever offers an API.
#[tauri::command]
pub fn start_pins() -> Vec<AppRef> {
    vec![]
}

/* ---------- Sadakat 3: what the main assistant provides (rules: notch_core::plugins::host::assistant) ---------- */

use notch_core::plugins::host::{AssistantCounts, BridgeState, CalendarNext, OpenKind};
use notch_core::plugins::registry::PermissionEvent;

/// The status card's job and memory counts, as the main assistant last sent them (`not_yet` before that).
#[tauri::command]
pub fn assistant_counts(app: AppHandle) -> Res<AssistantCounts> {
    on_host(&app, |h, _| h.assistant_counts().map(|c| (c, vec![])))
}

#[tauri::command]
pub fn assistant_open(app: AppHandle, kind: OpenKind) -> Res<()> {
    on_host(&app, |h, _| just(h.assistant_open(kind)))
}

/// The meeting card's details and what comes next.
#[tauri::command]
pub fn calendar_next(app: AppHandle) -> Res<CalendarNext> {
    on_host(&app, |h, _| h.calendar_next().map(|c| (c, vec![])))
}

/// The Claude Code hook bridge's health: the main assistant's report while it gives one, else Peeka's own hook
/// (`docs/eklenti-api.md` "Claude Code"): installed = Peeka's entries are in Claude Code's settings, healthy = they
/// point at this exe, the age = the last line on Peeka's hook pipe.
#[tauri::command]
pub fn claude_bridge_state(app: AppHandle) -> Res<BridgeState> {
    match on_host(&app, |h, now| h.claude_bridge(now).map(|b| (b, vec![]))) {
        Err(CmdError::NotConnected | CmdError::NotYet) => own_bridge(&app),
        r => r,
    }
}

/// Claude Code's user settings: `CLAUDE_CONFIG_DIR` when set (as Claude Code reads it), else `%USERPROFILE%\.claude`.
fn claude_settings() -> Res<PathBuf> {
    let dir = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude")))
        .ok_or(CmdError::Missing)?;
    Ok(dir.join("settings.json"))
}

fn this_exe() -> Res<String> {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|_| CmdError::Io)
}

fn own_bridge(app: &AppHandle) -> Res<BridgeState> {
    let (installed, current) = notch_core::plugins::cc_hooks::file_status(&claude_settings()?, &this_exe()?);
    let seen = app.try_state::<crate::plugins::Plugins>().map_or(0, |p| p.cc_seen.load(std::sync::atomic::Ordering::SeqCst));
    let last_event_ago_s = (seen > 0).then(|| crate::live::now_ms().saturating_sub(seen) / 1000);
    Ok(BridgeState { installed, healthy: installed && current, last_event_ago_s })
}

/// Settings' "Kur", only from the owner's click: Peeka's hook for all twelve events into Claude Code's
/// `settings.json`, merged (the owner's other hooks stay; a backup `settings.json.bak-peeka` first). A file
/// of an unexpected shape is refused untouched; the reason goes out as a notice.
#[tauri::command]
pub fn claude_bridge_install(app: AppHandle) -> Res<BridgeState> {
    if crate::app::demo() {
        return Err(CmdError::Refused);
    }
    notch_core::plugins::cc_hooks::install(&claude_settings()?, &this_exe()?).map_err(|why| {
        crate::app::notice(&app, &why);
        CmdError::Refused
    })?;
    own_bridge(&app)
}

/// "Kaldır": only Peeka's own entries go.
#[tauri::command]
pub fn claude_bridge_remove(app: AppHandle) -> Res<BridgeState> {
    if crate::app::demo() {
        return Err(CmdError::Refused);
    }
    notch_core::plugins::cc_hooks::uninstall(&claude_settings()?).map_err(|why| {
        crate::app::notice(&app, &why);
        CmdError::Refused
    })?;
    own_bridge(&app)
}

/// "Terminali aç": the page names a session (a row's `session`), never a pid. Only a pid the main assistant announced
/// with `cc.sessions.set` is walked: `unknown` = never announced, `not_connected` = no main assistant, `missing` = no
/// ancestor owns a window (a classic console, or the session ended), `refused` = Windows kept the focus.
#[tauri::command]
pub async fn cc_focus_terminal(app: AppHandle, session_id: String) -> Res<()> {
    not_in_demo()?;
    let pid = on_host(&app, |h, _| h.cc_session_pid(&session_id).map(|p| (p, vec![])))?;
    notch_win::session_window::focus(pid).map_err(|e| match e {
        notch_win::session_window::FocusErr::NoWindow => CmdError::Missing,
        notch_win::session_window::FocusErr::Refused => CmdError::Refused,
    })
}

/// Settings › İzin geçmişi, newest first (names and scope names only).
#[tauri::command]
pub fn permission_history(app: AppHandle) -> Res<Vec<PermissionEvent>> {
    on_host(&app, |h, _| Ok((h.permission_history(), vec![])))
}

#[tauri::command]
pub fn first_connect_get(app: AppHandle) -> Res<bool> {
    on_host(&app, |h, _| Ok((h.first_connect_get(), vec![])))
}

#[tauri::command]
pub fn first_connect_ack(app: AppHandle) -> Res<()> {
    on_host(&app, |h, _| Ok(((), h.first_connect_ack())))
}

/// bridge.ts `ShelfSuggestion`.
#[derive(Serialize)]
pub struct ShelfSuggestion {
    id: String,
    text: String,
}

/// shortcut: the main assistant gets this long to suggest something for a shelf file; a later answer is dropped.
const SHELF_WAIT: Duration = Duration::from_secs(3);

/// The main assistant's suggestion for a shelf file, asked only if it holds `files.drop`; None = none (or too late).
#[tauri::command]
pub async fn shelf_suggest(app: AppHandle, id: String) -> Res<Option<ShelfSuggestion>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    // Checked first: no copy for a message that will not go.
    let main = main_holds(&app, Some(Scope::FilesDrop))?;
    let copies = cmd::shelf_copies(main, [id.as_str()], |id| shelf_copy(&app, id))?;
    let Some(path) = copies.into_iter().next() else { return Ok(None) };
    let Some(req) = on_host(&app, |h, _| h.shelf_suggest(&path))? else { return Ok(None) };
    let started = Instant::now();
    while started.elapsed() < SHELF_WAIT {
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(100))).await;
        let p = app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?;
        let answer = p.host.lock().shelf_suggestion(req);
        if let Some(text) = answer {
            return Ok(text.map(|text| ShelfSuggestion { id, text }));
        }
    }
    Ok(None)
}

/// "Notlara ekle": the shelf file to the main assistant (one-shot, the owner's click).
#[tauri::command]
pub fn shelf_memory(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let copies = cmd::shelf_copies(main_holds(&app, None)?, [id.as_str()], |id| shelf_copy(&app, id))?;
    let path = copies.into_iter().next().ok_or(CmdError::NotConnected)?;
    on_host(&app, |h, _| just(h.shelf_memory(&path)))
}

/// The shelf file as a one-shot copy in the share folder (`notch_core::shelf::share_copy`): the main assistant may read only
/// that folder. `denied` for a password-class file, `invalid` for a folder or over the size cap.
fn shelf_copy(app: &AppHandle, id: &str) -> Res<String> {
    let original = extras(app)?.shelf.lock().path(id).ok_or(CmdError::Unknown)?.to_path_buf();
    let copy = notch_core::shelf::share_copy(&share_dir(app)?, &original)?;
    Ok(copy.to_string_lossy().into_owned())
}

/// `Host::main_holds` for `cmd::shelf_copies`; `unknown` only when the plugin host is not up.
fn main_holds(app: &AppHandle, scope: Option<Scope>) -> Res<Result<bool, OwnerErr>> {
    Ok(app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?.host.lock().main_holds(scope))
}

/// "Başlat" on the not-connected card: the main assistant's manifest `launch` exe, on the owner's click only.
/// Nothing from the page; `missing` when no main assistant, no `launch`, or the file is gone.
#[tauri::command]
pub fn assistant_start(app: AppHandle) -> Res<()> {
    let plugins = app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?;
    let launch = plugins.host.lock().main_launch().map(str::to_owned);
    let target = cmd::assistant_start_target(launch.as_deref(), Path::is_file).ok_or(CmdError::Missing)?;
    Win32Control.launch(&target.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/* ---------- Sadakat 3: Ctrl+Space attachments (rules: notch_core::fidelity::resolve) ---------- */

use notch_core::fidelity::Attached;

/// The attachment kinds `composer_submit` resolves (the page shows only these buttons and chips).
#[tauri::command]
pub fn composer_kinds() -> Vec<&'static str> {
    notch_core::fidelity::COMPOSER_KINDS.to_vec()
}

/// The one place a share-folder copy gets its folder: demo mode has none (nothing is copied).
fn share_dir(app: &AppHandle) -> Res<PathBuf> {
    not_in_demo()?;
    Ok(app.try_state::<Notch>().ok_or(CmdError::Unknown)?.data_dir.clone())
}

/// The scan button: a picture of the topmost app window (the one under the island; Notch's own windows are not app
/// windows, and `cmd::scan_target` skips them anyway), full size, into the one-shot share folder for the next
/// `composer_submit`. `denied` while Notch is locked or when that window is a sensitive app (a Turkish notice says
/// why; nothing is captured), `missing` when no app window is open, `refused` when Windows would not draw it.
#[tauri::command]
pub async fn composer_scan(app: AppHandle) -> Res<Option<Attached>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let own = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let hwnd = cmd::scan_target(&Win32Desktop.windows(), &own).inspect_err(|e| {
        if *e == CmdError::Denied {
            crate::app::notice(&app, "Bu pencere hassas bir uygulamanın (parola yöneticisi, banka); taranmadı.");
        }
    })?;
    let png = notch_win::preview::capture_png(hwnd).ok_or(CmdError::Refused)?;
    let (_, path) = notch_core::plugins::share::put(&share_dir(&app)?, &png, "png").map_err(|_| CmdError::Io)?;
    keep_for_composer(&app, AttachKind::Screenshot, path);
    Ok(Some(Attached { kind: "screen_image", label: "Ekran görüntüsü".into() }))
}

/// The paperclip: Windows's Open dialog over the island; the picked file is COPIED into the one-shot share folder
/// (the main assistant may read only that folder) for the next `composer_submit`. None = cancelled. `denied` while locked or for
/// a password-class file (the shelf copy's name and text checks), `invalid` over `ATTACH_MAX_BYTES`. Sync: the dialog belongs to the island window's (main) thread.
#[tauri::command]
pub fn composer_attach_file(app: AppHandle) -> Res<Option<Attached>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let owner = app.get_webview_window("island").and_then(|w| w.hwnd().ok()).map_or(0, |h| h.0 as isize);
    let Some(picked) = notch_win::picker::open_file(owner) else { return Ok(None) };
    let size = std::fs::metadata(&picked).map_err(|_| CmdError::Io)?.len();
    let name = picked.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = cmd::attach_ext(size, &name)?;
    let bytes = std::fs::read(&picked).map_err(|_| CmdError::Io)?;
    cmd::attach_bytes(&bytes)?;
    let (_, path) = notch_core::plugins::share::put(&share_dir(&app)?, &bytes, &ext).map_err(|_| CmdError::Io)?;
    keep_for_composer(&app, AttachKind::File, path);
    Ok(Some(Attached { kind: "file", label: name }))
}

fn keep_for_composer(app: &AppHandle, kind: AttachKind, path: PathBuf) {
    if let Some(n) = app.try_state::<Notch>() {
        let path = Some(path.to_string_lossy().into_owned());
        n.composer_files.lock().push(Attachment { kind, path, text: None });
    }
}
