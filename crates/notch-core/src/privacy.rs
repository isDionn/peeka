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
    /// The screen is being shared or recorded (B1): an app holds Windows.Graphics.Capture's programmatic or
    /// borderless capture right now. A flag only: which app never leaves Rust.
    pub screen: bool,
}

/// Any app key in use now (the capture capabilities: no names are built at all).
pub fn any_in_use(list: &[Usage]) -> bool {
    list.iter().any(Usage::in_use)
}

/// Desktop call apps (exe, lowercase) and packaged ones (family-name prefix). Matched in Rust only; no name leaves.
/// shortcut: a call in a browser tab is not seen (any browser mic use would count), add browsers if owners ask.
const CALL_EXES: &[&str] = &["teams.exe", "ms-teams.exe", "zoom.exe", "discord.exe", "slack.exe", "webex.exe", "ciscocollabhost.exe"];
const CALL_PACKAGES: &[&str] = &["MSTeams_", "Microsoft.SkypeApp_", "5319275A.WhatsAppDesktop_"];

/// Focus Guard (B2): a known call app holds the microphone right now.
pub fn call_active(mic: &[Usage]) -> bool {
    mic.iter().filter(|u| u.in_use()).any(|u| match u.exe() {
        Some(exe) => CALL_EXES.contains(&exe.as_str()),
        None => CALL_PACKAGES.iter().any(|p| u.key.starts_with(p)),
    })
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

    #[test]
    fn a_call_is_a_known_call_app_on_the_mic_now() {
        let zoom = u(r"C:#Program Files#Zoom#bin#Zoom.exe", false, 200, 0);
        let teams = u("MSTeams_8wekyb3d8bbwe", true, 9, 1);
        let recorder = u(r"C:#Tools#audacity.exe", false, 9, 0);
        assert!(call_active(&[recorder.clone(), zoom.clone()]) && call_active(&[teams]));
        assert!(!call_active(&[recorder]), "a mic alone is not a call");
        assert!(!call_active(&[u(r"C:#Program Files#Zoom#bin#Zoom.exe", false, 5, 9)]), "the call ended");
        assert!(!call_active(&[]));
    }

    #[test]
    fn screen_capture_is_any_key_with_start_after_stop() {
        // Shapes seen under ConsentStore\graphicsCaptureWithoutBorder on a real PC (all stopped), plus one live share.
        let stopped = [
            u(
                r"C:#Users#me#AppData#Local#Discord#app-1.0.9262#Discord.exe",
                false,
                134368269398088590,
                134368274145706034,
            ),
            u(r"C:#Program Files#obs-studio#bin#64bit#obs64.exe", false, 134366376079327514, 134366377081135004),
            u("MicrosoftWindows.Client.Core_cw5n1h2txyewy", true, 134300976937200456, 134300976937446276),
            u("OpenAI.Codex_2p2nqsd0c76g0", true, 0, 0),
        ];
        assert!(!any_in_use(&stopped));
        assert!(!any_in_use(&[]));
        let mut live = stopped.to_vec();
        live.push(u(r"C:#Users#me#AppData#Local#Programs#Opera GX#opera.exe", false, 134366166969205726, 0));
        assert!(any_in_use(&live), "a browser tab being shared");
        let v = serde_json::to_value(PrivacyState { screen: true, ..Default::default() }).unwrap();
        assert_eq!(v, serde_json::json!({"mic": [], "camera": [], "screen": true}), "a flag, no app names");
    }
}
