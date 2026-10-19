//! Notch's own settings file (`<data>/settings.json`): the taskbar mode and the rest of Notch's choices.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use std::collections::BTreeMap;

use crate::apps::Pin;
use crate::shortcuts::{self, Shortcut, ShortcutId};

/// How the Windows taskbar is put away. Full hide is the default (owner decision 2); auto-hide is the safety net.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HideMode {
    /// Auto-hide AND `SW_HIDE` on every taskbar ("tamamen").
    #[default]
    Full,
    /// Windows's own auto-hide only ("otomatik").
    Auto,
    /// The Windows taskbar is left alone ("Leave the Windows taskbar alone"): a permanent mode, not a fallback. The
    /// strips and their AppBars stay; only the Windows bar is never hidden.
    Off,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    /// File format version; a file without one is 0 and `load` migrates it (see `VERSION`).
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub taskbar_hide: HideMode,
    #[serde(default)]
    pub pins: Vec<Pin>,
    #[serde(default = "shortcuts::defaults")]
    pub shortcuts: Vec<Shortcut>,
    /// Strips on the other monitors too (Start, Search, windows, clock).
    #[serde(default = "yes")]
    pub secondary_strips: bool,
    /// Notch's own "do not disturb" (its notices and protrusions keep quiet; Windows Focus is not touched).
    #[serde(default)]
    pub dnd: bool,
    /// The volume keys are swallowed and only Notch's indicator shows (owner decision 11). Off if Wave 0 test 10
    /// shows the hook misbehaving.
    #[serde(default = "yes")]
    pub capture_volume_keys: bool,
    /// The simple alert HTTP adapter; off until the owner turns it on.
    #[serde(default)]
    pub alerts_api: bool,
    /// Start with Windows (the per-user Run key; owner decision 2026-10-16). An old file gets it on.
    #[serde(default = "yes")]
    pub autostart: bool,
    /// Settings › Clipboard (Wave 4): the history on, images and files too, the password lifetime (minutes).
    #[serde(default = "yes")]
    pub clip_history: bool,
    #[serde(default = "yes")]
    pub clip_media: bool,
    #[serde(default = "sixty")]
    pub clip_password_min: u32,
    /// Wave 5: the mascot's idle pranks (decision 8, on by default) and colour app icons (on by default, owner 2026-10-19: one-colour cut-outs turn colourful logos into white squares).
    #[serde(default = "yes")]
    pub mascot_pranks: bool,
    #[serde(default = "yes")]
    pub color_icons: bool,
    /// Wave 6: the Windows notification mirror (decision 3), off until the owner turns it on with `mirror_enable`
    /// (Developer Mode + the registered package + Windows's yes). Only this switch is saved, never a notification.
    #[serde(default)]
    pub mirror: bool,
    /// Fidelity 3: the mascot celebrates a finished job (`job_done`; the page allows at most 3 an hour). On by default.
    #[serde(default = "yes")]
    pub celebrate: bool,
    /// Peeka Phase C (scenario 29): the Downloads folder is listed for "Download finished" (names and sizes only, see
    /// `downloads`). On by default because it reads no content; the owner can switch it off.
    #[serde(default = "yes")]
    pub watch_downloads: bool,
}

/// 1: colour icons became the default; a version-0 `"color_icons": false` was the old default, not a choice.
pub const VERSION: u32 = 1;

fn sixty() -> u32 {
    60
}

impl Settings {
    pub fn clip_config(&self) -> crate::clip::Config {
        crate::clip::Config {
            history: self.clip_history,
            media: self.clip_media,
            password_minutes: self.clip_password_min,
        }
    }
}

fn yes() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            taskbar_hide: HideMode::Full,
            pins: vec![],
            shortcuts: shortcuts::defaults(),
            secondary_strips: true,
            dnd: false,
            capture_volume_keys: true,
            alerts_api: false,
            autostart: true,
            clip_history: true,
            clip_media: true,
            clip_password_min: 60,
            mascot_pranks: true,
            color_icons: true,
            mirror: false,
            celebrate: true,
            watch_downloads: true,
        }
    }
}

/// The page's view of the settings (`ui/src/bridge.ts` `Settings`). Shortcut exceptions are the Search (Ctrl+K)
/// list: one row per exe name; `appId` is `exe:<file name>`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    /// `notch --demo`: nothing is saved (the page shows a "Demo" badge). Never in the file.
    pub demo: bool,
    pub secondary_strips: bool,
    pub shortcuts: BTreeMap<ShortcutId, String>,
    pub shortcut_exceptions: Vec<UiException>,
    pub capture_volume_keys: bool,
    pub alerts_api: bool,
    pub autostart: bool,
    pub clip_history: bool,
    pub clip_media: bool,
    pub clip_password_min: u32,
    pub mascot_pranks: bool,
    pub color_icons: bool,
    pub celebrate: bool,
    pub watch_downloads: bool,
    /// Read-only here; the page changes it with `taskbar_set_mode` ("full" | "auto" | "off").
    pub taskbar_hide: HideMode,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiException {
    pub app_id: String,
    pub name: String,
    pub icon: String,
    pub keys: String,
}

