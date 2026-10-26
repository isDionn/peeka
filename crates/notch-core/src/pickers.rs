//! The long-press pickers on the Wi-Fi and Bluetooth tiles: shapes (`ui/src/bridge.ts` `WifiNetwork`, `BtDevice`),
//! the pure decisions behind `notch_win::wifi` / `notch_win::bluetooth`, and the demo lists (demo never touches a radio).
//! A Wi-Fi password only passes through `profile_xml` into `WlanSetProfile` (Windows keeps it); Peeka never stores or
//! logs it, and no type here derives `Debug` over it.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0-100, Windows's own signal quality.
    pub signal: u8,
    pub secure: bool,
    pub connected: bool,
    /// Windows has a profile for it: `wifi_connect` needs no password.
    pub known: bool,
}

/// `wifi_connect`'s answer besides success (null).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WifiError {
    WrongPassword,
    Failed,
    /// No Wi-Fi adapter, or a network Peeka cannot make a profile for (enterprise, WEP, OWE).
    Unsupported,
}

/// The security of a network Peeka can make a profile for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Security {
    Open,
    Wpa2Personal,
    Wpa3Personal,
}

/// From `WLAN_AVAILABLE_NETWORK`'s default auth algorithm (`DOT11_AUTH_ALGO_*`): 1 open, 7 RSNA-PSK, 9 WPA3-SAE.
pub fn security(auth: i32, secured: bool) -> Option<Security> {
    match auth {
        1 if !secured => Some(Security::Open),
        7 => Some(Security::Wpa2Personal),
        9 => Some(Security::Wpa3Personal),
        _ => None,
    }
}

