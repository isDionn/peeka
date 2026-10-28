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
    /// The same PNG in colour (`icon` is painted as a mask), when `color` says so.
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
    /// Notch cannot close it (an elevated app): the menu offers "Open Task Manager" (`open_task_manager`).
    pub elevated: bool,
    /// Its taskbar button would flash (`notch_win::flash`): the strip pulses an amber dot under the app.
    pub attention: bool,
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
    look(n, app_id).url
}

fn look(n: &Notch, app_id: &str) -> notch_win::icons::Icon {
    if let Some(i) = n.icons.lock().get(app_id) {
        return i.clone();
    }
    notch_win::com();
    let hwnd = n.items.lock().iter().find(|i| i.app_id == app_id).and_then(|i| i.windows.first()).map(|w| w.hwnd);
    let pkg = hwnd.and_then(notch_win::apps::package_aumid_of_window);
    let exe = hwnd.map(notch_win::apps::exe_of_window);
    let i = apps::icon_sources(app_id, pkg, exe).iter().find_map(|s| notch_win::icons::icon(s)).unwrap_or_default();
    // a miss is not cached: an app found while it (or the shell, at sign-in) was still starting gets its icon on the next
    // list. shortcut: an app with no icon at all is asked again on every list; cache misses with a time if that shows.
    if !i.url.is_empty() {
        n.icons.lock().insert(app_id.to_string(), i.clone());
    }
    i
}

/// A pin's name: as saved, unless that is only the exe stem (`snapshot`).
fn pin_ref(n: &Notch, p: &apps::Pin) -> AppRef {
    let shown = if p.name == apps::fallback_name(&p.app_id) { name(n, &p.app_id, None) } else { p.name.clone() };
    app_ref(n, &p.app_id, &shown)
}

fn app_ref(n: &Notch, app_id: &str, name: &str) -> AppRef {
    AppRef { app_id: app_id.to_string(), name: name.to_string(), color_icon: color(n, app_id), icon: icon(n, app_id) }
}

/// The colour copy of an app's icon (the extracted PNG is already in colour): while the setting is on, and always
/// for an icon whose mask would be a blank square or circle; never for a nearly black one (invisible on the strip).
fn color(n: &Notch, app_id: &str) -> Option<String> {
    color_of(n, &look(n, app_id))
}

fn color_of(n: &Notch, i: &notch_win::icons::Icon) -> Option<String> {
    (!i.url.is_empty() && !i.dark && (i.blob || n.settings.lock().color_icons)).then(|| i.url.clone())
}

/// The window-event generation (`flash::generation`) `n.items` was listed at.
static LISTED: parking_lot::Mutex<Option<u64>> = parking_lot::Mutex::new(None);

/// Pins + open windows now, in the strip's steady order (`apps::keep_order`); also what later commands are checked
/// against.
pub fn snapshot(n: &Notch) -> Vec<AppItem> {
    let generation = notch_win::flash::generation();
    let pins = n.settings.lock().pins.clone();
    let raw = Win32Desktop.windows();
    let prev = n.items.lock().clone();
    let mut list = apps::keep_order(&prev, apps::merge(&pins, &raw, app_target));
    // a pin saved from the strip before 0.3.5 kept the exe stem: it gets the proper name too
    for item in list.iter_mut().filter(|i| !i.pinned || i.name == apps::fallback_name(&i.app_id)) {
        let w = raw.iter().find(|w| apps::app_id(w.aumid.as_deref(), &w.exe_path).as_deref() == Some(item.app_id.as_str()));
        item.name = name(n, &item.app_id, w);
    }
    *n.items.lock() = list.clone();
    *LISTED.lock() = Some(generation);
    list
}

/// An `aumid:` pin's exe (`apps::merge`), asked of the shell once per id (a miss too) for the app's lifetime.
fn app_target(app_id: &str) -> Option<String> {
    static TARGETS: parking_lot::Mutex<Option<HashMap<String, Option<String>>>> = parking_lot::Mutex::new(None);
    let mut cache = TARGETS.lock();
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some(t) = cache.get(app_id) {
        return t.clone();
    }
    notch_win::com();
    let t = app_id.strip_prefix("aumid:").and_then(notch_win::startmenu::app_target);
    cache.insert(app_id.to_string(), t.clone());
    t
}