/// `set_settings`' `patch`. Extra fields the page sends along (an exception's name, icon) are ignored.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPatch {
    pub secondary_strips: Option<bool>,
    pub shortcuts: Option<BTreeMap<ShortcutId, String>>,
    pub shortcut_exceptions: Option<Vec<UiExceptionIn>>,
    pub capture_volume_keys: Option<bool>,
    pub alerts_api: Option<bool>,
    pub autostart: Option<bool>,
    pub clip_history: Option<bool>,
    pub clip_media: Option<bool>,
    pub clip_password_min: Option<u32>,
    pub mascot_pranks: Option<bool>,
    pub color_icons: Option<bool>,
    pub celebrate: Option<bool>,
    pub watch_downloads: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiExceptionIn {
    pub app_id: String,
}

/// shortcut: at most 64 exceptions; no real list comes near it.
const MAX_EXCEPTIONS: usize = 64;

/// `name_icon(exe)` gives a display name and icon for an exe file name (from the Start list), else the stem.
pub fn to_ui(s: &Settings, name_icon: impl Fn(&str) -> Option<(String, String)>) -> UiSettings {
    let shortcuts = s.shortcuts.iter().map(|k| (k.id, shortcuts::pretty(&k.keys))).collect();
    let search = s.shortcuts.iter().find(|k| k.id == ShortcutId::Search);
    let keys = search.map(|k| shortcuts::pretty(&k.keys)).unwrap_or_default();
    let shortcut_exceptions = search
        .map(|k| k.exceptions.as_slice())
        .unwrap_or_default()
        .iter()
        .map(|exe| {
            let low = exe.to_lowercase();
            let (name, icon) = name_icon(&low).unwrap_or_else(|| {
                (exe.strip_suffix(".exe").or(exe.strip_suffix(".EXE")).unwrap_or(exe).to_string(), String::new())
            });
            UiException { app_id: format!("exe:{low}"), name, icon, keys: keys.clone() }
        })
        .collect();
    UiSettings {
        demo: false,
        secondary_strips: s.secondary_strips,
        shortcuts,
        shortcut_exceptions,
        capture_volume_keys: s.capture_volume_keys,
        alerts_api: s.alerts_api,
        autostart: s.autostart,
        clip_history: s.clip_history,
        clip_media: s.clip_media,
        clip_password_min: s.clip_password_min,
        mascot_pranks: s.mascot_pranks,
        color_icons: s.color_icons,
        celebrate: s.celebrate,
        watch_downloads: s.watch_downloads,
        taskbar_hide: s.taskbar_hide,
    }
}

/// Applies a patch, or says why not (the page shows it). `check_keys` = why a key combination cannot be a
/// shortcut (the parser refuses it, or it types an AltGr character: `shortcuts::altgr_reason`), None = fine;
/// `exe_of(app_id)` = the exe file name of an app the page got from Notch (None = not Notch's, or not an exe).
pub fn apply_patch(
    s: &Settings,
    patch: UiPatch,
    check_keys: impl Fn(&str) -> Option<String>,
    exe_of: impl Fn(&str) -> Option<String>,
) -> Result<Settings, String> {
    let mut next = s.clone();
    if let Some(v) = patch.secondary_strips {
        next.secondary_strips = v;
    }
    if let Some(v) = patch.capture_volume_keys {
        next.capture_volume_keys = v;
    }
    if let Some(v) = patch.alerts_api {
        next.alerts_api = v;
    }
    if let Some(v) = patch.autostart {
        next.autostart = v;
    }
    if let Some(v) = patch.clip_history {
        next.clip_history = v;
    }
    if let Some(v) = patch.mascot_pranks {
        next.mascot_pranks = v;
    }
    if let Some(v) = patch.color_icons {
        next.color_icons = v;
    }
    if let Some(v) = patch.celebrate {
        next.celebrate = v;
    }
    if let Some(v) = patch.watch_downloads {
        next.watch_downloads = v;
    }
    if let Some(v) = patch.clip_media {
        next.clip_media = v;
    }
    if let Some(v) = patch.clip_password_min {
        // Shorter only, never past an hour.
        if !crate::clip::PASSWORD_MINUTES.contains(&v) {
            return Err("Password lifetime can be 5, 15, 30 or 60 minutes.".into());
        }
        next.clip_password_min = v;
    }
    if let Some(map) = patch.shortcuts {
        for (id, keys) in map {
            if let Some(why) = check_keys(&keys) {
                return Err(why);
            }
            if let Some(k) = next.shortcuts.iter_mut().find(|k| k.id == id) {
                k.keys = keys;
            }
        }
        let mut seen = std::collections::BTreeSet::new();
        if !next.shortcuts.iter().all(|k| seen.insert(shortcuts::normalize(&k.keys))) {
            return Err("This shortcut is assigned to another function.".into());
        }
    }
    if let Some(list) = patch.shortcut_exceptions {
        if list.len() > MAX_EXCEPTIONS {
            return Err("The exception list is too long.".into());
        }
        let mut exes: Vec<String> = Vec::with_capacity(list.len());
        for e in &list {
            let exe = e
                .app_id
                .strip_prefix("exe:")
                .map(crate::apps::exe_name)
                .or_else(|| exe_of(&e.app_id))
                .filter(|x| shortcuts::valid_exe(x))
                .ok_or("Cannot add an exception for this app (its executable was not found).")?;
            if !exes.contains(&exe) {
                exes.push(exe);
            }
        }
        if let Some(k) = next.shortcuts.iter_mut().find(|k| k.id == ShortcutId::Search) {
            k.exceptions = exes;
        }
    }
    Ok(next)
}

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