/// A WPA passphrase Windows accepts: 8-63 printable ASCII, or 64 hex digits (a raw key).
pub fn valid_password(p: &str) -> bool {
    ((8..=63).contains(&p.len()) && p.bytes().all(|b| (0x20..0x7f).contains(&b)))
        || (p.len() == 64 && p.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// The WLAN profile for a new network. `ssid` goes in as hex (any bytes); the name and the password are escaped.
/// None = a secured network without a valid password.
pub fn profile_xml(name: &str, ssid: &[u8], sec: Security, password: Option<&str>) -> Option<String> {
    let hex: String = ssid.iter().map(|b| format!("{b:02X}")).collect();
    let security = match sec {
        Security::Open => "<authEncryption><authentication>open</authentication><encryption>none</encryption>\
                           <useOneX>false</useOneX></authEncryption>"
            .to_string(),
        Security::Wpa2Personal | Security::Wpa3Personal => {
            let p = password.filter(|p| valid_password(p))?;
            let auth = if sec == Security::Wpa3Personal { "WPA3SAE" } else { "WPA2PSK" };
            let key_type = if p.len() == 64 { "networkKey" } else { "passPhrase" };
            format!(
                "<authEncryption><authentication>{auth}</authentication><encryption>AES</encryption>\
                 <useOneX>false</useOneX></authEncryption><sharedKey><keyType>{key_type}</keyType>\
                 <protected>false</protected><keyMaterial>{}</keyMaterial></sharedKey>",
                escape(p)
            )
        }
    };
    Some(format!(
        "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">\
         <name>{}</name><SSIDConfig><SSID><hex>{hex}</hex></SSID></SSIDConfig><connectionType>ESS</connectionType>\
         <connectionMode>auto</connectionMode><MSM><security>{security}</security></MSM></WLANProfile>",
        escape(name)
    ))
}

/// A failed connection's `WLAN_REASON_CODE`: the security module's range (MSMSEC, 0x40000-0x4FFFF) after a password
/// was given reads as a wrong password. shortcut: Windows has no single "bad key" code; upgrade if the owner sees a
/// wrong password reported as `failed` (or the reverse).
pub fn connect_error(reason: u32, password_given: bool) -> WifiError {
    if password_given && (0x40000..0x50000).contains(&reason) {
        WifiError::WrongPassword
    } else {
        WifiError::Failed
    }
}

/// What to do with Windows's profile after a connection attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Undo {
    Nothing,
    /// The profile Peeka made for a new network: a wrong password is not remembered.
    Delete,
    /// The known network's previous profile XML (its key still protected by Windows): the working one comes back.
    Restore(String),
}

/// `made` = Peeka created the profile; `previous` = the known profile read before it was overwritten (None = not
/// overwritten, or Windows would not hand it out: then nothing can be restored).
pub fn undo(failed: bool, made: bool, previous: Option<String>) -> Undo {
    match (failed, made, previous) {
        (false, _, _) => Undo::Nothing,
        (true, true, _) => Undo::Delete,
        (true, false, Some(xml)) => Undo::Restore(xml),
        (true, false, None) => Undo::Nothing,
    }
}

/// Windows lists a network once per profile plus once without: one row per SSID, the connected / profiled row wins,
/// hidden (empty) SSIDs dropped, strongest first.
pub fn merge(rows: Vec<WifiNetwork>) -> Vec<WifiNetwork> {
    let mut out: Vec<WifiNetwork> = vec![];
    for r in rows.into_iter().filter(|r| !r.ssid.is_empty()) {
        match out.iter_mut().find(|o| o.ssid == r.ssid) {
            Some(o) => {
                o.signal = o.signal.max(r.signal);
                o.connected |= r.connected;
                o.known |= r.known;
                o.secure |= r.secure;
            }
            None => out.push(r),
        }
    }
    out.sort_by(|a, b| b.connected.cmp(&a.connected).then(b.signal.cmp(&a.signal)));
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BtKind {
    Audio,
    Input,
    Phone,
    Computer,
    Other,
}

/// From the Bluetooth Class-of-Device major class: 1 computer, 2 phone, 4 audio/video, 5 peripheral.
pub fn bt_kind(cod_major: Option<u16>) -> BtKind {
    match cod_major {
        Some(1) => BtKind::Computer,
        Some(2) => BtKind::Phone,
        Some(4) => BtKind::Audio,
        Some(5) => BtKind::Input,
        _ => BtKind::Other,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BtDevice {
    /// Windows's device id, sent back unchanged to `bt_set` (accepted only if `bt_devices` listed it).
    pub id: String,
    pub name: String,
    pub kind: BtKind,
    pub battery: Option<u8>,
    pub connected: bool,
}

pub fn demo_wifi() -> Vec<WifiNetwork> {
    let n = |ssid: &str, signal, secure, connected, known| WifiNetwork { ssid: ssid.into(), signal, secure, connected, known };
    vec![
        n("Home-5G", 92, true, true, true),
        n("Home-2G", 74, true, false, true),
        n("Cafe Guest", 58, false, false, false),
        n("Studio-WPA3", 41, true, false, false),
    ]
}

pub fn demo_bt() -> Vec<BtDevice> {
    let d = |id: &str, name: &str, kind, battery, connected| BtDevice {
        id: id.into(),
        name: name.into(),
        kind,
        battery: Some(battery),
        connected,
    };
    vec![
        d("demo-bt-buds", "Buds Pro", BtKind::Audio, 80, true),
        d("demo-bt-keys", "MX Keys", BtKind::Input, 45, true),
        d("demo-bt-phone", "Pixel 8", BtKind::Phone, 62, false),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_escapes_name_and_password_and_hexes_the_ssid() {
        let x = profile_xml("a<b>&\"'", b"a<b", Security::Wpa2Personal, Some("p&ss<w>rd\"'")).unwrap();
        assert!(x.contains("<name>a&lt;b&gt;&amp;&quot;&apos;</name>"));
        assert!(x.contains("<hex>613C62</hex>"));
        assert!(x.contains("<keyMaterial>p&amp;ss&lt;w&gt;rd&quot;&apos;</keyMaterial>"));
        assert!(x.contains("WPA2PSK") && x.contains("passPhrase"));
        assert_eq!(x.matches("<keyMaterial>").count(), 1, "no injected element");
        let w3 = profile_xml("n", b"n", Security::Wpa3Personal, Some(&"a".repeat(64))).unwrap();
        assert!(w3.contains("WPA3SAE") && w3.contains("networkKey"));
        let open = profile_xml("n", b"n", Security::Open, None).unwrap();
        assert!(open.contains("<authentication>open</authentication>") && !open.contains("keyMaterial"));
    }

    #[test]
    fn bad_passwords_make_no_profile() {
        for p in [None, Some("short"), Some(&*"x".repeat(64)), Some("tab\there1"), Some(&*"y".repeat(65))] {
            assert_eq!(profile_xml("n", b"n", Security::Wpa2Personal, p), None, "{p:?}");
        }
        assert!(valid_password("12345678") && valid_password(&"Ab".repeat(31)) && valid_password(&"0f".repeat(32)));
    }

    #[test]
    fn only_personal_security_is_supported() {
        assert_eq!(security(1, false), Some(Security::Open));
        assert_eq!(security(1, true), None, "WEP");
        assert_eq!(security(7, true), Some(Security::Wpa2Personal));
        assert_eq!(security(9, true), Some(Security::Wpa3Personal));
        assert_eq!(security(6, true), None, "enterprise");
        assert_eq!(security(10, false), None, "OWE");
    }

    #[test]
    fn a_wrong_password_is_told_apart_only_after_one_was_given() {
        assert_eq!(connect_error(0x48014, true), WifiError::WrongPassword);
        assert_eq!(connect_error(0x48014, false), WifiError::Failed);
        assert_eq!(connect_error(0x30001, true), WifiError::Failed);
    }

    #[test]
    fn a_failed_new_password_brings_the_old_profile_back() {
        let old = || Some("<WLANProfile>old</WLANProfile>".to_string());
        assert_eq!(undo(true, false, old()), Undo::Restore("<WLANProfile>old</WLANProfile>".into()), "known + new password");
        assert_eq!(undo(true, true, None), Undo::Delete, "new network: the temporary profile goes");
        assert_eq!(undo(true, false, None), Undo::Nothing, "known, connected by its own profile: untouched");
        assert_eq!(undo(false, false, old()), Undo::Nothing, "success keeps the new password");
        assert_eq!(undo(false, true, None), Undo::Nothing);
    }

    #[test]
    fn one_row_per_ssid_connected_first() {
        let n = |ssid: &str, signal, connected, known| WifiNetwork { ssid: ssid.into(), signal, secure: true, connected, known };
        let out = merge(vec![n("A", 50, false, false), n("", 99, false, false), n("B", 40, true, true), n("A", 60, false, true)]);
        assert_eq!(out, vec![n("B", 40, true, true), n("A", 60, false, true)]);
    }

    #[test]
    fn kinds_from_the_class_of_device() {
        assert_eq!([1, 2, 4, 5, 9].map(|c| bt_kind(Some(c))), [BtKind::Computer, BtKind::Phone, BtKind::Audio, BtKind::Input, BtKind::Other]);
        assert_eq!(bt_kind(None), BtKind::Other);
        assert_eq!(serde_json::to_value(&demo_bt()[0]).unwrap()["kind"], "audio");
        assert_eq!(serde_json::to_value(WifiError::WrongPassword).unwrap(), "wrong_password");
    }
}