/// An app's strip name (cached per id, a miss too; the shell is asked only for a new app). `w` = one of its windows.
fn name(n: &Notch, app_id: &str, w: Option<&apps::RawWindow>) -> String {
    if let Some(s) = n.names.lock().get(app_id) {
        return s.clone();
    }
    notch_win::com();
    let pkg = w.and_then(|w| notch_win::apps::package_aumid_of_window(w.hwnd)).map(|a| format!("shell:AppsFolder\\{a}"));
    let sources: Vec<String> = [apps::launch_target(app_id), pkg, w.map(|w| w.exe_path.clone())].into_iter().flatten().collect();
    let s = apps::display_name(app_id, &sources, notch_win::icons::name);
    n.names.lock().insert(app_id.to_string(), s.clone());
    s
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

/// The flat per-window view of `items` for a strip: every monitor's windows (Windows' "All taskbars", owner decision),
/// so an app on another screen is one click away; `WindowInfo.monitor` is the window's own monitor.
fn windows_on(n: &Notch, items: &[AppItem], foreground: isize) -> Vec<WindowInfo> {
    items
        .iter()
        .flat_map(|i| i.windows.iter().map(move |w| (i, w)))
        .map(|(i, w)| {
            WindowInfo {
                app_id: i.app_id.clone(),
                name: i.name.clone(),
                color_icon: color(n, &i.app_id),
                icon: icon(n, &i.app_id),
                hwnd: w.hwnd,
                title: w.title.clone(),
                active: w.hwnd == foreground,
                monitor: w.monitor.map(|m| m.to_string()).unwrap_or_default(),
                elevated: w.elevated,
                attention: w.hwnd != foreground && notch_win::flash::flashing(w.hwnd),
            }
        })
        .collect()
}

#[tauri::command]
pub async fn list_windows(n: State<'_, Notch>, monitor: String) -> Res<Vec<WindowInfo>> {
    let _ = monitor; // kept in the signature (contract): every strip lists every monitor's windows
    // One enumeration per window event: the other strips relisting after it take the same list (the foreground and
    // the flashing are read fresh). Serialised, so the second strip waits for the first instead of enumerating too.
    static ONE: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
    let items = {
        let _one = ONE.lock();
        let fresh = *LISTED.lock() == Some(notch_win::flash::generation());
        if fresh { n.items.lock().clone() } else { snapshot(&n) }
    };
    Ok(windows_on(&n, &items, notch_win::apps::foreground()))
}

#[tauri::command]
pub async fn get_pins(n: State<'_, Notch>) -> Res<Vec<AppRef>> {
    let pins = n.settings.lock().pins.clone();
    Ok(pins.iter().map(|p| pin_ref(&n, p)).collect())
}

/// New pin order; each id must already be pinned or be in Notch's last strip list.
#[tauri::command]
pub async fn set_pins(app: AppHandle, n: State<'_, Notch>, app_ids: Vec<String>) -> Res<Vec<AppRef>> {
    let items = n.items.lock().clone();
    // A new AUMID pin remembers its window's relaunch command: a Chrome / Edge profile opens again once closed. Read
    // before the settings lock: another app's window may be slow to answer.
    let relaunch: HashMap<String, String> = items
        .iter()
        .filter(|i| i.app_id.starts_with("aumid:") && app_ids.contains(&i.app_id))
        .filter_map(|i| Some((i.app_id.clone(), notch_win::apps::relaunch_command(i.windows.first()?.hwnd)?)))
        .collect();
    let next = {
        let mut s = n.settings.lock();
        let mut pins = cmd::pins_order(&s.pins, &items, &app_ids)?;
        for p in pins.iter_mut().filter(|p| p.relaunch.is_none()) {
            p.relaunch = relaunch.get(&p.app_id).cloned();
        }
        let mut next = s.clone();
        next.pins = pins;
        n.save(&next).map_err(|_| CmdError::Io)?;
        *s = next.clone();
        next
    };
    let _ = app.emit("pins_changed", ());
    Ok(next.pins.iter().map(|p| pin_ref(&n, p)).collect())
}

/// The Windows taskbar's pins (in its order) added after Peeka's own; nothing is ever removed (owner RC5). `first_run`:
/// once ever, and only while Peeka has no pins yet; the Settings action always imports.
pub fn import_pins(app: &AppHandle, n: &Notch, first_run: bool) -> Res<Vec<apps::Pin>> {
    if first_run && n.settings.lock().taskbar_pins_imported {
        return Ok(n.settings.lock().pins.clone());
    }
    let found = if first_run && !n.settings.lock().pins.is_empty() {
        vec![]
    } else {
        notch_win::com();
        let running: Vec<String> = snapshot(n).into_iter().map(|i| i.app_id).collect();
        notch_win::startmenu::taskbar_pins(&running)
    };
    let added = !found.is_empty();
    let next = {
        let mut s = n.settings.lock();
        let mut next = s.clone();
        next.pins = apps::add_pins(&s.pins, found);
        next.taskbar_pins_imported = true;
        n.save(&next).map_err(|_| CmdError::Io)?;
        *s = next.clone();
        next
    };
    if added {
        let _ = app.emit("pins_changed", ());
    }
    Ok(next.pins)
}

/// Settings › "Import Windows taskbar pins".
#[tauri::command]
pub async fn import_taskbar_pins(app: AppHandle, n: State<'_, Notch>) -> Res<Vec<AppRef>> {
    not_in_demo()?;
    let pins = import_pins(&app, &n, false)?;
    Ok(pins.iter().map(|p| pin_ref(&n, p)).collect())
}

/// The strip's right-edge "Show desktop": Win+D (a second click brings the windows back).
#[tauri::command]
pub async fn show_desktop() -> Res<()> {
    not_in_demo()?;
    notch_win::apps::toggle_desktop().then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn activate_window(n: State<'_, Notch>, hwnd: isize, toggle: Option<bool>) -> Res<()> {
    apps::find_window(&n.items.lock(), hwnd).ok_or(CmdError::Unknown)?;
    // toggle: a strip click on the window already in front minimises it (Windows taskbar behaviour).
    if toggle == Some(true) && notch_win::apps::foreground() == hwnd {
        return notch_win::apps::minimise(hwnd).then_some(()).ok_or(CmdError::Refused);
    }
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
    let relaunch = relaunch_of(&n, &items, &app_id);
    Ok(apps::launch_any(&Win32Control, &items, &apps, &app_id, relaunch.as_deref())?)
}

/// Start's menu: the file behind an app Notch listed (its Start Menu shortcut or exe), never a Store app (`invalid`:
/// no file the owner should touch) and never a path the page made up (`unknown`).
fn app_file(n: &Notch, app_id: &str) -> Res<String> {
    let known = listed(n).iter().any(|a| a.app_id == app_id) || n.items.lock().iter().any(|i| i.app_id == app_id);
    if !known {
        return Err(CmdError::Unknown);
    }
    apps::launch_target(app_id).filter(|_| !app_id.starts_with("aumid:")).ok_or(CmdError::Invalid)
}

/// "Open file location": Explorer with the shortcut (or exe) selected, as Windows's Start does.
#[tauri::command]
pub fn app_show_in_folder(n: State<'_, Notch>, app_id: String) -> Res<()> {
    let path = app_file(&n, &app_id)?;
    notch_win::downloads::show_in_folder(std::path::Path::new(&path)).then_some(()).ok_or(CmdError::Refused)
}

/// "Run as administrator": Windows asks with its own UAC prompt; `refused` when the owner says no.
#[tauri::command]
pub fn launch_app_admin(n: State<'_, Notch>, app_id: String) -> Res<()> {
    let path = app_file(&n, &app_id)?;
    notch_win::apps::run_as_admin(&path).then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn new_window(n: State<'_, Notch>, app_id: String) -> Res<()> {
    let items = n.items.lock().clone();
    let relaunch = relaunch_of(&n, &items, &app_id);
    Ok(apps::launch(&Win32Control, &items, &app_id, relaunch.as_deref())?)
}

/// An AUMID app's relaunch command: a running window's, else its pin's (`apps::launch`).
fn relaunch_of(n: &Notch, items: &[AppItem], app_id: &str) -> Option<String> {
    if !app_id.starts_with("aumid:") {
        return None;
    }
    notch_win::com();
    let window = items.iter().find(|i| i.app_id == app_id).and_then(|i| i.windows.first());
    window.and_then(|w| notch_win::apps::relaunch_command(w.hwnd)).or_else(|| {
        n.settings.lock().pins.iter().find(|p| p.app_id == app_id).and_then(|p| p.relaunch.clone())
    })
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
            out.push(SearchResult::plain(format!("set:{uri}"), "setting", name.into(), Some("Windows setting".into())));
        }
        let sql = notch_core::search::files_sql(&q, FILES_MAX as u32).filter(|_| q.chars().count() >= 2);
        if let Some(sql) = sql.filter(|_| notch_win::winsearch::index_on()) {
            let data = n.data_dir.clone();
            for path in notch_win::winsearch::files(sql, FILES_MAX, FILES_TIMEOUT) {
                if cmd::inside_dir(&path, &data) {
                    continue; // never Notch's own files (the vault, the clipboard images)
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
        Route::Hit(Hit::Window(hwnd)) => activate_window(n.clone(), hwnd, None)?,
    }
    if let Some(r) = known.filter(|r| r.kind != "plugin") {
        let mut list = n.recents.lock();
        list.retain(|x| x.id != r.id);
        list.insert(0, r);
        list.truncate(RECENTS);
    }
    Ok(())
}

/// "Ask assistant" under Ctrl+K: the query goes to the main assistant as a Ctrl+Space turn and the island opens its
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
        Hit::Window(hwnd) => activate_window(n, hwnd, None),
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

/// The Status panel's audio switcher: output devices and the microphone's mute.
#[tauri::command]
pub async fn audio_get() -> Res<notch_core::status::Audio> {
    Ok(notch_core::status::Audio { outputs: notch_win::audio::outputs(), mic_muted: notch_win::audio::mic_muted() })
}

/// Only an id `audio_get` lists right now reaches the undocumented `IPolicyConfig`.
#[tauri::command]
pub async fn set_audio_output(app: AppHandle, n: State<'_, Notch>, id: String) -> Res<()> {
    not_in_demo()?; // demo never changes the real default device
    if !notch_win::audio::outputs().iter().any(|o| o.id == id) {
        return Err(CmdError::Unknown);
    }
    notch_win::audio::set_default_output(&id).map_err(|_| CmdError::Refused)?;
    emit_status(&app, &n); // the volume slider now shows the new device's level
    Ok(())
}

#[tauri::command]
pub async fn set_mic_muted(muted: bool) -> Res<()> {
    not_in_demo()?;
    notch_win::audio::set_mic_muted(muted).then_some(()).ok_or(CmdError::Refused)
}

/// The Status panel's per-app mixer: one row per app on the default output, names and icons from the strip's caches.
/// The page polls it only while the list is open; nothing while locked, presenting or sharing the screen (app names are content).
#[tauri::command]
pub async fn audio_sessions(app: AppHandle, n: State<'_, Notch>) -> Res<Vec<notch_core::status::AudioSession>> {
    use notch_core::status::{group_sessions, session_key, AudioSession};
    cmd::unlocked(crate::privacy::closed(&app))?;
    let raw = notch_win::audio::sessions().into_iter().filter_map(|(pid, v, m)| Some((session_app(pid)?, v, m)));
    Ok(group_sessions(raw)
        .into_iter()
        .map(|(id, volume, muted)| AudioSession {
            app: if id == SYSTEM_SOUNDS { "System sounds".into() } else { name(&n, &id, None) },
            icon: icon(&n, &id),
            color_icon: color(&n, &id),
            id: session_key(&id),
            volume,
            muted,
        })
        .collect())
}

/// `id` from `audio_sessions`; at least one of `volume` (0..1, clamped) and `muted`. Sets all of that app's sessions.
#[tauri::command]
pub async fn audio_session_set(app: AppHandle, id: String, volume: Option<f64>, muted: Option<bool>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    not_in_demo()?;
    let volume = volume.map(|v| notch_core::status::clamp_volume(v).ok_or(CmdError::Invalid)).transpose()?;
    if volume.is_none() && muted.is_none() {
        return Err(CmdError::Invalid);
    }
    let pick = |pid| session_app(pid).is_some_and(|a| notch_core::status::session_key(&a) == id);
    notch_win::audio::set_sessions(pick, volume, muted).then_some(()).ok_or(CmdError::Refused)
}

/// The system-sounds session (pid 0) has no process: its own key, no icon.
const SYSTEM_SOUNDS: &str = "system:sounds";

/// A session's app id; None = Peeka itself or a process it can't read (elevated / protected: not listed).
fn session_app(pid: u32) -> Option<String> {
    match pid {
        0 => Some(SYSTEM_SOUNDS.into()),
        p if p == std::process::id() => None,
        p => notch_win::apps::app_id_of_process(p),
    }
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

/// The Wi-Fi tile's long-press picker: a fresh scan (up to 4 s), one row per network. `unsupported` = no Wi-Fi
/// adapter; `denied` while Notch is locked (network names are content). Demo: a fixed list, no radio touched.
#[tauri::command]
pub async fn wifi_networks(app: AppHandle) -> Res<Vec<notch_core::pickers::WifiNetwork>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    if crate::app::demo() {
        return Ok(notch_core::pickers::demo_wifi());
    }
    notch_win::wifi::networks().ok_or(CmdError::Unsupported)
}

/// null = connected (waits up to 20 s). `wrong_password` also means "a password is needed" (a secured network Windows
/// has no profile for). The password only reaches Windows's profile store (`notch_win::wifi`), never Peeka's files or logs.
#[tauri::command]
pub async fn wifi_connect(
    app: AppHandle,
    ssid: String,
    password: Option<String>,
) -> Res<Option<notch_core::pickers::WifiError>> {
    use notch_core::pickers::{demo_wifi, WifiError};
    cmd::unlocked(crate::plugins::locked(&app))?;
    if ssid.is_empty() || ssid.len() > 32 {
        return Err(CmdError::Invalid);
    }
    if crate::app::demo() {
        let needs = demo_wifi().iter().any(|w| w.ssid == ssid && w.secure && !w.known);
        return Ok((needs && password.is_none()).then_some(WifiError::WrongPassword));
    }
    Ok(notch_win::wifi::connect(&ssid, password.as_deref()).err())
}

/// The Bluetooth tile's long-press picker: paired devices with Windows's battery level where it has one.
#[tauri::command]
pub async fn bt_devices(app: AppHandle) -> Res<Vec<notch_core::pickers::BtDevice>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    if crate::app::demo() {
        return Ok(notch_core::pickers::demo_bt());
    }
    Ok(notch_win::bluetooth::devices())
}

/// Connect / disconnect a device `bt_devices` listed (`unknown` otherwise). Audio devices only: `unsupported` for the
/// rest (Windows has no API for it); `refused` = Windows did not take the request.
#[tauri::command]
pub async fn bt_set(app: AppHandle, id: String, connect: bool) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    if crate::app::demo() {
        let _ = connect; // demo never touches a radio
        let d = notch_core::pickers::demo_bt().into_iter().find(|d| d.id == id).ok_or(CmdError::Unknown)?;
        return (d.kind == notch_core::pickers::BtKind::Audio).then_some(()).ok_or(CmdError::Unsupported);
    }
    notch_win::bluetooth::set(&id, connect)
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

/// A click in the tray list goes to the app's live icon when the tray host heard it; elevated and older icons keep the
/// old focus/launch fallback. Only ids `open_tray` sent.
#[tauri::command]
pub fn tray_open(n: State<'_, Notch>, id: String) -> Res<()> {
    let listed = n.tray.lock();
    let icon = listed.iter().find(|t| t.id == id).ok_or(CmdError::Unknown)?;
    if notch_win::tray_host::click(&icon.exe, None, notch_win::tray_host::Click::Left) {
        return Ok(());
    }
    let target = notch_core::tray::open(&listed, &n.items.lock(), &id).ok_or(CmdError::Unknown)?;
    let ok = match target {
        notch_core::tray::Open::Focus(hwnd) => Win32Control.focus(hwnd),
        notch_core::tray::Open::Launch(exe) => Win32Control.launch(&exe),
    };
    ok.then_some(()).ok_or(CmdError::Refused)
}

/// The icon's own context menu. The page supplies a screen point only; this command still accepts only an id from the
/// last `open_tray` list, then falls back to the old focus/launch behaviour when the host never heard the icon.
#[tauri::command]
pub fn tray_menu(n: State<'_, Notch>, id: String, x: i32, y: i32) -> Res<()> {
    let listed = n.tray.lock();
    let icon = listed.iter().find(|t| t.id == id).ok_or(CmdError::Unknown)?;
    if notch_win::tray_host::click(&icon.exe, Some((x, y)), notch_win::tray_host::Click::Right) {
        return Ok(());
    }
    let target = notch_core::tray::open(&listed, &n.items.lock(), &id).ok_or(CmdError::Unknown)?;
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

/// Settings > About "Try demo" (`on`) / "Stop demo": demo is chosen at launch, so Peeka restarts. The new one waits
/// for this one to end (`--after`); this one quits cleanly like `quit` (taskbar back, AppBars gone, no alive file, so
/// the guard does not relaunch the old mode). Nothing is spawned = nothing quits.
#[tauri::command]
pub fn demo_restart(app: AppHandle, on: bool) -> Res<()> {
    let args = notch_core::supervise::restart_args(on, std::process::id());
    notch_win::taskbar::spawn_self(&args.iter().map(String::as_str).collect::<Vec<_>>()).map_err(|error| {
        crate::app::notice(&app, &format!("Could not restart Peeka: {error}"));
        CmdError::Io
    })?;
    app.exit(0);
    Ok(())
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
        return fail("Could not change the start-with-Windows setting.".into());
    }
    // The adapter must bind before the setting says "on" (the port may be taken).
    if next.alerts_api && !old.alerts_api {
        if crate::app::demo() {
            return fail("The alert API is not available in demo mode (it would write a key file).".into());
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
        return fail("Settings could not be saved.".into());
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
        crate::clip_history::configure(&app, cfg);
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

/// The page's rectangles for the click-through cursor poll (`app::click_through`; no window regions: a strip's bar is
/// always clickable, `clickthrough::strip_captures`).
#[tauri::command]
pub fn report_hit_rects(
    n: State<'_, Notch>,
    page: String,
    monitor: String,
    rects: Vec<CssRect>,
    dpr: Option<f64>,
    view: Option<String>,
) -> Res<()> {
    let rects = sanitize(rects).ok_or(CmdError::Invalid)?;
    // only for "Save diagnostics": a sane ratio and Peeka's own short label, nothing else
    let dpr = dpr.filter(|d| d.is_finite() && (0.1..=10.0).contains(d));
    let view = notch_core::diagnostics::clean_view(view.as_deref().unwrap_or(""));
    match page.as_str() {
        "island" => {
            *n.rects.lock() = rects;
            *n.island_view.lock() = (dpr, view);
        }
        "strip" => {
            let label = format!("strip-{monitor}");
            let mut strips = n.strips.lock();
            let s = strips.get_mut(&label).ok_or(CmdError::Unknown)?;
            (s.rects, s.dpr, s.view) = (rects, dpr, view); // the cursor poll (`app::click_through`) reads them
        }
        _ => return Err(CmdError::Invalid),
    }
    Ok(())
}

/// The calling strip or island window grows before something hangs below the bar and shrinks after it all closed
/// (`app::window_tall`). A page may ask only for its own window.
#[tauri::command]
pub fn window_tall(window: tauri::WebviewWindow, n: State<'_, Notch>, tall: bool) -> Res<()> {
    crate::app::window_tall(&n, &window, tall).ok_or(CmdError::Unknown)
}

/// Ctrl+Alt+Shift+D or Settings > About: one text file in `<data>\diagnostics` (`notch_core::diagnostics`: versions
/// and geometry only, no titles, clipboard or notification text). Nothing is sent; `diagnostics_saved` shows the
/// island's "Open folder". Returns the file name.
#[tauri::command]
pub fn save_diagnostics(app: AppHandle, n: State<'_, Notch>) -> Res<String> {
    not_in_demo()?; // demo writes nothing to disk
    let (stamp, when) = notch_win::diagnostics::local_stamp();
    let d = notch_core::diagnostics::Diag {
        when,
        version: app.package_info().version.to_string(),
        windows: notch_win::diagnostics::windows_build(),
        webview2: tauri::webview_version().unwrap_or_else(|_| "(unknown)".into()),
        monitors: n.monitors.lock().clone(),
        gpus: notch_win::diagnostics::gpus(),
        pages: n.diag_pages(),
    };
    let env = |k| std::env::var(k).ok();
    let text = notch_core::diagnostics::render(&d, &n.settings.lock());
    let text = notch_core::diagnostics::scrub(&text, env("USERPROFILE").as_deref(), env("USERNAME").as_deref());
    let dir = n.data_dir.join("diagnostics");
    let name = format!("{}-diag-{stamp}.txt", notch_core::brand::EXE_NAME);
    let path = dir.join(&name);
    std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&path, text)).map_err(|_| CmdError::Io)?;
    *n.diag_last.lock() = Some(path);
    let _ = app.emit("diagnostics_saved", &name);
    Ok(name)
}

/// Explorer with the last diagnostics file selected (only that file; the page passes no path).
#[tauri::command]
pub fn diagnostics_open_folder(n: State<'_, Notch>) -> Res<()> {
    let path = n.diag_last.lock().clone().ok_or(CmdError::Unknown)?;
    notch_win::downloads::show_in_folder(&path).then_some(()).ok_or(CmdError::Refused)
}

/// The taskbar mode by hand (also lifts the emergency key's "off"): Settings' radio, `full` | `auto` | `off`
/// ("Leave the Windows taskbar alone"). The page reads the current one as `taskbarHide` in the settings.
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

/// The owner clicked an alert's "Open": the page sends only the id; a stored link is checked again (http(s) only)
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

/// "Open Task Manager" (an elevated window's menu, an alert's button): `Taskmgr.exe` by its full path, no
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

/// The music bars are on screen: `audio_level` events until `audio_level_stop` (see `live::audio_level`).
#[tauri::command]
pub fn audio_level_start(app: AppHandle) {
    crate::live::audio_level(&app, true);
}

#[tauri::command]
pub fn audio_level_stop(app: AppHandle) {
    crate::live::audio_level(&app, false);
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
/// refuses everything (only "Details" may be there). Missing = the card.
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
    let counted = match decision {
        Decision::Allow | Decision::Always => Some(notch_core::recap::Ev::Allowed),
        Decision::Deny => Some(notch_core::recap::Ev::Denied),
        Decision::Choice => None,
    };
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
    })?;
    if let Some(ev) = counted {
        crate::recap::count(&app, ev);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Turn {
    turn: u64,
}

/// Ctrl+Space's box to the main assistant. The page sends only each attachment's kind; Rust resolves it from what
/// Notch itself holds (`fidelity::resolve`: the owner's scans and picked files, the newest clipboard link, the shelf).
/// `not_connected` = nobody to send to ("Assistant not connected"); `invalid` for a kind with nothing behind it.
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

#[derive(Serialize)]
pub struct PageReq {
    id: u64,
}

/// A build-time extension asks the main assistant (assistant slots, docs/plugin-api.md §11): one name from the brand's
/// `page_requests` (`invalid` for any other, a non-object or too large), sent as `page.request`; the answer comes as
/// `assistant_reply` with this id. `denied` while the privacy gate is closed, `not_connected` without a main assistant.
#[tauri::command]
pub fn assistant_request(app: AppHandle, method: String, params: serde_json::Value) -> Res<PageReq> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    cmd::unlocked(crate::privacy::closed(&app))?;
    on_host(&app, |h, _| h.page_request(&method, params).map(|(id, o)| (PageReq { id }, o)))
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

/// "Remove": the token digest goes and its connection closes at once.
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

/* ---------- Wave 4: Notch's lock and the clipboard's capture exclusion ---------- */

#[tauri::command]
pub fn lock_state(app: AppHandle) -> notch_core::lock::LockState {
    app.try_state::<crate::plugins::Plugins>()
        .map(|p| p.host.lock().lock_state())
        .unwrap_or(notch_core::lock::LockState { locked: false, reason: None })
}

/// The owner's "Lock".
#[tauri::command]
pub fn lock_now(app: AppHandle) {
    crate::plugins::lock(&app, notch_core::lock::Reason::Manual, true);
}

/// The owner's click in Notch: lifts "Lock" and `lock.signal`; a Windows lock stays until Windows unlocks.
#[tauri::command]
pub fn lock_release(app: AppHandle) -> Res<()> {
    let p = app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?;
    let outs = p.host.lock().lock_release();
    crate::plugins::run(&app, outs);
    Ok(())
}

/// The clipboard card or the Clipboard tab is about to draw (`on: true`, the page awaits this before its first frame) or has
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

/* ---------- Wave 4: the clipboard (shapes: ui/src/wave4-api.ts; rules: notch_core::clip) ---------- */

use notch_core::clip::ItemView;

fn clip_history(app: &AppHandle) -> Res<tauri::State<'_, crate::clip_history::ClipState>> {
    app.try_state::<crate::clip_history::ClipState>().ok_or(CmdError::Unknown)
}

#[tauri::command]
pub fn clip_list(app: AppHandle) -> Res<Vec<ItemView>> {
    let hide = crate::privacy::closed(&app);
    Ok(clip_history(&app)?.clip_history.lock().list(hide))
}

/// Copy-back: a password without revealing it (never while locked); every write carries the "keep out of
/// history / cloud / monitors" formats.
#[tauri::command]
pub async fn clip_copy(app: AppHandle, id: String) -> Res<()> {
    let locked = crate::plugins::locked(&app);
    let payload = clip_history(&app)?.clip_history.lock().payload(&id, locked, &notch_win::dpapi::Dpapi)?;
    if !notch_win::clipboard::write(&payload) {
        return Err(CmdError::Refused);
    }
    drop(payload); // a password's plaintext is zeroed here
    let change = clip_history(&app)?.clip_history.lock().bump(&id, crate::live::now_ms());
    crate::clip_history::emit(&app, change.into_iter().collect());
    Ok(())
}

/// Plain local values such as calculator results use the same native clipboard writer as copy-back.
#[tauri::command]
pub fn clipboard_write(text: String) -> Res<()> {
    notch_win::clipboard::write(&notch_core::clip::Payload::Text(notch_core::clip::vault::Secret::new(text.into_bytes()))).then_some(()).ok_or(CmdError::Refused)
}

/// Paste a text history item as `CF_UNICODETEXT` only. Passwords, files and images never take this path.
/// The Windows helper snapshots and restores the user's clipboard around the target app's Ctrl+V.
#[tauri::command]
pub async fn clip_paste_plain(app: AppHandle, id: String) -> Res<()> {
    let locked = crate::plugins::locked(&app);
    let payload = clip_history(&app)?.clip_history.lock().payload(&id, locked, &notch_win::dpapi::Dpapi)?;
    let notch_core::clip::Payload::Text(text) = payload else { return Err(CmdError::Invalid) };
    let ok = notch_win::clipboard::paste_plain(text.bytes());
    drop(text);
    ok.then_some(()).ok_or(CmdError::Refused)
}

#[tauri::command]
pub fn clip_pin(app: AppHandle, id: String, on: bool) -> Res<()> {
    let change = clip_history(&app)?.clip_history.lock().pin(&id, on)?;
    crate::clip_history::emit(&app, vec![change]);
    Ok(())
}

#[tauri::command]
pub fn clip_delete(app: AppHandle, id: String) -> Res<()> {
    let change = clip_history(&app)?.clip_history.lock().delete(&id)?;
    crate::clip_history::emit(&app, vec![change]);
    Ok(())
}

/// "Delete all" (the password file too); `passwords: true` = Settings › Clipboard's "Delete all passwords".
#[tauri::command]
pub fn clip_clear(app: AppHandle, passwords: Option<bool>) -> Res<()> {
    let change = clip_history(&app)?.clip_history.lock().clear(passwords.unwrap_or(false));
    crate::clip_history::emit(&app, vec![change]);
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
    let secret = clip_history(&app)?.clip_history.lock().reveal(&id, locked, &notch_win::dpapi::Dpapi)?;
    let text = String::from_utf8_lossy(secret.bytes()).into_owned();
    Ok(ClipReveal { text, ttl_ms: notch_core::clip::REVEAL_MS })
}

/// "Ask assistant": the one item to the main assistant only (one-shot share, no scope). `denied` on a
/// password item, `not_connected` without a main assistant.
#[tauri::command]
pub fn clip_share(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let attachments = clip_history(&app)?.clip_history.lock().share(&id)?;
    on_host(&app, |h, now| h.composer_submit("", &attachments, now).map(|(_, o)| ((), o)))
}

/// A screenshot (any image item) opens in Windows's default app for it.
#[tauri::command]
pub fn clip_edit(app: AppHandle, id: String) -> Res<()> {
    let path = clip_history(&app)?.clip_history.lock().image_path(&id)?;
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// Open the clip with its default app: an image through a temp copy, a file item's first file. `denied` while
/// locked, for a password and for a file Windows would run.
#[tauri::command]
pub fn clip_open(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = clip_history(&app)?.clip_history.lock().open_path(&id, false, &crate::clip_history::temp_open())?;
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// An image or file clip onto the shelf (`shelf_changed`); text and passwords do not go.
#[tauri::command]
pub fn clip_to_shelf(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let dir = notch_core::shelf::copies_dir(&app.state::<Notch>().data_dir);
    let items = clip_history(&app)?.clip_history.lock().shelf_sources(&id, false, &dir)?;
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
    let path = clip_history(&app)?.clip_history.lock().image_path(&id)?;
    let png = std::fs::read(path).map_err(|_| CmdError::Io)?;
    let preview = notch_win::clip_image::preview_png(&png, 1024).ok_or(CmdError::Io)?;
    Ok(notch_core::clip::data_url(&preview))
}

/// "Copy text" on an image clip: Windows OCR on this PC (no network), the text copied back like `clip_copy` (the
/// listener ignores Notch's own write). `false` = no text found; `unsupported` = no OCR language installed.
#[tauri::command]
pub async fn clip_ocr(app: AppHandle, id: String) -> Res<bool> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = clip_history(&app)?.clip_history.lock().image_path(&id)?; // a password is refused here
    let png = std::fs::read(path).map_err(|_| CmdError::Io)?;
    let text = tauri::async_runtime::spawn_blocking(move || notch_win::ocr::text(&png))
        .await
        .map_err(|_| CmdError::Io)?
        .map_err(|_| CmdError::Unsupported)?;
    if text.is_empty() {
        return Ok(false);
    }
    let payload = notch_core::clip::Payload::Text(notch_core::clip::vault::Secret::new(text.into_bytes()));
    notch_win::clipboard::write(&payload).then_some(true).ok_or(CmdError::Refused)
}

/// Drag out (image and file items). Sync: Windows's drag loop runs on the UI thread that got the mouse press and
/// returns when the drop ends. `refused` = nothing was dropped.
#[tauri::command]
pub fn clip_drag(app: AppHandle, id: String) -> Res<()> {
    let paths = clip_history(&app)?.clip_history.lock().drag_paths(&id)?;
    let dropped = notch_win::drag::files(&paths);
    let _ = app.emit("clip_drag_end", ()); // dropped or given up: the page shows the source again
    dropped.then_some(()).ok_or(CmdError::Refused)
}

/* ---------- Peeka Faz C: downloads (rules: notch_core::downloads, state: downloads.rs) ---------- */

fn download_file(app: &AppHandle, id: &str) -> Res<PathBuf> {
    crate::downloads::file(app, id).ok_or(CmdError::Missing)
}

/// "Open" on a finished download, with its default app. Not for a file Windows would run (`denied`: the owner finds it
/// with "Show in folder"). `missing` = not an id Notch announced, or the file is gone.
#[tauri::command]
pub fn download_open(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = download_file(&app, &id)?;
    if notch_core::shelf::runnable(&path) {
        return Err(CmdError::Denied);
    }
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// "Show in folder": Explorer with the finished download selected.
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

/// What `share_open` would hand Windows: a shelf item's file, or a clipboard item (`denied` for a password, `unknown`
/// for an id Notch did not list).
fn share_target(app: &AppHandle, id: &str) -> Res<(String, ShareTarget)> {
    if let Some(p) = extras(app)?.shelf.lock().path(id) {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        return Ok((name, ShareTarget::Files(vec![p.to_path_buf()])));
    }
    let target = clip_history(app)?.clip_history.lock().share_sheet(id)?;
    Ok((notch_core::PRODUCT_NAME.to_string(), target))
}

/// The Windows share sheet for a shelf or clipboard item; `denied` while Notch is locked. Sync: the sheet belongs to the
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

/// The shelf files to the main assistant only (one-shot share) as copies (`shelf_copy`);
/// `not_connected` without one (checked before copying).
#[tauri::command]
pub fn shelf_ask(app: AppHandle, ids: Vec<String>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let copies = cmd::shelf_copies(main_holds(&app, None)?, ids.iter().map(String::as_str), |id| shelf_copy(&app, id))?;
    if copies.is_empty() {
        return Err(CmdError::NotConnected);
    }
    let attachments: Vec<_> = copies
        .into_iter()
        .map(|path| notch_core::plugins::host::Attachment {
            kind: notch_core::plugins::host::AttachKind::Rack,
            path: Some(path),
            text: None,
        })
        .collect();
    on_host(&app, |h, now| h.composer_submit("", &attachments, now).map(|(_, o)| ((), o)))
}

/* ---------- the Shelf card (direction A): every action takes ids Peeka handed out, never a path ---------- */

fn shelf_paths(app: &AppHandle, ids: &[String]) -> Res<Vec<PathBuf>> {
    extras(app)?.shelf.lock().paths(ids).ok_or(CmdError::Unknown)
}

fn shelf_changed(app: &AppHandle, changed: bool) {
    if changed {
        let _ = app.emit("shelf_changed", ());
    }
}

fn island_hwnd(app: &AppHandle) -> Res<isize> {
    Ok(app.get_webview_window("island").and_then(|w| w.hwnd().ok()).ok_or(CmdError::Unknown)?.0 as isize)
}

/// "Add files": Windows's Open dialog over the island, several files at once. Cancelling is not an error. Sync: the
/// dialog belongs to the island window's (main) thread.
#[tauri::command]
pub fn shelf_add(app: AppHandle) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let picked = notch_win::picker::open_files(island_hwnd(&app)?);
    let items = picked.into_iter().filter_map(|p| Some((p.clone(), Some(std::fs::metadata(&p).ok()?.len())))).collect();
    let changed = extras(&app)?.shelf.lock().add(items);
    shelf_changed(&app, changed);
    Ok(())
}

/// "Open" with the default app (a folder opens in Explorer). Not a file Windows would run (`denied`).
#[tauri::command]
pub fn shelf_open(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = extras(&app)?.shelf.lock().path(&id).ok_or(CmdError::Unknown)?.to_path_buf();
    if notch_core::shelf::runnable(&path) {
        return Err(CmdError::Denied);
    }
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/// Pin keeps a file at the top of the shelf.
#[tauri::command]
pub fn shelf_pin(app: AppHandle, id: String, on: bool) -> Res<()> {
    let ok = extras(&app)?.shelf.lock().pin(&id, on);
    shelf_changed(&app, ok);
    ok.then_some(()).ok_or(CmdError::Unknown)
}

/// Off the shelf. Peeka's own copies (clipboard images, zips) are deleted with it; the owner's files never are.
#[tauri::command]
pub fn shelf_remove(app: AppHandle, ids: Vec<String>) -> Res<()> {
    let changed = extras(&app)?.shelf.lock().remove(&ids);
    shelf_changed(&app, changed);
    Ok(())
}

/// "Copy": the files onto the clipboard as files (paste in Explorer or a chat app); Peeka's own write stays out of
/// the clipboard history.
#[tauri::command]
pub fn shelf_copy_files(app: AppHandle, ids: Vec<String>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let paths = shelf_paths(&app, &ids)?.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    notch_win::clipboard::write(&notch_core::clip::Payload::Files(paths)).then_some(()).ok_or(CmdError::Refused)
}

/// The Windows share sheet with every selected file. Sync: the sheet belongs to the island window's (main) thread.
#[tauri::command]
pub fn shelf_share(app: AppHandle, ids: Vec<String>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let paths = shelf_paths(&app, &ids)?;
    let title = match paths.as_slice() {
        [one] => one.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        many => format!("{} files", many.len()),
    };
    notch_win::share::open(island_hwnd(&app)?, &title, ShareTarget::Files(paths)).then_some(()).ok_or(CmdError::Refused)
}

/// "Show in folder": Explorer with the file selected.
#[tauri::command]
pub fn shelf_show_in_folder(app: AppHandle, id: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let path = extras(&app)?.shelf.lock().path(&id).ok_or(CmdError::Unknown)?.to_path_buf();
    notch_win::downloads::show_in_folder(&path).then_some(()).ok_or(CmdError::Refused)
}

/// "Zip": the files into one zip in Peeka's shelf folder (`notch_core::shelf::copies_dir`), which then joins the
/// shelf on top. Async: the zip runs off the main thread (about half a second).
#[tauri::command]
pub async fn shelf_zip(app: AppHandle, ids: Vec<String>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let paths = shelf_paths(&app, &ids)?;
    let dir = notch_core::shelf::copies_dir(&app.state::<Notch>().data_dir);
    std::fs::create_dir_all(&dir).map_err(|_| CmdError::Io)?;
    let out = notch_core::shelf::zip_target(&dir, &paths);
    let zip = out.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || notch_win::zip::zip(&zip, &paths)).await.unwrap_or(false);
    if !ok {
        return Err(CmdError::Io);
    }
    let size = std::fs::metadata(&out).map_err(|_| CmdError::Io)?.len();
    let changed = extras(&app)?.shelf.lock().add(vec![(out, Some(size))]);
    shelf_changed(&app, changed);
    Ok(())
}

/// Drag out to any app, Explorer or the desktop; the files stay on the shelf. Sync: Windows's drag loop runs on the
/// UI thread that got the mouse press and returns when the drop ends. `refused` = nothing was dropped.
#[tauri::command]
pub fn shelf_drag(app: AppHandle, ids: Vec<String>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let paths = shelf_paths(&app, &ids)?;
    notch_win::drag::files(&paths).then_some(()).ok_or(CmdError::Refused)
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

/// "Open app": the sender's app through `shell:AppsFolder\<its app id>`; the page sends only the card id.
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

/// "Ask assistant": this one notification's text, once, to the main assistant only (one-shot share,
/// the same path as Ctrl+Space). `not_connected` without one, `denied` while Notch is locked.
/// "Copy code" on a mirrored notification that has a one-time code (`hasCode`): the code goes on the clipboard with
/// the same "keep out of history / cloud / monitors" markers as a password, never into Notch's own clipboard, and leaves it
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

/* ---------- Fidelity 3 (shapes: ui/src/fidelity-api.ts, fidelity-cards-api.ts, bridge.ts "FIDELITY BLOCK") ---------- */

/// "Quit app": `WM_CLOSE` to every window of an app in Notch's last strip list (the app may still ask to
/// save; nothing is killed). `unknown` for any other id.
#[tauri::command]
pub fn quit_app(n: State<'_, Notch>, app_id: String) -> Res<()> {
    Ok(apps::close_app(&Win32Control, &n.items.lock(), &app_id)?)
}

/// "Open Windows Start": the Windows key, as if pressed.
#[tauri::command]
pub fn open_start_menu() -> Res<()> {
    notch_win::press_windows_key().then_some(()).ok_or(CmdError::Refused)
}

/// The strip clock: Windows's own notification center and calendar (Win+N), only from the owner's click on it.
#[tauri::command]
pub fn open_calendar() -> Res<()> {
    notch_win::open_calendar_flyout().then_some(()).ok_or(CmdError::Refused)
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

/// fidelity-api.ts `TrayIconX`: `open_tray`'s list plus the colour icon (`color`). No `badge`:
/// `NotifyIconSettings` has no count, and Notch does not guess one.
#[derive(Clone, Serialize)]
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
    Ok(list.into_iter().map(|t| tray_x(&n, t)).collect())
}

/// A listed entry with the tray host's live icon and tip over it, if the host heard one (`tray_host::live`).
pub fn tray_x(n: &Notch, mut icon: notch_core::tray::TrayIcon) -> TrayIconX {
    let live = notch_win::tray_host::live(&icon.exe);
    let color_icon = match live.as_ref().and_then(|l| l.icon.as_ref()) {
        Some(i) => color_of(n, i),
        None => color(n, &icon.id),
    };
    if let Some(l) = live {
        notch_core::tray::overlay(&mut icon, l.icon.map(|i| i.url), l.tip.as_deref());
    }
    TrayIconX { color_icon, icon }
}

/// Start "Recommended": the newest files in the owner's Recent folder (`shell:recent`, its `.lnk` files only;
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

/// Start's pinned grid with folders (`settings::StartItem`), cleaned and saved; every strip hears `settings_changed`
/// (the grid is read from the settings). Windows's own Start pins (`start2.bin`) stay unread: undocumented.
#[tauri::command]
pub fn set_start_items(app: AppHandle, n: State<'_, Notch>, items: Vec<settings::StartItem>) -> Res<UiSettings> {
    {
        let mut s = n.settings.lock();
        let mut next = s.clone();
        next.start_items = Some(settings::clean_start_items(items));
        n.save(&next).map_err(|_| CmdError::Io)?;
        *s = next;
    }
    let ui = ui_settings(&n);
    let _ = app.emit("settings_changed", &ui);
    Ok(ui)
}

/* ---------- Fidelity 3: what the main assistant provides (rules: notch_core::plugins::host::assistant) ---------- */

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
/// (`docs/plugin-api.md` "Claude Code"): installed = Peeka's entries are in Claude Code's settings, healthy = they
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
    let a = agent_bridge(app, &notch_core::plugins::cc_hooks::CLAUDE)?;
    Ok(BridgeState { installed: a.installed, healthy: a.healthy, last_event_ago_s: a.last_event_ago_s })
}

/// Settings' "Install", only from the owner's confirm under the preview (`agent_bridge_preview`): Peeka's hook for all
/// twelve events into Claude Code's `settings.json`, merged (the owner's other hooks stay; a one-time backup
/// `settings.json.bak-peeka`). Refused untouched when the file changed since the preview (`fingerprint`) or has an
/// unexpected shape; the reason goes out as a notice.
#[tauri::command]
pub fn claude_bridge_install(app: AppHandle, fingerprint: String) -> Res<BridgeState> {
    bridge_edit(&app, "claude", true, &fingerprint)?;
    own_bridge(&app)
}

/// "Remove": only Peeka's own entries go, with the same preview and fingerprint as Install.
#[tauri::command]
pub fn claude_bridge_remove(app: AppHandle, fingerprint: String) -> Res<BridgeState> {
    bridge_edit(&app, "claude", false, &fingerprint)?;
    own_bridge(&app)
}

/// What Install (`remove` false) or Remove would change in `agent`'s hook config, nothing written: the changed lines
/// and the fingerprint the confirm sends back. A file Peeka would refuse is refused here already (with the notice).
#[tauri::command]
pub fn agent_bridge_preview(app: AppHandle, agent: String, remove: bool) -> Res<notch_core::plugins::cc_hooks::Preview> {
    not_in_demo()?;
    let a = agent_of(&agent)?;
    let exe = this_exe()?;
    notch_core::plugins::cc_hooks::preview(a, &agent_file(a.id)?, (!remove).then_some(exe.as_str())).map_err(|why| {
        crate::app::notice(&app, &why);
        CmdError::Refused
    })
}

/// Install (`add`) or Remove for one agent; `expect` = the fingerprint of the preview the owner confirmed.
fn bridge_edit(app: &AppHandle, agent: &str, add: bool, expect: &str) -> Res<()> {
    if crate::app::demo() {
        return Err(CmdError::Refused);
    }
    let a = agent_of(agent)?;
    let path = agent_file(a.id)?;
    let r = match add {
        true => notch_core::plugins::cc_hooks::install(a, &path, &this_exe()?, Some(expect)),
        false => notch_core::plugins::cc_hooks::uninstall(a, &path, Some(expect)),
    };
    r.map_err(|why| {
        crate::app::notice(app, &why);
        CmdError::Refused
    })
}

/// One agent row under Settings › Plugins (`docs/plugin-api.md` "Other agents"). `file` is the config Install
/// changes, `~` for the user folder; `present` = that agent's own folder exists (the page lists only those).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBridge {
    id: &'static str,
    name: &'static str,
    file: String,
    present: bool,
    installed: bool,
    healthy: bool,
    last_event_ago_s: Option<u64>,
}

/// Local-only usage snapshots.  We intentionally inspect neither auth files nor
/// provider APIs; Codex writes these public meter values into its rollout log.
#[tauri::command]
pub fn agent_usage(app: AppHandle, refresh: Option<bool>) -> Res<Vec<notch_core::plugins::usage::AgentUsage>> {
    static CACHE: parking_lot::Mutex<Option<(std::time::Instant, Vec<notch_core::plugins::usage::AgentUsage>)>> = parking_lot::Mutex::new(None);
    let mut cache = CACHE.lock();
    if !refresh.unwrap_or(false) && cache.as_ref().is_some_and(|(at, _)| at.elapsed() < std::time::Duration::from_secs(30)) {
        return Ok(cache.as_ref().unwrap().1.clone());
    }
    let root = home()?.join(".codex").join("sessions");
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    fn visit(dir: &Path, newest: &mut Option<(std::time::SystemTime, PathBuf)>) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() { visit(&path, newest); continue; }
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
            let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else { continue; };
            if newest.as_ref().is_none_or(|(time, _)| modified > *time) { *newest = Some((modified, path)); }
        }
    }
    visit(&root, &mut newest);
    let mut usage = Vec::new();
    if let Some((_, path)) = newest {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Some(windows) = text.lines().rev().find_map(|line| { let w = notch_core::plugins::usage::codex_line(line); (!w.is_empty()).then_some(w) }) {
                usage.push(notch_core::plugins::usage::AgentUsage { agent: "codex", windows });
            }
        }
    }
    if let Ok(bytes) = std::fs::read(app.state::<Notch>().data_dir.join("claude-usage.json")) {
        let windows = notch_core::plugins::usage::claude_windows(&bytes);
        if !windows.is_empty() { usage.push(notch_core::plugins::usage::AgentUsage { agent: "claude", windows }); }
    }
    *cache = Some((std::time::Instant::now(), usage.clone()));
    Ok(usage)
}

