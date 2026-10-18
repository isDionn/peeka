//! The strip's right side and the status card: volume, brightness, radios, network, battery. The Windows readers fill these from raw
//! API values through the pure mappers below.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Battery {
    pub percent: Option<u8>,
    pub charging: bool,
    /// On the charger (`ACLineStatus` 1); true at 100 % too, where `charging` is false.
    pub plugged: bool,
    /// On battery: time left, "3 sa 10 dk". While charging: the approximate time to full (`time_to_full`; the page
    /// says "yaklaşık"). None when Windows does not know.
    pub remaining: Option<String>,
}

/// `SYSTEM_POWER_STATUS` fields -> a battery; None = no battery (a desktop) or Windows does not know.
/// `BatteryFlag` 8 charging, 128 no battery, 255 unknown; `BatteryLifePercent` 0-100 or 255 unknown;
/// `BatteryLifeTime` seconds left or `u32::MAX` unknown; `ACLineStatus` 1 on the charger.
pub fn battery_from_raw(flag: u8, percent: u8, life_secs: u32, ac_line: u8) -> Option<Battery> {
    if flag == 255 || flag & 128 != 0 {
        return None;
    }
    let charging = flag & 8 != 0;
    Some(Battery {
        percent: (percent <= 100).then_some(percent),
        charging,
        plugged: ac_line == 1,
        remaining: (!charging && life_secs != u32::MAX).then(|| remaining_text(life_secs)),
    })
}

/// Approximate seconds to full from `SYSTEM_BATTERY_STATE` (mWh, and `Rate` in mW, positive while charging; the
/// field is a LONG Windows hands out as ULONG). None when it is not charging or the numbers make no sense. Linear:
/// the last few percent charge slower, so this reads short near full (the page says "yaklaşık").
pub fn time_to_full(max_mwh: u32, remaining_mwh: u32, rate_raw: u32) -> Option<u32> {
    let rate = rate_raw as i32;
    if rate <= 0 || max_mwh == 0 || remaining_mwh >= max_mwh {
        return None;
    }
    let secs = u64::from(max_mwh - remaining_mwh) * 3600 / rate as u64;
    (secs <= 24 * 3600).then_some(secs as u32)
}

/// 11400 s -> "3 sa 10 dk", under an hour "42 dk".
pub fn remaining_text(secs: u32) -> String {
    let (h, m) = (secs / 3600, secs % 3600 / 60);
    if h == 0 {
        format!("{m} dk")
    } else {
        format!("{h} sa {m} dk")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Volume {
    pub percent: u8,
    pub muted: bool,
}

/// `IAudioEndpointVolume::GetMasterVolumeLevelScalar` (0.0-1.0) -> whole percent.
pub fn volume_from_scalar(level: f32, muted: bool) -> Volume {
    let level = if level.is_finite() { level.clamp(0.0, 1.0) } else { 0.0 };
    Volume { percent: (level * 100.0).round() as u8, muted }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Network {
    Unknown,
    None,
    Local,
    Internet,
    Constrained,
}

/// `NL_NETWORK_CONNECTIVITY_LEVEL_HINT` -> what the strip shows. 5 ("hidden") is Windows's own "do not show".
pub fn network_from_level(level: i32) -> Network {
    match level {
        1 => Network::None,
        2 => Network::Local,
        3 => Network::Internet,
        4 => Network::Constrained,
        _ => Network::Unknown,
    }
}

/// One radio tile: on/off and what it is connected to. `name` (Wi-Fi SSID, Bluetooth device) is None until Notch can
/// read it (Wave 2); the UI then shows "Açık" rather than a made-up name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Radio {
    pub on: bool,
    pub name: Option<String>,
}

/// The status card's and the strip's one shape (`ui/src/bridge.ts` `Status`). Every field Windows could not give is
/// None / null, never a guess.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Status {
    /// 0-100; None = no speaker / unreadable.
    pub volume: Option<u8>,
    pub muted: bool,
    /// The primary monitor's, 0-100; None = not controllable (most desktop monitors without DDC/CI).
    pub brightness: Option<u8>,
    /// None = this machine has no such radio (or the radio API is unavailable).
    pub wifi: Option<Radio>,
    pub bluetooth: Option<Radio>,
    /// Notch's own "do not disturb" (settings), not Windows Focus.
    pub dnd: bool,
    /// When DND ends ("18:00'e kadar"). Always None: Notch's DND has no end time yet (`set_dnd` takes only on/off).
    #[serde(rename = "dndUntil")]
    pub dnd_until: Option<String>,
    pub network: Network,
    pub battery: Option<Battery>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            volume: None,
            muted: false,
            brightness: None,
            wifi: None,
            bluetooth: None,
            dnd: false,
            dnd_until: None,
            network: Network::Unknown,
            battery: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn battery_unknowns_and_no_battery() {
        assert_eq!(battery_from_raw(128, 255, 0, 1), None, "a desktop");
        assert_eq!(battery_from_raw(255, 255, 0, 1), None);
        let b = battery_from_raw(8 | 2, 54, 600, 1).unwrap();
        assert_eq!(b, Battery { percent: Some(54), charging: true, plugged: true, remaining: None });
        let low = battery_from_raw(4, 255, u32::MAX, 0).unwrap();
        assert_eq!((low.percent, low.remaining, low.plugged), (None, None, false));
        assert_eq!(battery_from_raw(0, 78, 11400, 0).unwrap().remaining.as_deref(), Some("3 sa 10 dk"));
        assert_eq!(remaining_text(2520), "42 dk");
    }

    #[test]
    fn time_to_full_is_linear_and_refuses_nonsense() {
        assert_eq!(time_to_full(50_000, 25_000, 25_000), Some(3600));
        assert_eq!(time_to_full(50_000, 49_000, 30_000).map(remaining_text).as_deref(), Some("2 dk"));
        assert_eq!(time_to_full(50_000, 25_000, (-9_000i32) as u32), None, "discharging");
        assert_eq!(time_to_full(50_000, 25_000, 0), None);
        assert_eq!(time_to_full(50_000, 50_000, 9_000), None, "full");
        assert_eq!(time_to_full(0, 0, 9_000), None);
        assert_eq!(time_to_full(50_000, 0, 1), None, "a trickle: over a day is not an estimate");
    }

    #[test]
    fn status_serialises_as_the_ui_reads_it() {
        let v = serde_json::to_value(Status::default()).unwrap();
        assert_eq!(v["wifi"], serde_json::Value::Null);
        assert_eq!(v["network"], "unknown");
        assert_eq!(v["volume"], serde_json::Value::Null);
    }

    #[test]
    fn volume_and_network_map() {
        assert_eq!(volume_from_scalar(0.456, false), Volume { percent: 46, muted: false });
        assert_eq!(volume_from_scalar(f32::NAN, true).percent, 0);
        assert_eq!(volume_from_scalar(3.0, false).percent, 100);
        assert_eq!(network_from_level(3), Network::Internet);
        assert_eq!(network_from_level(5), Network::Unknown);
    }
}
