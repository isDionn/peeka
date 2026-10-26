//! Pinned apps plus open windows, one item per app (owner decision 20).
//!
//! An app's identity is its AppUserModelID when the window has one (Store apps, Chrome profiles and PWAs get their
//! own), else its exe path. `app_id` carries which: `aumid:<id>` or `exe:<lowercased path>`. Pins store the same id.
//! Window filter = what the Windows taskbar shows:
//! visible (a minimised window keeps `WS_VISIBLE`; an app hidden to the tray does not), titled, not a tool / no-activate
//! window, not cloaked, not removed with `ITaskbarList::DeleteTab`, not owned (unless `WS_EX_APPWINDOW`), not the shell's
//! own furniture. Idea from YASB (MIT): `ITaskList_Deleted`.

use serde::{Deserialize, Serialize};

use crate::ports::AppControl;

pub const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
pub const WS_EX_APPWINDOW: u32 = 0x0004_0000;
pub const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
const SHELL_CLASSES: [&str; 4] = ["progman", "workerw", "shell_traywnd", "shell_secondarytraywnd"];

/// What the enumerator saw of one top-level window, before the filter.
#[derive(Clone, Debug, Default)]
pub struct RawWindow {
    pub hwnd: isize,
    pub title: String,
    pub class: String,
    pub ex_style: u32,
    pub visible: bool,
    pub minimized: bool,
    pub cloaked: bool,
    /// The window carries the `ITaskList_Deleted` property (`ITaskbarList::DeleteTab`): its app asked for no button.
    pub deleted: bool,
    pub owned: bool,
    pub aumid: Option<String>,
    /// Full exe path; empty when the process could not be opened (elevated, protected).
    pub exe_path: String,
    pub monitor: Option<usize>,
    /// Notch cannot close it (`beyond_reach`): the strip menu offers "Open Task Manager" instead.
    pub elevated: bool,
}

/// An elevated process (`TokenElevation`, `target` = Some(true)) or one whose token Notch cannot read (None: an
/// elevated or protected process; `WM_CLOSE` is blocked by UIPI there too) is out of a non-elevated Notch's reach.
pub fn beyond_reach(notch_elevated: bool, target: Option<bool>) -> bool {
    !notch_elevated && target != Some(false)
}

/// Notch's own window (its process, or another `peeka.exe`: the guard, a second start)? Never listed as an app: the
/// strip is not a program on the strip. `own_exe` empty = unknown, then only the pid decides.
pub fn is_own(pid: u32, exe_path: &str, own_pid: u32, own_exe: &str) -> bool {
    pid == own_pid || (!own_exe.is_empty() && exe_path.eq_ignore_ascii_case(own_exe))
}

/// Would the Windows taskbar show a button for this window?
pub fn is_app_window(w: &RawWindow) -> bool {
    w.visible
        && !w.deleted
        && !w.title.trim().is_empty()
        && !SHELL_CLASSES.contains(&w.class.to_ascii_lowercase().as_str())
        && w.ex_style & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) == 0
        && !w.cloaked
        && (!w.owned || w.ex_style & WS_EX_APPWINDOW != 0)
}

/// `aumid:<id>` when there is one, else `exe:<lowercased path>`; None = nothing to group by.
pub fn app_id(aumid: Option<&str>, exe_path: &str) -> Option<String> {
    match aumid.map(str::trim).filter(|a| !a.is_empty()) {
        Some(a) => Some(format!("aumid:{a}")),
        None if !exe_path.trim().is_empty() => Some(format!("exe:{}", exe_path.trim().to_lowercase())),
        None => None,
    }
}

/// What `ShellExecute` opens for an app id: `shell:AppsFolder\<AUMID>`, the exe path, or a Start Menu shortcut
/// (`lnk:<path>`, only a `.lnk`). None = not an app id. Also the shell parsing name its icon is read from.
pub fn launch_target(app_id: &str) -> Option<String> {
    if let Some(aumid) = app_id.strip_prefix("aumid:") {
        return Some(format!("shell:AppsFolder\\{aumid}"));
    }
    if let Some(lnk) = app_id.strip_prefix("lnk:") {
        return lnk.to_ascii_lowercase().ends_with(".lnk").then(|| lnk.to_string());
    }
    app_id.strip_prefix("exe:").filter(|p| !p.is_empty()).map(str::to_string)
}

/// Where an app's icon is read from, in order: the id's own target; for an AUMID that is really an exe path (League of
/// Legends sets its window's AUMID to `D:\Riot Games\...\LeagueClient.exe`), that path, since `shell:AppsFolder`
/// doesn't know it and anti-cheat may hide the process's exe; then a running window's package app and exe.
pub fn icon_sources(app_id: &str, pkg_aumid: Option<String>, exe: Option<String>) -> Vec<String> {
    let path = app_id.strip_prefix("aumid:").filter(|a| a.get(1..3) == Some(":\\") && a.to_lowercase().ends_with(".exe"));
    [launch_target(app_id), path.map(str::to_string), pkg_aumid.map(|a| format!("shell:AppsFolder\\{a}")), exe]
        .into_iter()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .collect()
}

/// The exe's file name, lowercased (`C:\x\Code.exe` -> `code.exe`): what shortcut exceptions compare.
pub fn exe_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
}

