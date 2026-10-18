//! Pinned apps plus open windows, one item per app (owner decision 20).
//!
//! An app's identity is its AppUserModelID when the window has one (Store apps, Chrome profiles and PWAs get their
//! own), else its exe path. `app_id` carries which: `aumid:<id>` or `exe:<lowercased path>`. Pins store the same id.
//! Window filter = what the Windows taskbar shows:
//! visible or minimised, titled, not a tool / no-activate window, not cloaked, not owned (unless `WS_EX_APPWINDOW`),
//! not the shell's own furniture.

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
    (w.visible || w.minimized)
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

/// The exe's file name, lowercased (`C:\x\Code.exe` -> `code.exe`): what shortcut exceptions compare.
pub fn exe_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
}

/// A readable name when nothing better is known: the exe's stem (`code.exe` -> `code`) or the AUMID's last part.
/// shortcut: no FileDescription / Store display name yet; Wave 2 reads them with the icons.
pub(crate) fn fallback_name(app_id: &str) -> String {
    let raw = app_id.split_once(':').map_or(app_id, |(_, rest)| rest);
    let tail = raw.rsplit(['\\', '/', '!']).next().unwrap_or(raw);
    tail.strip_suffix(".exe").unwrap_or(tail).to_string()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub app_id: String,
    pub name: String,
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
/// first-seen order. `windows` is the enumerator's raw list; the filter runs here.
pub fn merge(pins: &[Pin], windows: &[RawWindow]) -> Vec<AppItem> {
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
        let at = match items.iter().position(|i| i.app_id == id) {
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
pub fn launch_any(ctl: &dyn AppControl, items: &[AppItem], apps: &[ListedApp], app_id: &str) -> Result<(), AppError> {
    if items.iter().any(|i| i.app_id == app_id) {
        return launch(ctl, items, app_id);
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

/// Start an app from the list (a new window too). The target comes from the id, never from the page.
pub fn launch(ctl: &dyn AppControl, items: &[AppItem], app_id: &str) -> Result<(), AppError> {
    let target = launch_target(&item(items, app_id)?.app_id).ok_or(AppError::Unknown)?;
    ctl.launch(&target).then_some(()).ok_or(AppError::Refused)
}

/// The item's click: its front window comes forward; an app with no window starts.
pub fn activate(ctl: &dyn AppControl, items: &[AppItem], app_id: &str) -> Result<(), AppError> {
    match item(items, app_id)?.windows.first() {
        Some(w) => ctl.focus(w.hwnd).then_some(()).ok_or(AppError::Refused),
        None => launch(ctl, items, app_id),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake::FakeAppControl;

    #[test]
    fn actions_only_reach_what_notch_listed() {
        let items = merge(&[Pin { app_id: "aumid:A!App".into(), name: "A".into() }], &[win(9, "C:\\b.exe", None)]);
        let ctl = FakeAppControl::default();
        assert_eq!(activate(&ctl, &items, "aumid:A!App"), Ok(()));
        assert_eq!(activate(&ctl, &items, "exe:c:\\b.exe"), Ok(()));
        assert_eq!(launch(&ctl, &items, "exe:c:\\windows\\system32\\cmd.exe"), Err(AppError::Unknown));
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
        let items = merge(&[], &[admin, win(8, "C:\\b.exe", None)]);
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
        let items = merge(&[], &[win(9, "C:\\b.exe", None)]);
        let ctl = FakeAppControl::default();
        assert_eq!(launch_any(&ctl, &items, &apps, "lnk:c:\\p\\Word.lnk"), Ok(()));
        assert_eq!(launch_any(&ctl, &items, &apps, "lnk:c:\\evil.lnk"), Err(AppError::Unknown));
        assert_eq!(launch_any(&ctl, &items, &apps, "exe:c:\\b.exe"), Ok(()));
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
        assert!(is_app_window(&RawWindow { visible: false, minimized: true, ..ok.clone() }), "minimised counts");
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
        assert_eq!(exe_name("C:\\Users\\x\\AppData\\Discord.exe"), "discord.exe");
    }

    #[test]
    fn pinned_and_open_windows_merge_into_one_item_per_app() {
        let pins = vec![
            Pin { app_id: "exe:c:\\chrome.exe".into(), name: "Chrome".into() },
            Pin { app_id: "aumid:Spotify".into(), name: "Spotify".into() },
        ];
        let windows = vec![
            win(1, "C:\\Code.exe", None),
            win(2, "C:\\Chrome.exe", None),
            win(3, "C:\\Chrome.exe", None),
            win(4, "C:\\Chrome.exe", Some("Chrome.Profile2")), // its own identity, its own item
            RawWindow { cloaked: true, ..win(5, "C:\\Code.exe", None) },
        ];
        let items = merge(&pins, &windows);
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
}