fn home() -> Res<PathBuf> {
    std::env::var_os("USERPROFILE").filter(|d| !d.is_empty()).map(PathBuf::from).ok_or(CmdError::Missing)
}

/// Each agent's user-level hook config, from its official docs (see `cc_hooks` for the URLs). Copilot's is a file of
/// Peeka's own in its hooks folder (`COPILOT_HOME` as Copilot reads it).
fn agent_file(id: &str) -> Res<PathBuf> {
    Ok(match id {
        "claude" => claude_settings()?,
        "codex" => home()?.join(".codex").join("hooks.json"),
        "cursor" => home()?.join(".cursor").join("hooks.json"),
        "gemini" => home()?.join(".gemini").join("settings.json"),
        _ => std::env::var_os("COPILOT_HOME")
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .map_or_else(|| home().map(|h| h.join(".copilot")), Ok)?
            .join("hooks")
            .join(format!("{}.json", notch_core::brand::EXE_NAME)),
    })
}

fn agent_bridge(app: &AppHandle, a: &'static notch_core::plugins::cc_hooks::Agent) -> Res<AgentBridge> {
    let path = agent_file(a.id)?;
    let (installed, current) = notch_core::plugins::cc_hooks::file_status(a, &path, &this_exe()?);
    let seen = app.try_state::<crate::plugins::Plugins>().and_then(|p| p.cc_seen.lock().get(a.id).copied());
    let dir = if a.id == "copilot" { path.parent().and_then(Path::parent) } else { path.parent() };
    let file = match home() {
        Ok(h) => path.strip_prefix(&h).map_or_else(|_| path.display().to_string(), |r| format!("~\\{}", r.display())),
        Err(_) => path.display().to_string(),
    };
    Ok(AgentBridge {
        id: a.id,
        name: a.name,
        file,
        present: dir.is_some_and(Path::is_dir),
        installed,
        healthy: installed && current,
        last_event_ago_s: seen.map(|t| crate::live::now_ms().saturating_sub(t) / 1000),
    })
}