/// A running app's strip name: the first thing the shell says (`shell(parsing name)`: an exe's FileDescription, an
/// AUMID's display name) about `sources` (the app id's own target, the window's package app, its exe), else
/// `fallback_name`. An answer that is only a file name ("Notepad.exe", Store apps' FileDescription) or the raw AUMID
/// (the shell echoes one it doesn't know, like Blender's `blender.5.2`) doesn't count. File Explorer is named as
/// the taskbar names it (its FileDescription says "Windows Explorer"). Start Menu shortcuts are no source: a folder
/// or log shortcut also targets explorer.exe or notepad.exe.
pub fn display_name(app_id: &str, sources: &[String], shell: impl Fn(&str) -> Option<String>) -> String {
    let fallback = fallback_name(app_id);
    if app_id.starts_with("exe:") && exe_name(app_id) == "explorer.exe" {
        return "File Explorer".into();
    }
    let raw = app_id.split_once(':').map_or(app_id, |(_, rest)| rest);
    sources
        .iter()
        .filter(|t| !t.trim().is_empty())
        .filter_map(|t| shell(t))
        .map(|s| s.trim().chars().take(64).collect::<String>())
        .find(|s| !s.is_empty() && *s != fallback && s != raw && !s.to_lowercase().ends_with(".exe"))
        .unwrap_or(fallback)
}

/// A readable name when nothing better is known: the exe's stem (`code.exe` -> `code`) or the AUMID's last part.
pub fn fallback_name(app_id: &str) -> String {
    let raw = app_id.split_once(':').map_or(app_id, |(_, rest)| rest);
    let tail = raw.rsplit(['\\', '/', '!']).next().unwrap_or(raw);
    tail.strip_suffix(".exe").unwrap_or(tail).to_string()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub app_id: String,
    pub name: String,
    /// The pinned window's relaunch command (`PKEY_AppUserModel_RelaunchCommand`), kept for an AUMID that no Start
    /// entry has: a Chrome / Edge profile, which `shell:AppsFolder` cannot open once its windows are closed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaunch: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowRef {
    pub hwnd: isize,
    pub title: String,
    pub minimized: bool,
    pub monitor: Option<usize>,
    #[serde(default)]
    pub elevated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppItem {
    pub app_id: String,
    pub name: String,
    pub pinned: bool,
    /// Lower-case exe file name ("" for a pinned app that is not running).
    pub exe: String,
    pub windows: Vec<WindowRef>,
}

/// Pins first in pin order (each with its open windows, a pin with none is a launch tile), then the other apps in
/// enumeration order (`keep_order` makes it first-seen). `windows` is the enumerator's raw list; the filter runs here.
/// `target`: an `aumid:` pin's exe path (its `shell:AppsFolder` link target). A desktop app that sets its AUMID per process
/// (Discord, Opera) has windows without one; they join that pin by exe (`same_exe`), as the Windows taskbar groups them.
pub fn merge(pins: &[Pin], windows: &[RawWindow], target: impl Fn(&str) -> Option<String>) -> Vec<AppItem> {
    let targets: Vec<Option<String>> = pins.iter().map(|p| p.app_id.starts_with("aumid:").then(|| target(&p.app_id)).flatten()).collect();
    let mut items: Vec<AppItem> = pins
        .iter()
        .map(|p| AppItem {
            app_id: p.app_id.clone(),
            name: p.name.clone(),
            pinned: true,
            exe: String::new(),
            windows: vec![],
        })
        .collect();
    for w in windows.iter().filter(|w| is_app_window(w)) {
        let Some(id) = app_id(w.aumid.as_deref(), &w.exe_path) else { continue };
        let by_exe = || w.aumid.is_none().then(|| targets.iter().position(|t| t.as_deref().is_some_and(|t| same_exe(t, &w.exe_path)))).flatten();
        let at = match items.iter().position(|i| i.app_id.eq_ignore_ascii_case(&id)).or_else(by_exe) {
            Some(at) => at,
            None => {
                let name = fallback_name(&id);
                items.push(AppItem { app_id: id, name, pinned: false, exe: String::new(), windows: vec![] });
                items.len() - 1
            }
        };
        let item = &mut items[at];
        if item.exe.is_empty() {
            item.exe = exe_name(&w.exe_path);
        }
        item.windows.push(WindowRef {
            hwnd: w.hwnd,
            title: w.title.clone(),
            minimized: w.minimized,
            monitor: w.monitor,
            elevated: w.elevated,
        });
    }
    items
}

/// Is the running `exe` the app a pin's `target` starts? The same path, or the same file one folder down: Squirrel apps
/// (Discord, Slack) run `<dir>\app-1.2.3\x.exe` from a `<dir>\x.exe` stub. shortcut: a launcher that starts a differently
/// named exe (FiveM's game process) stays apart; a process's own AUMID has no public getter.
pub fn same_exe(target: &str, exe: &str) -> bool {
    let (t, e) = (target.to_lowercase(), exe.to_lowercase());
    let Some((dir, file)) = t.rsplit_once('\\') else { return false };
    t == e || e.strip_prefix(dir).and_then(|r| r.strip_prefix('\\')?.split_once('\\')).is_some_and(|(sub, f)| !sub.is_empty() && f == file)
}

/// The strip keeps its order when the focus moves (EnumWindows lists in Z-order): unpinned apps, and each app's
/// windows, stay where `prev` (the last list) had them; new ones go last. Pins keep pin order. Idea from new_win (MIT).
pub fn keep_order(prev: &[AppItem], mut next: Vec<AppItem>) -> Vec<AppItem> {
    let at = |id: &str| prev.iter().position(|p| p.app_id == id).unwrap_or(usize::MAX);
    let pins = next.iter().take_while(|i| i.pinned).count();
    next[pins..].sort_by_key(|i| at(&i.app_id)); // stable: new apps keep their order among themselves
    for item in &mut next {
        let Some(old) = prev.iter().find(|p| p.app_id == item.app_id) else { continue };
        item.windows.sort_by_key(|w| old.windows.iter().position(|o| o.hwnd == w.hwnd).unwrap_or(usize::MAX));
    }
    next
}

/// A relaunch command line as `ShellExecute` takes it: (file, arguments). A quoted file, or an unquoted path cut after
/// its `.exe`. None = empty.
pub fn split_command(cmd: &str) -> Option<(String, String)> {
    let cmd = cmd.trim();
    let (file, args) = if let Some(rest) = cmd.strip_prefix('"') {
        rest.split_once('"').unwrap_or((rest, ""))
    } else if let Some(end) = cmd.to_ascii_lowercase().find(".exe").map(|i| i + 4) {
        cmd.split_at(end)
    } else {
        cmd.split_once(' ').unwrap_or((cmd, ""))
    };
    (!file.trim().is_empty()).then(|| (file.trim().to_string(), args.trim().to_string()))
}

/// One app of the Start panel's list (a Start Menu shortcut). `exe` = the shortcut target's lower-case file name
/// (what a shortcut exception compares), None when it is not an exe (a URL, a Store app link).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListedApp {
    pub app_id: String,
    pub name: String,
    pub exe: Option<String>,
}

