//! Global shortcuts (owner decision 4) and their per-app exceptions: while an app on a shortcut's list is
//! in front, Notch lets go of that shortcut (the app keeps its own Ctrl+K) and takes it back when the app leaves.
//! The emergency key is never let go. The Ctrl+K list comes prefilled; the owner edits it in Settings › Shortcuts.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::apps::exe_name;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutId {
    /// Ctrl+K: search.
    Search,
    /// Ctrl+Space: ask the main assistant.
    Ask,
    /// Ctrl+Shift+Enter: focus the island from the keyboard.
    FocusIsland,
    /// Ctrl+Shift+A: hide the island for a while (strip and AppBar stay).
    HideIsland,
    /// Ctrl+Alt+Shift+T (spare Ctrl+Alt+Shift+G): the taskbar comes back. Never excepted.
    Emergency,
}

pub const EMERGENCY_SPARE: &str = "ctrl+alt+shift+g";
/// "Save diagnostics" (`diagnostics`): fixed, not in Settings > Shortcuts.
pub const DIAGNOSTICS_KEYS: &str = "ctrl+alt+shift+d";

/// Ctrl+K is these apps' own (Word/Outlook link, browser address bar, Slack/Discord quick switch,
/// VS Code chords, Teams search).
pub const CTRL_K_EXCEPTIONS: [&str; 14] = [
    "WINWORD.EXE",
    "OUTLOOK.EXE",
    "olk.exe",
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "slack.exe",
    "Discord.exe",
    "Code.exe",
    "ms-teams.exe",
    "Teams.exe",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shortcut {
    pub id: ShortcutId,
    /// Tauri global-shortcut syntax ("ctrl+k").
    pub keys: String,
    /// Exe file names; compared case-insensitively.
    #[serde(default)]
    pub exceptions: Vec<String>,
}

pub fn defaults() -> Vec<Shortcut> {
    let s = |id, keys: &str, exceptions: &[&str]| Shortcut {
        id,
        keys: keys.into(),
        exceptions: exceptions.iter().map(|e| e.to_string()).collect(),
    };
    vec![
        s(ShortcutId::Search, "ctrl+k", &CTRL_K_EXCEPTIONS),
        // Empty: VS Code's autocomplete also uses it; the owner may add it.
        s(ShortcutId::Ask, "ctrl+space", &[]),
        s(ShortcutId::FocusIsland, "ctrl+shift+enter", &[]),
        s(ShortcutId::HideIsland, "ctrl+shift+a", &[]),
        s(ShortcutId::Emergency, "ctrl+alt+shift+t", &[]),
    ]
}

/// The page's spelling: "ctrl+shift+enter" -> "Ctrl+Shift+Enter" (the parser takes either).
pub fn pretty(keys: &str) -> String {
    keys.split('+')
        .map(|t| {
            let t = t.trim();
            let mut c = t.chars();
            c.next().map(|f| f.to_uppercase().chain(c.flat_map(char::to_lowercase)).collect()).unwrap_or_default()
        })
        .collect::<Vec<String>>()
        .join("+")
}

/// For "is this combination taken" only.
pub fn normalize(keys: &str) -> String {
    keys.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

/// An exception entry: a bare exe file name, nothing that looks like a path.
pub fn valid_exe(name: &str) -> bool {
    (5..=64).contains(&name.len())
        && name.to_ascii_lowercase().ends_with(".exe")
        && name.chars().all(|c| c.is_alphanumeric() || " ._-()".contains(c))
}

// Peeka — original implementation (MIT).
/// Windows reads Ctrl+Alt as AltGr, and many European layouts (Turkish Q, German, French…) type characters with it,
/// so a global Ctrl+Alt+Q would eat every `@` typed on Turkish Q. For a Ctrl+Alt combination without the Windows key
/// whose key is a letter or digit, returns that key's virtual-key code and whether Shift is held; None when the
/// combination cannot collide with typing (other modifiers, or keys such as Space, arrows and F-keys).
pub fn altgr_vk(keys: &str) -> Option<(u16, bool)> {
    let keys = normalize(keys);
    let mut parts: Vec<&str> = keys.split('+').collect();
    let key = parts.pop().filter(|k| !k.is_empty())?;
    let has = |names: &[&str]| parts.iter().any(|p| names.contains(p));
    if !has(&["ctrl", "control"]) || !has(&["alt", "option"]) || has(&["super", "win", "meta", "cmd", "command"]) {
        return None;
    }
    let key = match key.strip_prefix("digit") {
        Some(rest) => rest,
        None => key.strip_prefix("key").filter(|rest| rest.len() == 1).unwrap_or(key),
    };
    match key.as_bytes() {
        [c] if c.is_ascii_alphanumeric() => Some((u16::from(c.to_ascii_uppercase()), has(&["shift"]))),
        _ => None,
    }
}

/// The English explanation of why `keys` would break typing on this machine, or None if it is safe. `types(vk,
/// shift)` reports what Ctrl+Alt(+Shift)+that key types on any installed layout
/// (`notch_win::keyboard::ctrl_alt_types`); it is only asked about Ctrl+Alt letter/digit combinations.
pub fn altgr_reason(keys: &str, types: impl Fn(u16, bool) -> Option<String>) -> Option<String> {
    let (vk, shift) = altgr_vk(keys)?;
    let typed = types(vk, shift)?;
    Some(format!(
        "{} acts like AltGr on one of the installed keyboards and types \"{typed}\"; as a shortcut that character \
         could not be typed. Pick another shortcut.",
        pretty(keys)
    ))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateAction {
    Register(ShortcutId),
    Unregister(ShortcutId),
}

/// Which shortcuts are let go for the app in front. Starts with everything held (the app registers all at launch).
#[derive(Debug, Default)]
pub struct ShortcutGate {
    released: BTreeSet<ShortcutId>,
}

impl ShortcutGate {
    /// The foreground app changed to `exe` (a path or file name; None = unknown, e.g. an elevated window).
    /// Returns what to unregister / register, in that order of meaning; nothing when nothing changes.
    pub fn on_foreground(&mut self, shortcuts: &[Shortcut], exe: Option<&str>) -> Vec<GateAction> {
        let name = exe.map(exe_name).unwrap_or_default();
        let want: BTreeSet<ShortcutId> = shortcuts
            .iter()
            .filter(|s| s.id != ShortcutId::Emergency && !name.is_empty())
            .filter(|s| s.exceptions.iter().any(|e| e.eq_ignore_ascii_case(&name)))
            .map(|s| s.id)
            .collect();
        let mut out: Vec<GateAction> = want.difference(&self.released).map(|&id| GateAction::Unregister(id)).collect();
        out.extend(self.released.difference(&want).map(|&id| GateAction::Register(id)));
        self.released = want;
        out
    }

    pub fn is_released(&self, id: ShortcutId) -> bool {
        self.released.contains(&id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use GateAction::*;

    #[test]
    fn ctrl_k_comes_prefilled_and_the_rest_empty() {
        let d = defaults();
        assert_eq!(d.len(), 5);
        assert_eq!(d[0].exceptions.len(), 14);
        assert!(d.iter().filter(|s| s.id != ShortcutId::Search).all(|s| s.exceptions.is_empty()));
    }

    #[test]
    fn an_excepted_app_in_front_releases_and_leaving_takes_it_back() {
        let list = defaults();
        let mut gate = ShortcutGate::default();
        assert_eq!(
            gate.on_foreground(&list, Some("C:\\Program Files\\Microsoft Office\\winword.exe")),
            [Unregister(ShortcutId::Search)]
        );
        assert!(gate.is_released(ShortcutId::Search));
        assert_eq!(gate.on_foreground(&list, Some("C:\\x\\Chrome.EXE")), [], "excepted to excepted: nothing to do");
        assert_eq!(gate.on_foreground(&list, Some("C:\\Windows\\explorer.exe")), [Register(ShortcutId::Search)]);
        assert_eq!(gate.on_foreground(&list, Some("C:\\Windows\\explorer.exe")), []);
        gate.on_foreground(&list, Some("discord.exe"));
        assert_eq!(gate.on_foreground(&list, None), [Register(ShortcutId::Search)], "unknown front app = held");
    }

    #[test]
    fn spelling_and_exe_names() {
        assert_eq!(pretty("ctrl+alt+shift+t"), "Ctrl+Alt+Shift+T");
        assert_eq!(pretty("Ctrl+Space"), "Ctrl+Space");
        assert_eq!(normalize("Ctrl + K"), normalize("ctrl+k"));
        assert!(valid_exe("WINWORD.EXE") && valid_exe("ms-teams.exe"));
        assert!(!valid_exe("c:\\x\\a.exe") && !valid_exe("a.lnk") && !valid_exe(".exe"));
    }

    #[test]
    fn the_emergency_key_is_never_released() {
        let list = vec![Shortcut {
            id: ShortcutId::Emergency,
            keys: "ctrl+alt+shift+t".into(),
            exceptions: vec!["game.exe".into()],
        }];
        let mut gate = ShortcutGate::default();
        assert_eq!(gate.on_foreground(&list, Some("game.exe")), []);
    }

    /// Fixed AltGr tables (vk, shift) -> character; real layouts have more, these are the well-known ones.
    fn layout(table: &'static [(u8, bool, &'static str)]) -> impl Fn(u16, bool) -> Option<String> {
        move |vk, shift| {
            table.iter().find(|(k, s, _)| u16::from(*k) == vk && *s == shift).map(|(_, _, c)| c.to_string())
        }
    }
    // Turkish keyboard data on purpose: the owner types on Turkish Q, where AltGr makes these characters.
    const TURKISH_Q: &[(u8, bool, &str)] = &[
        (b'Q', false, "@"),
        (b'E', false, "€"),
        (b'T', false, "₺"),
        (b'2', false, "£"),
        (b'3', false, "#"),
        (b'7', false, "{"),
    ];
    const GERMAN: &[(u8, bool, &str)] = &[
        (b'Q', false, "@"),
        (b'E', false, "€"),
        (b'M', false, "µ"),
        (b'7', false, "{"),
        (b'8', false, "["),
        (b'0', false, "}"),
    ];
    const FRENCH: &[(u8, bool, &str)] =
        &[(b'E', false, "€"), (b'2', false, "~"), (b'3', false, "#"), (b'0', false, "@")];

    #[test]
    fn ctrl_alt_letters_that_altgr_types_are_refused_with_an_explanation() {
        let tr = layout(TURKISH_Q);
        let why = altgr_reason("ctrl+alt+q", &tr).unwrap();
        assert!(why.starts_with("Ctrl+Alt+Q ") && why.contains("\"@\"") && why.contains("Pick another shortcut"), "{why}");
        assert!(altgr_reason("Ctrl+Alt+T", &tr).unwrap().contains('₺'));
        assert!(altgr_reason("ctrl+alt+KeyE", layout(GERMAN)).unwrap().contains('€'), "Tauri spelling");
        assert!(altgr_reason("ctrl+alt+m", layout(GERMAN)).unwrap().contains('µ'));
        assert!(altgr_reason("ctrl+alt+m", &tr).is_none(), "nothing on Turkish Q");
        assert!(altgr_reason("ctrl+alt+Digit0", layout(FRENCH)).unwrap().contains('@'));
        assert!(altgr_reason("ctrl+alt+q", layout(FRENCH)).is_none(), "AZERTY's Q key has no AltGr character here");
        assert!(altgr_reason("ctrl+alt+shift+q", &tr).is_none(), "the Shift layer is asked separately");
    }

    #[test]
    fn only_ctrl_alt_without_the_windows_key_and_a_character_key_is_checked() {
        let always = |_: u16, _: bool| Some("x".to_string());
        for keys in
            ["ctrl+shift+a", "ctrl+k", "alt+q", "ctrl+alt+super+q", "ctrl+alt+space", "ctrl+alt+f4", "ctrl+alt+enter"]
        {
            assert!(altgr_reason(keys, always).is_none(), "{keys}");
        }
        assert_eq!(altgr_vk("Ctrl+Alt+Shift+G"), Some((u16::from(b'G'), true)));
        assert_eq!(altgr_vk("ctrl+alt+5"), Some((u16::from(b'5'), false)));
    }

    #[test]
    fn the_defaults_and_the_spare_are_safe_on_turkish_german_and_french() {
        for table in [TURKISH_Q, GERMAN, FRENCH] {
            let t = layout(table);
            for s in defaults() {
                assert!(altgr_reason(&s.keys, &t).is_none(), "{}", s.keys);
            }
            assert!(altgr_reason(EMERGENCY_SPARE, &t).is_none());
        }
    }

    #[test]
    fn the_owner_can_add_an_exception_to_ctrl_space() {
        let mut list = defaults();
        list[1].exceptions.push("Code.exe".into());
        let mut gate = ShortcutGate::default();
        assert_eq!(
            gate.on_foreground(&list, Some("code.exe")),
            [Unregister(ShortcutId::Search), Unregister(ShortcutId::Ask)]
        );
    }
}
