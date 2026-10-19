//! The read-only tray list (way 2b): **PENDING Wave 0 test 4** (`probe tray`). It is the
//! fallback for when the real hidden-icons panel cannot be opened under the strip and the tray mirror (2a) did not
//! hold; if the test shows either works, this list goes. Source: `HKCU\Control Panel\NotifyIconSettings` (Windows 11
//! 22H2+), one subkey per icon Windows has seen, with `ExecutablePath`, `InitialTooltip`, `IsPromoted`. The key keeps
//! every app that ever showed an icon, so only apps running now are listed. No live state: there is no badge, and a click cannot reach the
//! app's own tray menu, so clicking brings the app's window forward or starts it.

use serde::Serialize;

use crate::apps::{AppItem, WindowRef};

/// One subkey as the registry gave it.
#[derive(Clone, Debug, Default)]
pub struct RawIcon {
    pub key: String,
    pub exe: Option<String>,
    pub tooltip: Option<String>,
    pub promoted: Option<u32>,
}

/// `open_tray`'s list item.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayIcon {
    /// `exe:<lowercased path>`, the same id the strip uses for that app (`apps::app_id`).
    pub id: String,
    pub name: String,
    pub exe: String,
    /// "Always show" in Windows Settings (the frequent icons, y2).
    pub promoted: bool,
    /// The exe's icon as a PNG data URL (alpha drawn as a single colour, decision 14); "" = none.
    pub icon: String,
}

/// The known-folder GUIDs `ExecutablePath` starts with, and the environment variable each one is.
const KNOWN: &[(&str, &str)] = &[
    ("{6D809377-6AF0-444B-8957-A3773F02200E}", "ProgramW6432"),
    ("{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}", "ProgramFiles(x86)"),
    ("{F38BF404-1D43-42F2-9305-67DE0B28FC23}", "SystemRoot"),
    ("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}", "SystemRoot|System32"),
];

/// `{GUID}\rest` -> the folder + rest; a plain absolute path stays. None = unknown GUID or not a path.
fn resolve(raw: &str, env: &impl Fn(&str) -> Option<String>) -> Option<String> {
    let raw = raw.trim();
    if raw.chars().any(char::is_control) {
        return None;
    }
    let path = if raw.starts_with('{') {
        let end = raw.find('}')?;
        let (guid, rest) = raw.split_at(end + 1);
        let var = KNOWN.iter().find(|(g, _)| g.eq_ignore_ascii_case(guid))?.1;
        let base = match var.split_once('|') {
            Some((v, sub)) => format!("{}\\{sub}", env(v)?),
            None => env(var)?,
        };
        format!("{}{rest}", base.trim_end_matches('\\'))
    } else {
        raw.to_string()
    };
    let abs = path.get(1..3) == Some(":\\") || path.starts_with("\\\\");
    (abs && path.to_lowercase().ends_with(".exe")).then_some(path)
}