/// Start Menu entries that are not apps.
// Includes Turkish Start Menu words (kept on purpose: a Turkish Windows names its entries that way).
const JUNK: [&str; 26] = [
    "uninstall",
    "kaldır",
    "kaldir",
    "readme",
    "release notes",
    "license",
    "licence",
    "lisans",
    "documentation",
    "doküman",
    "dokuman",
    "help",
    "yardım",
    "website",
    "web sitesi",
    "support",
    "manual",
    "kılavuz",
    "setup",
    "install",
    "updater",
    "update",
    "feedback",
    "changelog",
    "repair",
    "tutorial",
];

/// Keep a Start Menu shortcut by its name: at least 3 letters, no junk word.
pub fn keep_start_name(name: &str) -> bool {
    let low = name.to_lowercase();
    low.chars().filter(|c| c.is_alphanumeric()).count() >= 3 && !JUNK.iter().any(|j| low.contains(j))
}

/// Lower case with the Turkish I's folded together (`İ` -> `i`, `ı` -> `i`), for matching only.
pub fn fold(s: &str) -> String {
    s.chars().flat_map(char::to_lowercase).filter(|c| *c != '\u{307}').map(|c| if c == 'ı' { 'i' } else { c }).collect()
}

/// A Ctrl+K result. Its id is what the page gets and sends back to `open_result`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Hit {
    App(String),
    Window(isize),
}

impl Hit {
    pub fn id(&self) -> String {
        match self {
            Hit::App(a) => format!("app:{a}"),
            Hit::Window(h) => format!("win:{h}"),
        }
    }
    pub fn parse(id: &str) -> Option<Hit> {
        if let Some(a) = id.strip_prefix("app:") {
            return Some(Hit::App(a.to_string()));
        }
        id.strip_prefix("win:")?.parse().ok().map(Hit::Window)
    }
}

/// Ctrl+K, Wave 1: apps and open windows only. An empty query gives two windows and two apps as suggestions.
pub fn search(query: &str, apps: &[ListedApp], items: &[AppItem]) -> Vec<Hit> {
    const EACH: usize = 5;
    let q = fold(query.trim());
    let windows = items.iter().flat_map(|i| i.windows.iter().map(move |w| (i, w)));
    if q.is_empty() {
        let w = windows.take(2).map(|(_, w)| Hit::Window(w.hwnd));
        return w.chain(apps.iter().take(2).map(|a| Hit::App(a.app_id.clone()))).collect();
    }
    let a = apps.iter().filter(|a| fold(&a.name).contains(&q)).take(EACH).map(|a| Hit::App(a.app_id.clone()));
    let w = windows
        .filter(|(i, w)| fold(&w.title).contains(&q) || fold(&i.name).contains(&q))
        .take(EACH)
        .map(|(_, w)| Hit::Window(w.hwnd));
    a.chain(w).collect()
}

/// Start an app the page saw in either list: the strip's (pins + windows) or the Start panel's.
pub fn launch_any(
    ctl: &dyn AppControl,
    items: &[AppItem],
    apps: &[ListedApp],
    app_id: &str,
    relaunch: Option<&str>,
) -> Result<(), AppError> {
    if items.iter().any(|i| i.app_id == app_id) {
        return launch(ctl, items, app_id, relaunch);
    }
    let listed = apps.iter().find(|a| a.app_id == app_id).ok_or(AppError::Unknown)?;
    let target = launch_target(&listed.app_id).ok_or(AppError::Unknown)?;
    ctl.launch(&target).then_some(()).ok_or(AppError::Refused)
}

/// Is `hwnd` one of the windows in this snapshot? Commands from the page act only on what Notch listed.
pub fn find_window(items: &[AppItem], hwnd: isize) -> Option<(&AppItem, &WindowRef)> {
    items.iter().find_map(|i| i.windows.iter().find(|w| w.hwnd == hwnd).map(|w| (i, w)))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppError {
    /// Not in Notch's current list (the page asked for something Notch never showed).
    Unknown,
    /// Windows refused (gone meanwhile, or the app said no).
    Refused,
    /// An elevated window (`WindowRef::elevated`): nothing is sent, the page offers the Task Manager.
    Elevated,
}

fn item<'a>(items: &'a [AppItem], app_id: &str) -> Result<&'a AppItem, AppError> {
    items.iter().find(|i| i.app_id == app_id).ok_or(AppError::Unknown)
}

