//! The microphone / camera privacy dot (Wave 5): who is using them, from Windows's own `ConsentStore`
//! (`HKCU\...\CapabilityAccessManager\ConsentStore\{microphone,webcam}`), not from a plugin. Each app's key holds
//! `LastUsedTimeStart` / `LastUsedTimeStop` (FILETIME); in use = Start later than Stop (Stop is 0 while in use).
//! Packaged apps are direct subkeys (`<PackageFamilyName>`), desktop apps sit under `NonPackaged` as their exe path
//! with `#` for `\`.

use serde::Serialize;

/// One app key as read from the registry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Usage {
    /// The subkey name: a package family name, or `C:#Program Files#...#app.exe`.
    pub key: String,
    pub packaged: bool,
    pub start: u64,
    pub stop: u64,
}

impl Usage {
    pub fn in_use(&self) -> bool {
        self.start > self.stop
    }

    /// The exe file name, lowercase (desktop apps only).
    pub fn exe(&self) -> Option<String> {
        (!self.packaged).then(|| self.key.rsplit('#').next().unwrap_or(&self.key).to_lowercase())
    }

    /// The name when nothing better is known: `Zoom.exe` -> "Zoom", `Microsoft.WindowsCamera_8wekyb3d8bbwe` ->
    /// "WindowsCamera".
    pub fn fallback_name(&self) -> String {
        if self.packaged {
            let family = self.key.split('_').next().unwrap_or(&self.key);
            family.rsplit('.').next().unwrap_or(family).to_string()
        } else {
            let file = self.key.rsplit('#').next().unwrap_or(&self.key);
            file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
        }
    }
}

/// `wave5-api.ts` `PrivacyState`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PrivacyState {
    pub mic: Vec<String>,
    pub camera: Vec<String>,
}

/// The friendly names of the apps using the device now, sorted, no duplicates. `name(usage)` = a better name (the
/// Start list's) or None for the fallback.
pub fn in_use(list: &[Usage], name: impl Fn(&Usage) -> Option<String>) -> Vec<String> {
    let mut out: Vec<String> =
        list.iter().filter(|u| u.in_use()).map(|u| name(u).unwrap_or_else(|| u.fallback_name())).collect();
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(key: &str, packaged: bool, start: u64, stop: u64) -> Usage {
        Usage { key: key.into(), packaged, start, stop }
    }

    #[test]
    fn in_use_is_start_after_stop_and_names_are_friendly() {
        let list = [
            u(r"C:#Program Files#Zoom#bin#Zoom.exe", false, 200, 0),
            u(r"C:#Windows#explorer.exe", false, 100, 150),
            u("Microsoft.WindowsCamera_8wekyb3d8bbwe", true, 300, 100),
            u("Never.Used_abc", true, 0, 0),
            u(r"D:#Tools#zoom.exe", false, 5, 1),
        ];
        assert_eq!(list[0].exe().as_deref(), Some("zoom.exe"));
        assert_eq!(list[2].exe(), None);
        assert_eq!(in_use(&list, |_| None), ["WindowsCamera", "Zoom", "zoom"]);
        let named = in_use(&list, |u| (u.exe().as_deref() == Some("zoom.exe")).then(|| "Zoom Workplace".into()));
        assert_eq!(named, ["WindowsCamera", "Zoom Workplace"], "two Zoom keys, one name");
    }
}