/// The list: resolved, Explorer's own icons (volume, network, battery) dropped, one cell per app (promoted wins),
/// promoted first, then by name. `running` keeps only exes that have a process now: Some(true) = that exact path,
/// Some(false) = only a process of that file name (its path unreadable, e.g. a service).
/// One cell per app: the same exe, the same name (NVIDIA's two containers are both "NVIDIA Settings"), or the same
/// file name matched by name only (every old driver folder's `NVDisplay.Container.exe` would pass that test).
pub fn parse(
    raw: Vec<RawIcon>,
    env: impl Fn(&str) -> Option<String>,
    running: impl Fn(&str) -> Option<bool>,
) -> Vec<TrayIcon> {
    let mut out: Vec<(TrayIcon, Option<String>, bool)> = vec![];
    for r in raw {
        let Some(exe) = r.exe.as_deref().and_then(|e| resolve(e, &env)) else { continue };
        let file = crate::apps::exe_name(&exe);
        let Some(exact) = running(&exe).filter(|_| file != "explorer.exe") else { continue };
        let by_name = (!exact).then_some(file);
        let id = format!("exe:{}", exe.to_lowercase());
        let promoted = r.promoted.is_some_and(|p| p != 0);
        let tip = r
            .tooltip
            .and_then(|t| crate::alerts::text(&serde_json::Value::String(t.lines().next().unwrap_or("").into()), 64));
        let same = |(t, f, _): &&mut (TrayIcon, Option<String>, bool)| t.id == id || (by_name.is_some() && *f == by_name);
        if let Some((seen, _, named)) = out.iter_mut().find(same) {
            seen.promoted |= promoted;
            if let Some(tip) = tip.filter(|_| !*named) {
                (seen.name, *named) = (tip, true);
            }
            continue;
        }
        let named = tip.is_some();
        let name = tip.unwrap_or_else(|| crate::apps::fallback_name(&id));
        out.push((TrayIcon { id, name, exe, promoted, icon: String::new() }, by_name, named));
    }
    let mut out: Vec<TrayIcon> = out.into_iter().map(|(t, ..)| t).fold(vec![], |mut acc: Vec<TrayIcon>, t| {
        match acc.iter_mut().find(|s| s.name.eq_ignore_ascii_case(&t.name)) {
            Some(s) => s.promoted |= t.promoted,
            None => acc.push(t),
        }
        acc
    });
    out.sort_by(|a, b| b.promoted.cmp(&a.promoted).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

/// Is `exe` running? `procs` = every process as (exe file name, full path or "" when it cannot be opened, e.g. an
/// elevated one); a known path must match exactly (Some(true)), an unknown one falls back to the file name
/// (Some(false)).
pub fn running(exe: &str, procs: &[(String, String)]) -> Option<bool> {
    let name = crate::apps::exe_name(exe);
    if procs.iter().any(|(_, p)| p.eq_ignore_ascii_case(exe)) {
        return Some(true);
    }
    procs.iter().any(|(n, p)| p.is_empty() && n.eq_ignore_ascii_case(&name)).then_some(false)
}

/// What a click on a listed icon does.
#[derive(Debug, PartialEq, Eq)]
pub enum Open {
    Focus(isize),
    Launch(String),
}

/// A listed id only: the app's first open window if the strip has one, else its exe.
pub fn open(listed: &[TrayIcon], items: &[AppItem], id: &str) -> Option<Open> {
    let icon = listed.iter().find(|t| t.id == id)?;
    let window = items.iter().find(|i| i.app_id == id).and_then(|i| i.windows.first()).map(|w: &WindowRef| w.hwnd);
    Some(window.map_or_else(|| Open::Launch(icon.exe.clone()), Open::Focus))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(v: &str) -> Option<String> {
        match v {
            "ProgramW6432" => Some(r"C:\Program Files".into()),
            "SystemRoot" => Some(r"C:\Windows".into()),
            _ => None,
        }
    }

    fn raw(key: &str, exe: &str, tip: Option<&str>, promoted: Option<u32>) -> RawIcon {
        RawIcon { key: key.into(), exe: Some(exe.into()), tooltip: tip.map(Into::into), promoted }
    }

    /// Shapes copied from this machine's `NotifyIconSettings` (2026-10-16), names shortened.
    #[test]
    fn parses_notify_icon_settings() {
        let list = parse(
            vec![
                raw(
                    "1",
                    r"{6D809377-6AF0-444B-8957-A3773F02200E}\NVIDIA Corporation\NvContainer\nvcontainer.exe",
                    None,
                    None,
                ),
                raw("2", r"{F38BF404-1D43-42F2-9305-67DE0B28FC23}\explorer.exe", None, Some(1)),
                raw(
                    "3",
                    r"{6D809377-6AF0-444B-8957-A3773F02200E}\WindowsApps\Buds\QuickControls.exe",
                    Some("Galaxy Buds2 (0D48)\nsecond line"),
                    None,
                ),
                raw("4", r"C:\Users\x\AppData\Local\Voicemod\Voicemod.exe", Some("  "), Some(1)),
                raw("5", r"C:\Users\x\AppData\Local\Voicemod\VOICEMOD.EXE", None, None),
                raw("6", r"{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\Old\old.exe", None, None),
                raw("7", r"{00000000-0000-0000-0000-000000000000}\x.exe", None, None),
                raw("8", r"relative\x.exe", None, None),
                raw("9", r"C:\gone\gone.exe", None, None),
                raw("10", "C:\\x\\bad\u{7}.exe", None, None),
                raw("11", r"C:\x\notes.txt", None, None),
                RawIcon { key: "12".into(), ..RawIcon::default() },
            ],
            env,
            |p| (!p.contains("gone")).then_some(true),
        );
        let names: Vec<(&str, bool)> = list.iter().map(|t| (t.name.as_str(), t.promoted)).collect();
        assert_eq!(names, [("voicemod", true), ("Galaxy Buds2 (0D48)", false), ("nvcontainer", false)]);
        assert_eq!(list[2].exe, r"C:\Program Files\NVIDIA Corporation\NvContainer\nvcontainer.exe");
        assert_eq!(list[0].id, r"exe:c:\users\x\appdata\local\voicemod\voicemod.exe");
    }

    #[test]
    fn only_running_exes_are_listed() {
        let procs = vec![
            ("Discord.exe".to_string(), r"C:\Users\x\Discord\Discord.exe".to_string()),
            ("AvAgent.exe".to_string(), String::new()),
        ];
        assert_eq!(running(r"c:\users\x\discord\discord.exe", &procs), Some(true));
        assert_eq!(running(r"C:\old\Discord.exe", &procs), None, "same name, another path: another app");
        assert_eq!(running(r"C:\Program Files\Av\avagent.exe", &procs), Some(false), "path unreadable: by name");
        assert_eq!(running(r"C:\x\steam.exe", &procs), None);
        let list = parse(
            vec![raw("1", r"C:\Users\x\Discord\Discord.exe", None, None), raw("2", r"C:\x\steam.exe", None, None)],
            env,
            |p| running(p, &procs),
        );
        assert_eq!(list.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["discord"]);
    }

    /// This PC's `NotifyIconSettings` (2026-10-19): NVIDIA's service container (path unreadable) under several old
    /// driver folders, plus nvcontainer.exe with the same tooltip. The panel showed two NVIDIA cells.
    #[test]
    fn one_cell_per_app() {
        let store = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\DriverStore\FileRepository";
        let nv = r"C:\Program Files\NVIDIA Corporation\NvContainer\nvcontainer.exe";
        let procs = vec![
            ("NVDisplay.Container.exe".to_string(), String::new()),
            ("nvcontainer.exe".to_string(), nv.to_string()),
            ("ChatGPT.exe".to_string(), r"C:\a\ChatGPT.exe".to_string()),
            ("ChatGPT.exe".to_string(), r"C:\b\ChatGPT.exe".to_string()),
        ];
        let container = |dir: &str| format!(r"{store}\nvami.inf_amd64_{dir}\Display.NvContainer\NVDisplay.Container.exe");
        let list = parse(
            vec![
                raw("1", &container("aaa"), None, None),
                raw("2", &container("bbb"), None, Some(1)),
                raw("3", r"{6D809377-6AF0-444B-8957-A3773F02200E}\NVIDIA Corporation\NvContainer\nvcontainer.exe", Some("NVIDIA Settings"), None),
                raw("4", &container("ccc"), Some("NVIDIA Settings"), None),
                raw("5", r"C:\a\ChatGPT.exe", None, None),
                raw("6", r"C:\b\ChatGPT.exe", Some("Codex"), None),
            ],
            |v| env(v).or_else(|| (v == "SystemRoot").then(|| r"C:\Windows".into())),
            |p| running(p, &procs),
        );
        let names: Vec<(&str, bool)> = list.iter().map(|t| (t.name.as_str(), t.promoted)).collect();
        assert_eq!(
            names,
            [("NVIDIA Settings", true), ("chatgpt", false), ("Codex", false)],
            "two real apps of one file name stay"
        );
    }

    #[test]
    fn a_click_focuses_the_open_window_or_starts_the_exe_and_only_for_listed_ids() {
        let listed = vec![TrayIcon {
            id: r"exe:c:\a\a.exe".into(),
            name: "a".into(),
            exe: r"C:\a\a.exe".into(),
            promoted: false,
            icon: String::new(),
        }];
        assert_eq!(open(&listed, &[], r"exe:c:\a\a.exe"), Some(Open::Launch(r"C:\a\a.exe".into())));
        let items = vec![AppItem {
            app_id: r"exe:c:\a\a.exe".into(),
            name: "a".into(),
            pinned: false,
            exe: "a.exe".into(),
            windows: vec![WindowRef { hwnd: 42, title: "A".into(), minimized: true, monitor: None, elevated: false }],
        }];
        assert_eq!(open(&listed, &items, r"exe:c:\a\a.exe"), Some(Open::Focus(42)));
        assert_eq!(open(&listed, &items, r"exe:c:\b\b.exe"), None);
    }
}