/// Start an app from the list (a new window too). The target comes from the id, never from the page; an AUMID app
/// with a relaunch command (its window's, or its pin's: a Chrome / Edge profile) runs that instead, as the Windows
/// taskbar does. Idea from new_win (MIT).
pub fn launch(ctl: &dyn AppControl, items: &[AppItem], app_id: &str, relaunch: Option<&str>) -> Result<(), AppError> {
    let id = &item(items, app_id)?.app_id;
    if let Some((file, args)) = relaunch.filter(|_| id.starts_with("aumid:")).and_then(split_command) {
        return ctl.run(&file, &args).then_some(()).ok_or(AppError::Refused);
    }
    let target = launch_target(id).ok_or(AppError::Unknown)?;
    ctl.launch(&target).then_some(()).ok_or(AppError::Refused)
}

/// The item's click: its front window comes forward; an app with no window starts.
pub fn activate(ctl: &dyn AppControl, items: &[AppItem], app_id: &str) -> Result<(), AppError> {
    match item(items, app_id)?.windows.first() {
        Some(w) => ctl.focus(w.hwnd).then_some(()).ok_or(AppError::Refused),
        None => launch(ctl, items, app_id, None),
    }
}

/// "Close window" on one listed window.
pub fn close_window(ctl: &dyn AppControl, items: &[AppItem], hwnd: isize) -> Result<(), AppError> {
    if find_window(items, hwnd).ok_or(AppError::Unknown)?.1.elevated {
        return Err(AppError::Elevated);
    }
    ctl.close(hwnd).then_some(()).ok_or(AppError::Refused)
}

/// "Quit app" (Wave 1): `WM_CLOSE` to every window of the app; no `TerminateProcess` yet.
pub fn close_app(ctl: &dyn AppControl, items: &[AppItem], app_id: &str) -> Result<(), AppError> {
    let windows = &item(items, app_id)?.windows;
    if windows.iter().any(|w| w.elevated) {
        return Err(AppError::Elevated);
    }
    let mut all = true;
    for w in windows {
        all &= ctl.close(w.hwnd);
    }
    all.then_some(()).ok_or(AppError::Refused)
}

/// The shell items in the Windows taskbar's `Explorer\Taskband` `Favorites` value, in taskbar order: per pin
/// `[0][u32 length][ITEMIDLIST]`, ended by `0xFF` (Windows 10 / 11). A malformed entry ends the list there.
pub fn taskband_items(blob: &[u8]) -> Vec<&[u8]> {
    let mut out = vec![];
    let mut at = 0;
    while blob.get(at) == Some(&0) {
        let Some(len) = blob.get(at + 1..at + 5).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize) else { break };
        let Some(item) = blob.get(at + 5..at + 5 + len) else { break };
        out.push(item);
        at += 5 + len;
    }
    out
}

/// One Windows taskbar pin, from its shell item's desktop parsing name.
#[derive(Debug, PartialEq, Eq)]
pub enum TaskbarPin {
    /// An Apps-folder item (packaged apps): its AUMID.
    App(String),
    /// A shortcut file (`User Pinned\TaskBar\*.lnk`, or a Start Menu one): its path.
    Shortcut(String),
}

/// The shell names an Apps-folder item by its bare AUMID, or as `shell:::{folder}\Apps\<AUMID>` (seen on Windows 11).
pub fn taskbar_pin(parsing: &str) -> Option<TaskbarPin> {
    let p = parsing.trim();
    if p.to_ascii_lowercase().ends_with(".lnk") {
        return Some(TaskbarPin::Shortcut(p.to_string()));
    }
    let aumid = if p.starts_with("shell:::") || p.starts_with("::") { p.rsplit('\\').next().unwrap_or("") } else { p };
    let file_path = aumid.contains(":\\") || aumid.starts_with("\\\\");
    (!aumid.is_empty() && !aumid.starts_with(':') && !file_path).then(|| TaskbarPin::App(aumid.to_string()))
}

/// A pinned shortcut's id, the way the strip will see its window: the id a running app already has among the shortcut's
/// AUMID and target exe; else its AUMID (how Windows groups it); else its target exe; else the shortcut itself.
/// `target` = None for a shortcut with arguments: only the shortcut itself starts it right (a `.bat` run by cmd.exe).
pub fn shortcut_id(lnk: &str, aumid: Option<&str>, target: Option<&str>, running: &[String]) -> String {
    // File Explorer sets its AUMID per process, never on a window: the strip knows its windows by exe
    let by_aumid = app_id(aumid, "").filter(|id| id.starts_with("aumid:") && id != "aumid:Microsoft.Windows.Explorer");
    let by_exe = target.filter(|t| exe_name(t).ends_with(".exe")).and_then(|t| app_id(None, t));
    let seen = |id: &Option<String>| id.as_ref().is_some_and(|id| running.iter().any(|r| r.eq_ignore_ascii_case(id)));
    let id = if !seen(&by_aumid) && seen(&by_exe) { by_exe } else { by_aumid.or(by_exe) };
    id.unwrap_or_else(|| format!("lnk:{lnk}"))
}