fn agent_of(id: &str) -> Res<&'static notch_core::plugins::cc_hooks::Agent> {
    notch_core::plugins::cc_hooks::agent(id).ok_or(CmdError::Unknown)
}

/// The agents other than Claude Code (it has its own row, which can also be the main assistant's report).
#[tauri::command]
pub fn agent_bridges(app: AppHandle) -> Res<Vec<AgentBridge>> {
    notch_core::plugins::cc_hooks::AGENTS.iter().skip(1).map(|a| agent_bridge(&app, a)).collect()
}

/// "Install" on an agent's row, only from the owner's confirm under the preview (`agent_bridge_preview`): Peeka's
/// status-only hook merged into that agent's config (a one-time backup `<file>.bak-peeka`, the owner's own hooks stay);
/// a file changed since the preview (`fingerprint`) or of an unexpected shape is refused untouched, the reason as a notice.
#[tauri::command]
pub fn agent_bridge_install(app: AppHandle, agent: String, fingerprint: String) -> Res<AgentBridge> {
    bridge_edit(&app, &agent, true, &fingerprint)?;
    agent_bridge(&app, agent_of(&agent)?)
}

/// "Remove": only Peeka's own entries go.
#[tauri::command]
pub fn agent_bridge_remove(app: AppHandle, agent: String, fingerprint: String) -> Res<AgentBridge> {
    bridge_edit(&app, &agent, false, &fingerprint)?;
    agent_bridge(&app, agent_of(&agent)?)
}