/// Missing = defaults. Unreadable = defaults too, and the bad file is kept beside it (`settings.json.bad`) so the
/// next save cannot destroy what the owner may still want back.
/// An older file is migrated once and written back.
pub fn load(path: &Path) -> Settings {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
            Ok(mut s) if s.version < VERSION => {
                s.color_icons = true;
                s.version = VERSION;
                let _ = save(path, &s);
                s
            }
            Ok(s) => s,
            Err(_) => {
                let _ = std::fs::rename(path, path.with_extension("json.bad"));
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

/// Write to a temp file, then rename over: a crash mid-write never leaves half a file.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    #[test]
    fn missing_is_default_and_a_round_trip_keeps_everything() {
        let tmp = Tmp::new();
        let path = settings_path(tmp.path());
        let mut s = load(&path);
        assert_eq!(s, Settings::default());
        assert_eq!(s.taskbar_hide, HideMode::Full);
        assert!(s.autostart && s.secondary_strips && !s.dnd);
        s.taskbar_hide = HideMode::Auto;
        s.pins.push(Pin { app_id: "exe:c:\\a.exe".into(), name: "A".into() });
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
    }

    #[test]
    fn the_ui_view_and_patches() {
        let s = Settings::default();
        let ui = to_ui(&s, |exe| (exe == "winword.exe").then(|| ("Word".into(), "data:x".into())));
        assert_eq!(ui.shortcuts[&ShortcutId::Search], "Ctrl+K");
        assert_eq!(ui.shortcuts[&ShortcutId::FocusIsland], "Ctrl+Shift+Enter");
        assert_eq!(ui.shortcut_exceptions.len(), 14);
        assert_eq!(
            (ui.shortcut_exceptions[0].app_id.as_str(), ui.shortcut_exceptions[0].name.as_str()),
            ("exe:winword.exe", "Word")
        );
        assert_eq!(ui.shortcut_exceptions[1].name, "OUTLOOK", "no Start entry: the stem");
        let json = serde_json::to_value(&ui).unwrap();
        assert!(json["shortcuts"]["hide_island"].is_string() && json["secondaryStrips"].is_boolean());
        assert_eq!((json["captureVolumeKeys"].as_bool(), json["alertsApi"].as_bool()), (Some(true), Some(false)));
        assert_eq!((json["autostart"].as_bool(), json["taskbarHide"].as_str()), (Some(true), Some("full")));
        assert_eq!((json["mascotPranks"].as_bool(), json["colorIcons"].as_bool()), (Some(true), Some(true)));
        assert_eq!((json["celebrate"].as_bool(), json["watchDownloads"].as_bool()), (Some(true), Some(true)));
        let p: UiPatch =
            serde_json::from_str(r#"{"colorIcons":false,"mascotPranks":false,"celebrate":false,"watchDownloads":false}"#)
                .unwrap();
        let n = apply_patch(&s, p, |_: &str| None, |_: &str| None).unwrap();
        assert!(!n.color_icons && !n.mascot_pranks && !n.celebrate && !n.watch_downloads);

        let ok = |_: &str| None;
        let none = |_: &str| None;
        let p: UiPatch = serde_json::from_str(r#"{"shortcuts":{"search":"Ctrl+Shift+A"}}"#).unwrap();
        assert_eq!(apply_patch(&s, p, ok, none).unwrap_err(), "This shortcut is assigned to another function.");
        let p: UiPatch = serde_json::from_str(r#"{"shortcuts":{"ask":"Ctrl+J"},"secondaryStrips":false}"#).unwrap();
        let n = apply_patch(&s, p, ok, none).unwrap();
        assert_eq!((n.shortcuts[1].keys.as_str(), n.secondary_strips), ("Ctrl+J", false));
        let p: UiPatch = serde_json::from_str(r#"{"captureVolumeKeys":false,"alertsApi":true}"#).unwrap();
        let n = apply_patch(&s, p, ok, none).unwrap();
        assert_eq!((n.capture_volume_keys, n.alerts_api), (false, true));
        let p: UiPatch = serde_json::from_str(r#"{"autostart":false,"taskbarHide":"off"}"#).unwrap();
        let n = apply_patch(&s, p, ok, none).unwrap();
        assert_eq!((n.autostart, n.taskbar_hide), (false, HideMode::Full), "the mode is not patched here");
        let p: UiPatch = serde_json::from_str(r#"{"shortcuts":{"ask":"nope"}}"#).unwrap();
        let why = |k: &str| (k == "nope").then(|| "not allowed".to_string());
        assert_eq!(apply_patch(&s, p, why, none).unwrap_err(), "not allowed");
        let p: UiPatch = serde_json::from_str(r#"{"shortcuts":{"ask":"Ctrl+Alt+Q"}}"#).unwrap();
        let altgr = |k: &str| shortcuts::altgr_reason(k, |vk, _| (vk == u16::from(b'Q')).then(|| "@".to_string()));
        assert!(apply_patch(&s, p, altgr, none).unwrap_err().contains("\"@\""), "Turkish Q: AltGr+Q is @");
        assert_eq!(json["clipPasswordMin"].as_u64(), Some(60), "one hour by default");
        let p: UiPatch = serde_json::from_str(r#"{"clipPasswordMin":15,"clipMedia":false}"#).unwrap();
        let n = apply_patch(&s, p, ok, none).unwrap();
        assert_eq!((n.clip_password_min, n.clip_media, n.clip_history), (15, false, true));
        let p: UiPatch = serde_json::from_str(r#"{"clipPasswordMin":120}"#).unwrap();
        assert!(apply_patch(&s, p, ok, none).is_err(), "never longer than an hour");

        let p: UiPatch = serde_json::from_str(
            r#"{"shortcutExceptions":[{"appId":"exe:winword.exe","name":"Word"},{"appId":"lnk:c:\\w.lnk"}]}"#,
        )
        .unwrap();
        let n = apply_patch(&s, p, ok, |id| (id == "lnk:c:\\w.lnk").then(|| "code.exe".into())).unwrap();
        assert_eq!(n.shortcuts[0].exceptions, ["winword.exe", "code.exe"]);
        let p: UiPatch = serde_json::from_str(r#"{"shortcutExceptions":[{"appId":"aumid:X!App"}]}"#).unwrap();
        assert!(apply_patch(&s, p, ok, none).is_err(), "an app Notch cannot name an exe for");
    }

    #[test]
    fn an_old_file_gets_the_new_defaults_and_a_corrupt_one_is_kept_aside() {
        let tmp = Tmp::new();
        let path = tmp.write("settings.json", br#"{"taskbar_hide":"off"}"#);
        let s = load(&path);
        assert_eq!((s.taskbar_hide, s.shortcuts.len()), (HideMode::Off, 5));
        assert!(s.capture_volume_keys && !s.alerts_api, "an old file gets keys on, the HTTP adapter off");
        assert!(s.autostart, "an old file starts with Windows too");
        assert!(s.watch_downloads, "an old file gets the download watch on (names only)");
        assert!(s.color_icons && s.version == VERSION, "an old file gets colour icons");
        tmp.write("settings.json", b"{nope");
        assert_eq!(load(&path), Settings::default());
        assert!(path.with_extension("json.bad").exists());
    }

    #[test]
    fn colour_icons_migrate_once_and_a_later_choice_sticks() {
        let tmp = Tmp::new();
        let path = tmp.write("settings.json", br#"{"color_icons":false,"dnd":true}"#);
        let s = load(&path);
        assert!(s.color_icons && s.dnd, "the old default false is not a choice");
        let on_disk: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!((on_disk["version"].as_u64(), on_disk["color_icons"].as_bool()), (Some(1), Some(true)), "written back once");
        let p: UiPatch = serde_json::from_str(r#"{"colorIcons":false}"#).unwrap();
        save(&path, &apply_patch(&s, p, |_: &str| None, |_: &str| None).unwrap()).unwrap();
        assert!(!load(&path).color_icons, "the user's later off is kept");
        tmp.write("settings.json", br#"{"version":1,"color_icons":false}"#);
        assert!(!load(&path).color_icons, "a versioned false is a choice");
    }
}