/// `pins` first and untouched; then each imported pin whose app is not pinned yet, in the taskbar's order. Never removes.
pub fn add_pins(pins: &[Pin], imported: Vec<Pin>) -> Vec<Pin> {
    let mut out = pins.to_vec();
    for p in imported {
        if !out.iter().any(|o| o.app_id.eq_ignore_ascii_case(&p.app_id)) {
            out.push(p);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake::FakeAppControl;

    #[test]
    fn taskbar_pins_keep_windows_order_and_add_only_new_ones() {
        // two entries, then the end marker; a third entry cut short is ignored
        let mut blob = vec![0, 3, 0, 0, 0, 1, 2, 3, 0, 2, 0, 0, 0, 9, 9, 0xFF];
        assert_eq!(taskband_items(&blob), [&[1u8, 2, 3][..], &[9, 9][..]]);
        blob.truncate(15);
        blob.extend([0, 9, 0, 0, 0, 1]);
        assert_eq!(taskband_items(&blob).len(), 2, "a cut entry ends the list");
        assert!(taskband_items(&[]).is_empty());

        // the parsing names Windows 11 gave on the owner's PC: a bare AUMID, an Apps-folder path, a shortcut file
        let app = |s: &str| Some(TaskbarPin::App(s.into()));
        assert_eq!(taskbar_pin("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"), app("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"));
        assert_eq!(taskbar_pin(r"shell:::{AD1405D2-30CF-4877-8468-1EE1C52C759F}\Apps\Microsoft.Todos_8wekyb3d8bbwe!App"), app("Microsoft.Todos_8wekyb3d8bbwe!App"));
        assert_eq!(taskbar_pin("OperaSoftware.OperaGXWebBrowser.1755079229"), app("OperaSoftware.OperaGXWebBrowser.1755079229"));
        assert_eq!(taskbar_pin(r"C:\U\TaskBar\Discord.LNK"), Some(TaskbarPin::Shortcut(r"C:\U\TaskBar\Discord.LNK".into())));
        assert_eq!(taskbar_pin(r"C:\x\notes.txt"), None);
        assert_eq!(taskbar_pin("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}"), None, "a bare shell folder is no app");

        let lnk = r"C:\U\TaskBar\Browser.lnk";
        assert_eq!(shortcut_id(lnk, Some("Browser.Profile"), Some(r"C:\B\b.exe"), &[]), "aumid:Browser.Profile", "Windows' grouping");
        let running = [r"exe:c:\b\b.exe".to_string()];
        assert_eq!(shortcut_id(lnk, Some("Browser.Profile"), Some(r"C:\B\b.exe"), &running), r"exe:c:\b\b.exe", "a running window wins");
        assert_eq!(shortcut_id(lnk, None, Some(r"C:\B\b.exe"), &[]), r"exe:c:\b\b.exe");
        assert_eq!(shortcut_id(lnk, None, Some(r"C:\B\run.bat"), &[]), format!("lnk:{lnk}"), "not an exe: the shortcut opens itself");
        let explorer = shortcut_id(lnk, Some("Microsoft.Windows.Explorer"), Some(r"C:\Windows\explorer.exe"), &[]);
        assert_eq!(explorer, r"exe:c:\windows\explorer.exe", "Explorer's windows carry no AUMID");

        let pin = |id: &str| Pin { app_id: id.into(), name: id.into(), relaunch: None };
        let mine = [pin(r"exe:c:\p.exe"), pin("aumid:Mine")];
        let taskbar = vec![pin("aumid:New1"), pin("AUMID:mine"), pin(r"exe:c:\p.exe"), pin("aumid:New2"), pin("aumid:New1")];
        let ids: Vec<_> = add_pins(&mine, taskbar).into_iter().map(|p| p.app_id).collect();
        assert_eq!(ids, [r"exe:c:\p.exe", "aumid:Mine", "aumid:New1", "aumid:New2"], "existing first, no duplicates, nothing removed");
    }

    /// 0.3.4 on the owner's PC: unpinned apps showed "explorer", "claude", "blender.5.2".
    #[test]
    fn strip_names_are_the_apps_own_not_the_exe_stem() {
        let shell = |t: &str| match t {
            r"c:\x\claude.exe" => Some(" Claude ".to_string()),
            r"C:\B\blender.exe" => Some("Blender".to_string()),
            r"shell:AppsFolder\blender.5.2" => Some("blender.5.2".to_string()), // the shell echoes an AUMID it doesn't know
            r"shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App" => Some("Paint".to_string()),
            r"c:\w\mspaint.exe" => Some("mspaint.exe".to_string()), // a Store app's FileDescription
            r"c:\x\y.exe" => Some("  ".to_string()),
            _ => None,
        };
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(display_name(r"exe:c:\windows\explorer.exe", &s(&[r"c:\windows\explorer.exe"]), shell), "File Explorer");
        assert_eq!(display_name(r"exe:c:\x\claude.exe", &s(&[r"c:\x\claude.exe"]), shell), "Claude", "FileDescription");
        let blender = s(&[r"shell:AppsFolder\blender.5.2", "", r"C:\B\blender.exe"]);
        assert_eq!(display_name("aumid:blender.5.2", &blender, shell), "Blender", "unknown AUMID: the window's exe");
        let paint = s(&[r"c:\w\mspaint.exe", r"shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App"]);
        assert_eq!(display_name(r"exe:c:\w\mspaint.exe", &paint, shell), "Paint", "a file name is no name: the package's");
        assert_eq!(display_name(r"exe:c:\x\codewalker.exe", &s(&[r"c:\x\codewalker.exe"]), shell), "codewalker", "nothing better: the stem");
        assert_eq!(display_name(r"exe:c:\x\y.exe", &s(&[r"c:\x\y.exe"]), shell), "y", "a blank description is not a name");
        assert_eq!(display_name("aumid:Some.App", &[], shell), "Some.App");
    }

    #[test]
    fn actions_only_reach_what_notch_listed() {
        let items = merge(&[Pin { app_id: "aumid:A!App".into(), name: "A".into(), relaunch: None }], &[win(9, "C:\\b.exe", None)], |_| None);
        let ctl = FakeAppControl::default();
        assert_eq!(activate(&ctl, &items, "aumid:A!App"), Ok(()));
        assert_eq!(activate(&ctl, &items, "exe:c:\\b.exe"), Ok(()));
        assert_eq!(launch(&ctl, &items, "exe:c:\\windows\\system32\\cmd.exe", None), Err(AppError::Unknown));
        assert_eq!(close_window(&ctl, &items, 1234), Err(AppError::Unknown));
        assert_eq!(close_app(&ctl, &items, "exe:c:\\b.exe"), Ok(()));
        assert_eq!(close_app(&ctl, &items, "exe:c:\\windows\\explorer.exe"), Err(AppError::Unknown), "quit_app");
        assert_eq!(*ctl.log.borrow(), ["launch shell:AppsFolder\\A!App", "focus 9", "close 9"]);
    }

    #[test]
    fn an_elevated_window_is_never_sent_wm_close_and_asks_for_the_task_manager() {
        assert!(beyond_reach(false, Some(true)), "elevated");
        assert!(beyond_reach(false, None), "token unreadable: elevated or protected");
        assert!(!beyond_reach(false, Some(false)), "an ordinary app");
        assert!(!beyond_reach(true, Some(true)) && !beyond_reach(true, None), "an elevated Notch reaches it");
        let admin = RawWindow { elevated: true, ..win(7, "C:\\regedit.exe", None) };
        let items = merge(&[], &[admin, win(8, "C:\\b.exe", None)], |_| None);
        assert!(items[0].windows[0].elevated && !items[1].windows[0].elevated, "merge keeps the flag");
        let ctl = FakeAppControl::default();
        assert_eq!(close_window(&ctl, &items, 7), Err(AppError::Elevated));
        assert_eq!(close_app(&ctl, &items, "exe:c:\\regedit.exe"), Err(AppError::Elevated));
        assert_eq!(close_window(&ctl, &items, 8), Ok(()));
        assert_eq!(*ctl.log.borrow(), ["close 8"], "nothing was posted to the elevated window");
        assert_eq!(crate::cmd::CmdError::from(AppError::Elevated), crate::cmd::CmdError::Denied);
    }

    #[test]
    fn start_list_launch_search_and_ids() {
        let apps = vec![
            // Turkish dotted I on purpose: app names on a Turkish Windows must fold to plain `i` for search.
            ListedApp { app_id: "lnk:c:\\p\\İnkscape.lnk".into(), name: "İnkscape".into(), exe: None },
            ListedApp { app_id: "lnk:c:\\p\\Word.lnk".into(), name: "Word".into(), exe: Some("winword.exe".into()) },
        ];
        let items = merge(&[], &[win(9, "C:\\b.exe", None)], |_| None);
        let ctl = FakeAppControl::default();
        assert_eq!(launch_any(&ctl, &items, &apps, "lnk:c:\\p\\Word.lnk", None), Ok(()));
        assert_eq!(launch_any(&ctl, &items, &apps, "lnk:c:\\evil.lnk", None), Err(AppError::Unknown));
        assert_eq!(launch_any(&ctl, &items, &apps, "exe:c:\\b.exe", Some(r#""c:\x.exe" --y"#)), Ok(()), "exe ids ignore it");
        assert_eq!(*ctl.log.borrow(), ["launch c:\\p\\Word.lnk", "launch c:\\b.exe"]);
        assert_eq!(launch_target("lnk:c:\\x.exe"), None, "lnk: is only ever a shortcut");
        assert_eq!(search("INKS", &apps, &items), [Hit::App(apps[0].app_id.clone())], "İ folds to i");
        assert_eq!(search("w9", &apps, &items), [Hit::Window(9)]);
        assert_eq!(search(" ", &apps, &items).len(), 3);
        assert_eq!(Hit::parse(&Hit::Window(-5).id()), Some(Hit::Window(-5)));
        assert_eq!(Hit::parse("app:x"), Some(Hit::App("x".into())));
        assert_eq!(Hit::parse("win:abc"), None);
        assert!(keep_start_name("Visual Studio Code") && !keep_start_name("Uninstall Foo") && !keep_start_name("Go"));
    }

    fn win(hwnd: isize, exe: &str, aumid: Option<&str>) -> RawWindow {
        RawWindow {
            hwnd,
            title: format!("w{hwnd}"),
            class: "Chrome_WidgetWin_1".into(),
            visible: true,
            aumid: aumid.map(str::to_string),
            exe_path: exe.into(),
            ..Default::default()
        }
    }

    #[test]
    fn notchs_own_processes_are_not_apps() {
        let own = "C:/Peeka/peeka.exe";
        assert!(is_own(7, "", 7, own), "same process, exe unreadable");
        assert!(is_own(8, "c:/peeka/PEEKA.exe", 7, own), "the guard / a second start: same exe, other pid");
        assert!(!is_own(9, "C:/a.exe", 7, own));
        assert!(!is_own(9, "", 7, own), "an unreadable process is not Notch");
        assert!(!is_own(9, "", 7, ""), "unknown own exe: only the pid counts");
    }

    #[test]
    fn the_filter_is_the_taskbar_rule() {
        let ok = win(1, "C:\\a.exe", None);
        assert!(is_app_window(&ok));
        assert!(is_app_window(&RawWindow { minimized: true, ..ok.clone() }), "minimised counts");
        assert!(!is_app_window(&RawWindow { visible: false, minimized: true, ..ok.clone() }), "hidden to the tray");
        assert!(!is_app_window(&RawWindow { deleted: true, ..ok.clone() }), "ITaskList_Deleted");
        assert!(!is_app_window(&RawWindow { visible: false, ..ok.clone() }));
        assert!(!is_app_window(&RawWindow { title: "  ".into(), ..ok.clone() }));
        assert!(!is_app_window(&RawWindow { class: "Shell_TrayWnd".into(), ..ok.clone() }));
        assert!(!is_app_window(&RawWindow { ex_style: WS_EX_TOOLWINDOW, ..ok.clone() }));
        assert!(!is_app_window(&RawWindow { ex_style: WS_EX_NOACTIVATE, ..ok.clone() }));
        assert!(!is_app_window(&RawWindow { cloaked: true, ..ok.clone() }), "another virtual desktop / a hidden UWP");
        assert!(!is_app_window(&RawWindow { owned: true, ..ok.clone() }), "a dialog");
        assert!(is_app_window(&RawWindow { owned: true, ex_style: WS_EX_APPWINDOW, ..ok }), "forced onto the bar");
    }

    #[test]
    fn identity_is_the_aumid_else_the_lowercased_exe_path() {
        assert_eq!(
            app_id(Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), "C:\\x.exe").unwrap(),
            "aumid:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
        );
        assert_eq!(app_id(Some(" "), "C:\\Apps\\Code.exe").unwrap(), "exe:c:\\apps\\code.exe");
        assert_eq!(app_id(None, ""), None);
        assert_eq!(launch_target("aumid:A!B").unwrap(), "shell:AppsFolder\\A!B");
        assert_eq!(launch_target("exe:c:\\a.exe").unwrap(), "c:\\a.exe");
        assert_eq!(launch_target("C:\\Windows\\cmd.exe"), None, "only ids Notch made");
        assert_eq!(launch_target("exe:"), None);
        assert_eq!(
            icon_sources(r"aumid:D:\Riot Games\LeagueClient.exe", None, Some(String::new())),
            [r"shell:AppsFolder\D:\Riot Games\LeagueClient.exe", r"D:\Riot Games\LeagueClient.exe"],
            "an AUMID that is an exe path is read as that path; an unreadable exe adds nothing"
        );
        assert_eq!(
            icon_sources("aumid:A!B", Some("P!App".into()), Some(r"c:.exe".into())),
            [r"shell:AppsFolder\A!B", r"shell:AppsFolder\P!App", r"c:.exe"]
        );
        assert_eq!(exe_name("C:\\Users\\x\\AppData\\Discord.exe"), "discord.exe");
    }

    #[test]
    fn pinned_and_open_windows_merge_into_one_item_per_app() {
        let pins = vec![
            Pin { app_id: "exe:c:\\chrome.exe".into(), name: "Chrome".into(), relaunch: None },
            Pin { app_id: "aumid:Spotify".into(), name: "Spotify".into(), relaunch: None },
        ];
        let windows = vec![
            win(1, "C:\\Code.exe", None),
            win(2, "C:\\Chrome.exe", None),
            win(3, "C:\\Chrome.exe", None),
            win(4, "C:\\Chrome.exe", Some("Chrome.Profile2")), // its own identity, its own item
            RawWindow { cloaked: true, ..win(5, "C:\\Code.exe", None) },
        ];
        let items = merge(&pins, &windows, |_| None);
        let shape: Vec<_> = items.iter().map(|i| (i.name.as_str(), i.pinned, i.windows.len())).collect();
        assert_eq!(
            shape,
            [("Chrome", true, 2), ("Spotify", true, 0), ("code", false, 1), ("Chrome.Profile2", false, 1)]
        );
        assert_eq!(items[0].exe, "chrome.exe");
        assert_eq!(items[1].exe, "", "a pin with no window is a launch tile");
        assert_eq!(find_window(&items, 3).map(|(i, _)| i.name.as_str()), Some("Chrome"));
        assert!(find_window(&items, 5).is_none(), "a filtered window is not actionable");
    }

    /// RC7 on the owner's PC: 20 imported taskbar pins, and Terminal, Claude, Discord, Opera showed twice (pin + tab).
    /// Ids and paths as the owner's PC reported them (home folder shortened).
    #[test]
    fn a_running_app_lights_up_its_imported_pin_instead_of_a_second_item() {
        let pin = |id: &str| Pin { app_id: id.into(), name: id.into(), relaunch: None };
        let pins = [
            pin("aumid:Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"), // Store app: the window has only its package's AUMID
            pin("aumid:com.squirrel.Discord.Discord"),                // Squirrel: stub at the root, app in app-<version>\
            pin("aumid:OperaSoftware.OperaGXWebBrowser.1755079229"),  // per-process AUMID: the window has none
            pin("aumid:Chrome"),
            pin(r"exe:c:\windows\explorer.exe"),
            pin("aumid:CitizenFX.FiveM.Client"),
        ];
        let target = |id: &str| match id {
            "aumid:com.squirrel.Discord.Discord" => Some(r"C:\U\AppData\Local\Discord\Discord.exe".to_string()),
            "aumid:OperaSoftware.OperaGXWebBrowser.1755079229" => Some(r"C:\U\AppData\Local\Programs\Opera GX\opera.exe".to_string()),
            "aumid:Chrome" => Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string()),
            "aumid:CitizenFX.FiveM.Client" => Some(r"C:\U\AppData\Local\FiveM\FiveM.exe".to_string()),
            _ => None,
        };
        let windows = [
            win(1, r"C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.11911.0_x64__8wekyb3d8bbwe\WindowsTerminal.exe", Some("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App")),
            win(2, r"C:\U\AppData\Local\Discord\app-1.0.9265\Discord.exe", None),
            win(3, r"C:\U\AppData\Local\Programs\Opera GX\opera.exe", None),
            win(4, r"C:\Program Files\Google\Chrome\Application\chrome.exe", None),
            win(5, r"C:\Program Files\Google\Chrome\Application\chrome.exe", Some("Chrome.UserData.Profile 2")),
            win(6, r"C:\Windows\explorer.exe", None),
            win(7, r"C:\U\AppData\Roaming\Spotify\Spotify.exe", None),
            win(8, r"C:\U\AppData\Local\FiveM\FiveM.app\data\cache\subprocess\FiveM_b3258_GTAProcess.exe", None),
            win(9, r"C:\U\AppData\Local\Discord\app-1.0.9265\Discord.exe", None),
        ];
        let items = merge(&pins, &windows, target);
        let shape: Vec<_> = items.iter().map(|i| (i.app_id.as_str(), i.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>())).collect();
        assert_eq!(
            shape,
            [
                ("aumid:Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", vec![1]),
                ("aumid:com.squirrel.Discord.Discord", vec![2, 9]),
                ("aumid:OperaSoftware.OperaGXWebBrowser.1755079229", vec![3]),
                ("aumid:Chrome", vec![4]),
                (r"exe:c:\windows\explorer.exe", vec![6]),
                ("aumid:CitizenFX.FiveM.Client", vec![]),
                ("aumid:Chrome.UserData.Profile 2", vec![5]), // a profile keeps its own item, as on the Windows taskbar
                (r"exe:c:\u\appdata\roaming\spotify\spotify.exe", vec![7]),
                (r"exe:c:\u\appdata\local\fivem\fivem.app\data\cache\subprocess\fivem_b3258_gtaprocess.exe", vec![8]), // the shortcut above
            ]
        );
        let ids = merge(&[pin("aumid:microsoft.todos_8wekyb3d8bbwe!app")], &[win(1, r"C:\t.exe", Some("Microsoft.Todos_8wekyb3d8bbwe!App"))], |_| None);
        assert_eq!(ids.len(), 1, "AUMIDs compare without case");
        assert!(same_exe(r"C:\A\x.exe", r"c:\a\X.EXE") && same_exe(r"C:\A\x.exe", r"C:\A\app-2\x.exe"));
        assert!(!same_exe(r"C:\A\x.exe", r"C:\A\b\c\x.exe"), "two folders down is another app (Steam games under Steam)");
        assert!(!same_exe(r"C:\A\x.exe", r"C:\A\app-2\y.exe") && !same_exe(r"C:\A\x.exe", r"C:\AB\app\x.exe"));
    }

    #[test]
    fn switching_apps_does_not_reorder_the_strip() {
        let pins = [Pin { app_id: "exe:c:\\p.exe".into(), name: "P".into(), relaunch: None }];
        let z = |order: &[(isize, &str)]| order.iter().map(|&(h, exe)| win(h, exe, None)).collect::<Vec<_>>();
        let first = keep_order(&[], merge(&pins, &z(&[(1, "C:\\a.exe"), (2, "C:\\b.exe"), (3, "C:\\a.exe"), (9, "C:\\p.exe")]), |_| None));
        // b comes to the front, then a's second window: Z-order changes, the strip does not
        let next = keep_order(&first, merge(&pins, &z(&[(3, "C:\\a.exe"), (2, "C:\\b.exe"), (9, "C:\\p.exe"), (1, "C:\\a.exe")]), |_| None));
        let shape = |items: &[AppItem]| {
            items.iter().map(|i| (i.app_id.clone(), i.windows.iter().map(|w| w.hwnd).collect::<Vec<_>>())).collect::<Vec<_>>()
        };
        assert_eq!(shape(&next), shape(&first));
        assert_eq!(shape(&first)[1], ("exe:c:\\a.exe".to_string(), vec![1, 3]), "windows first-seen too: cycling goes round");
        // a new app and a new window go last; a closed app leaves no gap
        let z3 = z(&[(4, "C:\\c.exe"), (5, "C:\\a.exe"), (1, "C:\\a.exe"), (9, "C:\\p.exe"), (3, "C:\\a.exe")]);
        let later = keep_order(&next, merge(&pins, &z3, |_| None));
        assert_eq!(
            shape(&later),
            [
                ("exe:c:\\p.exe".to_string(), vec![9]),
                ("exe:c:\\a.exe".to_string(), vec![1, 3, 5]),
                ("exe:c:\\c.exe".to_string(), vec![4]),
            ]
        );
    }

    #[test]
    fn a_profile_window_relaunches_with_its_own_command() {
        assert_eq!(
            split_command(r#""C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 1""#),
            Some((r"C:\Program Files\Google\Chrome\Application\chrome.exe".into(), r#"--profile-directory="Profile 1""#.into()))
        );
        assert_eq!(split_command(r"C:\Program Files\X\x.EXE -a b"), Some((r"C:\Program Files\X\x.EXE".into(), "-a b".into())));
        assert_eq!(split_command("notepad"), Some(("notepad".into(), String::new())));
        assert_eq!(split_command("  "), None);
        let items = merge(&[], &[win(9, "C:\\chrome.exe", Some("Chrome.UserData.P1"))], |_| None);
        let ctl = FakeAppControl::default();
        let cmd = r#""C:\chrome.exe" --profile-directory="Profile 1""#;
        assert_eq!(launch(&ctl, &items, "aumid:Chrome.UserData.P1", Some(cmd)), Ok(()));
        assert_eq!(launch(&ctl, &items, "aumid:Chrome.UserData.P1", None), Ok(()));
        assert_eq!(
            *ctl.log.borrow(),
            [r#"run C:\chrome.exe --profile-directory="Profile 1""#, r"launch shell:AppsFolder\Chrome.UserData.P1"]
        );
    }
}