/// "Open terminal": the page names a session (a row's `session`), never a pid. Only a pid the main assistant announced
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

/// The last edit's diff for session `sid`, read on demand from the hook's local cache (`cc_hooks::read_diff`). Never
/// while locked or presenting (`denied`); `missing` = no edit cached for it, or older than 30 min.
#[tauri::command]
pub fn cc_diff(app: AppHandle, sid: String) -> Res<serde_json::Value> {
    cmd::unlocked(crate::privacy::closed(&app))?;
    let e = cc_cached(&sid)?;
    Ok(serde_json::json!({ "file": e.rel, "add": e.add, "del": e.del, "lines": e.lines, "more": e.more }))
}

/// "Open in editor": that edited file with its default app; not a file Windows would run (`denied`).
#[tauri::command]
pub fn cc_diff_open(app: AppHandle, sid: String) -> Res<()> {
    cmd::unlocked(crate::privacy::closed(&app))?;
    let path = PathBuf::from(cc_cached(&sid)?.abs);
    if !path.is_file() {
        return Err(CmdError::Missing);
    }
    if notch_core::shelf::runnable(&path) {
        return Err(CmdError::Denied);
    }
    Win32Control.launch(&path.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

fn cc_cached(sid: &str) -> Res<notch_core::plugins::cc_hooks::Edit> {
    let dir = notch_core::data_dir().ok_or(CmdError::Missing)?.join("cc-diff");
    notch_core::plugins::cc_hooks::read_diff(&dir, sid).ok_or(CmdError::Missing)
}

/// Settings › Permission history, newest first (names and scope names only).
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

/// "Add to Notes": the shelf file to the main assistant (one-shot, the owner's click).
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

/// "Launch" on the not-connected card: the main assistant's manifest `launch` exe, on the owner's click only.
/// Nothing from the page; `missing` when no main assistant, no `launch`, or the file is gone.
#[tauri::command]
pub fn assistant_start(app: AppHandle) -> Res<()> {
    let plugins = app.try_state::<crate::plugins::Plugins>().ok_or(CmdError::Unknown)?;
    let launch = plugins.host.lock().main_launch().map(str::to_owned);
    let target = cmd::assistant_start_target(launch.as_deref(), Path::is_file).ok_or(CmdError::Missing)?;
    Win32Control.launch(&target.to_string_lossy()).then_some(()).ok_or(CmdError::Refused)
}

/* ---------- Fidelity 3: Ctrl+Space attachments (rules: notch_core::fidelity::resolve) ---------- */

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
/// `composer_submit`. `denied` while Notch is locked or when that window is a sensitive app (a notice says
/// why; nothing is captured), `missing` when no app window is open, `refused` when Windows would not draw it.
#[tauri::command]
pub async fn composer_scan(app: AppHandle) -> Res<Option<Attached>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let own = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let hwnd = cmd::scan_target(&Win32Desktop.windows(), &own).inspect_err(|e| {
        if *e == CmdError::Denied {
            crate::app::notice(&app, "This window belongs to a sensitive app (password manager, bank); it was not scanned.");
        }
    })?;
    let png = notch_win::preview::capture_png(hwnd).ok_or(CmdError::Refused)?;
    let (_, path) = notch_core::plugins::share::put(&share_dir(&app)?, &png, "png").map_err(|_| CmdError::Io)?;
    keep_for_composer(&app, AttachKind::Screenshot, path);
    Ok(Some(Attached { kind: "screen_image", label: "Screenshot".into() }))
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

/// F7, the mascot pressed (the page calls this on pointerdown): follows the mouse until it is released. A drag frames
/// the app window under the cursor (`notch_win::outline`); Esc cancels. On release over a window its app name and
/// title (as `window_info`, sent as `clip` text) and a picture of that window only (`screen_image`, the owner's
/// one-time share like `composer_scan`, not taken in demo mode) wait for the next `composer_submit`.
/// None = no drag (a plain click: the page's click runs), `[]` = cancelled. `denied` while locked or for a sensitive
/// app (with `composer_scan`'s notice; nothing is kept).
#[tauri::command]
pub async fn window_pick(app: AppHandle) -> Res<Option<Vec<Attached>>> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    let own = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let windows = Win32Desktop.windows();
    let start = notch_win::style::cursor().ok_or(CmdError::Refused)?;
    let (windows, step) = tauri::async_runtime::spawn_blocking(move || {
        let mut outline: Option<notch_win::outline::Outline> = None; // made on the first frame: a click makes no window
        let mut picker = cmd::Picker::new(start);
        let mut framed = None;
        let step = loop {
            std::thread::sleep(Duration::from_millis(16));
            let cursor = notch_win::style::cursor().unwrap_or(start);
            let root = notch_win::style::root_at(cursor.0, cursor.1);
            let target = cmd::pick_target(&windows, root, &own).map(|w| w.hwnd);
            let tick = cmd::PickTick {
                down: notch_win::style::mouse_down(),
                esc: notch_win::style::esc_down(),
                cursor,
                target,
            };
            match picker.step(tick) {
                cmd::PickStep::Going(t) if t != framed => {
                    framed = t;
                    if outline.is_none() {
                        outline = notch_win::outline::Outline::new();
                    }
                    outline.as_ref().inspect(|o| o.show(t));
                }
                cmd::PickStep::Going(_) => {}
                done => break done,
            }
            outline.as_ref().inspect(|o| o.pump());
        };
        (windows, step)
    })
    .await
    .map_err(|_| CmdError::Unknown)?;
    let hwnd = match step {
        cmd::PickStep::Click => return Ok(None),
        cmd::PickStep::Drop(h) => h,
        _ => return Ok(Some(vec![])),
    };
    let w = windows.iter().find(|w| w.hwnd == hwnd).ok_or(CmdError::Missing)?;
    cmd::not_sensitive(w).inspect_err(|_| {
        crate::app::notice(&app, "This window belongs to a sensitive app (password manager, bank); it was not scanned.");
    })?;
    let n = app.try_state::<Notch>().ok_or(CmdError::Unknown)?;
    let name = apps::find_window(&n.items.lock(), hwnd).map(|(i, _)| i.name.clone()).unwrap_or_else(|| {
        Path::new(&w.exe_path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "App".into())
    });
    let text = Some(cmd::window_context(&name, &w.title));
    // the box is closed whenever the mascot shows, so nothing pending has a chip: an old pick or scan must not go instead
    *n.composer_files.lock() = vec![Attachment { kind: AttachKind::Clip, path: None, text }];
    let mut out = vec![Attached { kind: "window_info", label: format!("Window: {name}") }];
    let png = share_dir(&app).ok().and_then(|dir| Some((dir, notch_win::preview::capture_png(hwnd)?)));
    if let Some((_, path)) = png.and_then(|(dir, png)| notch_core::plugins::share::put(&dir, &png, "png").ok()) {
        keep_for_composer(&app, AttachKind::Screenshot, path);
        out.push(Attached { kind: "screen_image", label: "Screenshot".into() });
    }
    Ok(Some(out))
}

fn keep_for_composer(app: &AppHandle, kind: AttachKind, path: PathBuf) {
    if let Some(n) = app.try_state::<Notch>() {
        let path = Some(path.to_string_lossy().into_owned());
        n.composer_files.lock().push(Attachment { kind, path, text: None });
    }
}

/// The weekly recap card's numbers (last week), while it is still to be offered this week; None otherwise or while
/// locked.
#[tauri::command]
pub fn recap_get(app: AppHandle) -> Res<Option<notch_core::recap::Week>> {
    if crate::plugins::locked(&app) {
        return Ok(None);
    }
    let s = app.try_state::<crate::recap::RecapState>().ok_or(CmdError::Unknown)?;
    let mut r = s.0.lock();
    let week = r.due(crate::recap::today());
    crate::recap::save(&app, &r); // the week may have rolled over
    Ok(week)
}

/// The owner closed the recap card: not again this week.
#[tauri::command]
pub fn recap_ack(app: AppHandle) -> Res<()> {
    let s = app.try_state::<crate::recap::RecapState>().ok_or(CmdError::Unknown)?;
    let mut r = s.0.lock();
    r.ack(crate::recap::today());
    crate::recap::save(&app, &r);
    Ok(())
}

/// "Copy image": the recap picture the page drew (a 1080x1350 PNG) onto the clipboard. Never written to disk.
#[tauri::command]
pub fn recap_copy_image(app: AppHandle, png: Vec<u8>) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    if notch_win::clip_image::png_size(&png) != Some((1080, 1350)) {
        return Err(CmdError::Invalid);
    }
    if !notch_win::clipboard::write(&notch_core::clip::Payload::Png(png)) {
        return Err(CmdError::Refused);
    }
    Ok(())
}

/* ---------- The Modules card's Claude chat (through the owner's Claude Code CLI: `claude_chat.rs`) ---------- */

/// Is Claude Code installed (its version) and signed in, and is a reply running. No tokens are spent.
#[tauri::command]
pub async fn claude_chat_state() -> crate::claude_chat::State {
    crate::claude_chat::state()
}

/// Send: the text (trimmed, 1..=8000 characters, else `invalid`) goes to Claude only now. `refused` while a reply
/// runs, `missing` without Claude Code, `denied` while locked. Demo mode answers with a canned reply.
#[tauri::command]
pub fn claude_chat_send(app: AppHandle, text: String) -> Res<()> {
    cmd::unlocked(crate::plugins::locked(&app))?;
    crate::claude_chat::send(&app, &text)
}

#[tauri::command]
pub fn claude_chat_stop(app: AppHandle) {
    crate::claude_chat::stop(&app);
}

/// A new conversation: stops a running reply and forgets the session.
#[tauri::command]
pub fn claude_chat_new(app: AppHandle) {
    crate::claude_chat::reset(&app);
}
