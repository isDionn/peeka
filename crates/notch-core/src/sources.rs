//! Notch's own alert sources: what each Windows reading turns into.
//! The readers live in `notch-win` (volume callback, the status tick, the Bluetooth `DeviceWatcher`); the judging is
//! here so it is tested without a machine. Also the volume keys' arithmetic (owner decision 11).
//!
//! Inspired by HeyyCzer/windows-dynamic-island (ideas only; no code copied).

use std::collections::HashMap;

use crate::alerts::{Alert, Style};
use crate::status::{Battery, Volume};

const GREEN: &str = "#30D158";
const ORANGE: &str = "#FF9F0A";
const RED: &str = "#FF453A";
const THRESHOLDS: [u8; 3] = [20, 10, 5];

/// The volume bar in the list (any change, any source). It never opens the island by itself: the volume keys have
/// their own `volume_osd` event, and with key capture off Windows shows its own.
pub fn volume_alert(v: Volume, now: u64) -> Alert {
    let title = if v.muted { "Ses kapalı".to_string() } else { format!("Ses %{}", v.percent) };
    Alert {
        icon: Some(if v.muted || v.percent == 0 { "mute" } else { "volume" }.into()),
        progress: Some(if v.muted { 0.0 } else { f64::from(v.percent) / 100.0 }),
        style: Style::Level,
        ..Alert::system("system.volume", "volume", title, 100, now, 1_600)
    }
}

/// The lowest low-battery threshold crossed going from `before` to `now`.
pub fn crossed(before: u8, now: u8) -> Option<u8> {
    THRESHOLDS.iter().copied().filter(|&t| before > t && now <= t).min()
}

/// Charger plugged / unplugged, or a threshold crossed on battery; None = nothing to say (and never on the first
/// reading, nor on a desktop without a battery).
pub fn power_alert(before: Option<&Battery>, after: Option<&Battery>, now: u64) -> Option<Alert> {
    let (b, a) = (before?, after?);
    let pct = a.percent?;
    let progress = Some(f64::from(pct) / 100.0);
    if b.plugged != a.plugged {
        let title = if a.plugged { "Şarj oluyor" } else { "Pille çalışıyor" };
        return Some(Alert {
            icon: Some(if a.plugged { "charging" } else { "battery" }.into()),
            color: if a.plugged { Some(GREEN.into()) } else { None },
            progress,
            expand: true,
            ..Alert::system("system.battery", "power", title.into(), 70, now, 3_500)
        });
    }
    let t = crossed(b.percent?, pct).filter(|_| !a.plugged)?;
    let color = if t <= 10 { RED } else { ORANGE };
    Some(Alert {
        subtitle: Some(format!("%{pct} kaldı")),
        icon: Some("battery".into()),
        color: Some(color.into()),
        progress,
        expand: true,
        ..Alert::system("system.battery", "power", "Pil azaldı".into(), 80, now, 6_000)
    })
}

/// Paired Bluetooth audio devices as the `DeviceWatcher` reports them. Until the first enumeration completes,
/// everything is recorded silently: a headset already connected when Notch starts is not announced.
#[derive(Default)]
pub struct Bluetooth {
    devices: HashMap<String, (String, bool)>,
    ready: bool,
}

impl Bluetooth {
    /// `Added`: a paired device (only audio ones are passed in).
    pub fn added(&mut self, id: &str, name: &str, connected: bool, now: u64) -> Option<Alert> {
        let was = self.devices.insert(id.into(), (name.into(), connected)).map(|d| d.1);
        self.change(id, was, connected, now)
    }

    /// `Updated`: `connected` is None when the update did not carry `IsConnected`.
    pub fn updated(&mut self, id: &str, connected: Option<bool>, now: u64) -> Option<Alert> {
        let connected = connected?;
        let d = self.devices.get_mut(id)?;
        let was = std::mem::replace(&mut d.1, connected);
        self.change(id, Some(was), connected, now)
    }

    pub fn removed(&mut self, id: &str) {
        self.devices.remove(id);
    }

    /// `EnumerationCompleted`: from now on changes are announced.
    pub fn ready(&mut self) {
        self.ready = true;
    }

    fn change(&self, id: &str, was: Option<bool>, connected: bool, now: u64) -> Option<Alert> {
        if !self.ready || was == Some(connected) || (was.is_none() && !connected) {
            return None;
        }
        let name = self.devices.get(id)?.0.clone();
        // The kind is part of the id, so a quick reconnect after a disconnect is a fresh alert, not an update.
        let (kind, sub, ms) =
            if connected { ("connected", "Bağlandı", 4_000) } else { ("disconnected", "Bağlantı kesildi", 2_500) };
        Some(Alert {
            subtitle: Some(sub.into()),
            icon: Some("headphones".into()),
            expand: true,
            ..Alert::system(&format!("system.bluetooth.{kind}:{id}"), "bluetooth", name, 70, now, ms)
        })
    }
}

/// How long after the headset left a player may still flip to "paused" and count as "it stopped because of that".
pub const MUSIC_GRACE_MS: u64 = 3_000;
/// How long a disconnect waits for the music to pause before it decides the music simply plays on (speakers).
const MUSIC_WAIT_MS: u64 = 4_000;

/// "Kulaklık ayrıldı · müzik durdu" (scenario 19): joins the Bluetooth watcher's disconnect with the media state.
/// Windows usually pauses the player, but the pause can arrive just before or just after the disconnect; a player that
/// keeps playing through the speakers is not "stopped", so nothing is said. Platform-free; `now` is Unix ms.
#[derive(Debug, Default)]
pub struct HeadsetDrop {
    playing: bool,
    /// The last moment the music was playing (including the moment it paused).
    last_playing_ms: u64,
    /// A disconnect that found the music still playing: (device, when).
    armed: Option<(String, u64)>,
}

impl HeadsetDrop {
    /// A media event (`playing` = SMTC says playing). Some(device) = the music paused right after a disconnect.
    pub fn on_media(&mut self, playing: bool, now: u64) -> Option<String> {
        let was = std::mem::replace(&mut self.playing, playing);
        if playing || was {
            self.last_playing_ms = now;
        }
        if playing {
            return None;
        }
        self.armed.take().map(|(name, _)| name)
    }

    /// A headset disconnected. Some(device) = the music had already paused (within `MUSIC_GRACE_MS`).
    pub fn on_disconnect(&mut self, name: &str, now: u64) -> Option<String> {
        if self.playing {
            self.armed = Some((name.to_string(), now));
            return None;
        }
        (self.last_playing_ms > 0 && now.saturating_sub(self.last_playing_ms) <= MUSIC_GRACE_MS)
            .then(|| name.to_string())
    }

    /// The 1 s tick: a disconnect whose music kept playing is forgotten.
    pub fn tick(&mut self, now: u64) {
        if self.armed.as_ref().is_some_and(|(_, at)| now.saturating_sub(*at) > MUSIC_WAIT_MS) {
            self.armed = None;
        }
    }
}

/// The device name of a `system.bluetooth.disconnected:` alert (what `HeadsetDrop::on_disconnect` takes).
pub fn disconnected_name(a: &Alert) -> Option<&str> {
    a.id.starts_with("system.bluetooth.disconnected:").then_some(a.title.as_str())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VolumeKey {
    Up,
    Down,
    Mute,
}

impl VolumeKey {
    /// `VK_VOLUME_MUTE` / `_DOWN` / `_UP`; anything else is not ours and passes through.
    pub fn from_vk(vk: u32) -> Option<Self> {
        match vk {
            0xAD => Some(Self::Mute),
            0xAE => Some(Self::Down),
            0xAF => Some(Self::Up),
            _ => None,
        }
    }

    /// The new (percent, muted): steps of 2 like Windows, snapped to even; up/down also unmute.
    pub fn apply(self, v: Volume) -> (u8, bool) {
        match self {
            Self::Up => (((v.percent / 2 + 1) * 2).min(100), false),
            Self::Down => ((v.percent.saturating_sub(1) / 2 * 2), false),
            Self::Mute => (v.percent, !v.muted),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bat(percent: u8, plugged: bool) -> Battery {
        Battery { percent: Some(percent), charging: plugged, plugged, remaining: None }
    }

    #[test]
    fn thresholds() {
        assert_eq!(crossed(25, 18), Some(20));
        assert_eq!(crossed(18, 18), None);
        assert_eq!(crossed(11, 10), Some(10));
        assert_eq!(crossed(7, 3), Some(5));
        assert_eq!(crossed(40, 2), Some(5), "several at once: the lowest");
        assert_eq!(crossed(15, 17), None, "charging up");
    }

    #[test]
    fn power_alerts() {
        assert!(power_alert(None, Some(&bat(50, false)), 0).is_none(), "the first reading is a baseline");
        assert!(power_alert(Some(&bat(50, false)), None, 0).is_none(), "a desktop");
        let plug = power_alert(Some(&bat(50, false)), Some(&bat(50, true)), 0).unwrap();
        assert_eq!((plug.title.as_str(), plug.color.as_deref(), plug.expand), ("Şarj oluyor", Some(GREEN), true));
        let un = power_alert(Some(&bat(50, true)), Some(&bat(50, false)), 0).unwrap();
        assert_eq!((un.title.as_str(), un.color), ("Pille çalışıyor", None));
        let low = power_alert(Some(&bat(11, false)), Some(&bat(10, false)), 0).unwrap();
        assert_eq!((low.priority, low.color.as_deref(), low.subtitle.as_deref()), (80, Some(RED), Some("%10 kaldı")));
        assert!(power_alert(Some(&bat(21, true)), Some(&bat(20, true)), 0).is_none(), "on the charger: no warning");
        assert!(power_alert(Some(&bat(40, false)), Some(&bat(39, false)), 0).is_none());
    }

    #[test]
    fn bluetooth_start_is_silent_then_changes_are_announced() {
        let mut bt = Bluetooth::default();
        assert!(bt.added("h", "AirPods", true, 0).is_none(), "already connected at start");
        assert!(bt.added("s", "Hoparlör", false, 0).is_none());
        bt.ready();
        assert!(bt.updated("h", None, 0).is_none(), "no IsConnected in the update");
        assert!(bt.updated("h", Some(true), 0).is_none(), "no change");
        let off = bt.updated("h", Some(false), 0).unwrap();
        assert_eq!((off.id.as_str(), off.title.as_str()), ("system.bluetooth.disconnected:h", "AirPods"));
        let on = bt.updated("s", Some(true), 0).unwrap();
        assert_eq!(
            (on.id.as_str(), on.subtitle.as_deref(), on.priority),
            ("system.bluetooth.connected:s", Some("Bağlandı"), 70)
        );
        assert!(bt.updated("ghost", Some(true), 0).is_none(), "never added");
        assert!(bt.added("new", "Kulaklık", true, 0).is_some(), "paired and connected after start");
        bt.removed("new");
        assert!(bt.updated("new", Some(false), 0).is_none());
    }

    #[test]
    fn music_that_pauses_after_the_headset_left_is_reported_once() {
        let mut h = HeadsetDrop::default();
        assert_eq!(h.on_media(true, 1_000), None);
        assert_eq!(h.on_disconnect("AirPods", 10_000), None, "still playing: wait for the pause");
        assert_eq!(h.on_media(false, 10_800).as_deref(), Some("AirPods"));
        assert_eq!(h.on_media(false, 11_000), None, "told only once");
    }

    #[test]
    fn a_pause_that_came_just_before_the_disconnect_counts_too() {
        let mut h = HeadsetDrop::default();
        h.on_media(true, 1_000);
        h.on_media(false, 9_000);
        assert_eq!(h.on_disconnect("AirPods", 10_500).as_deref(), Some("AirPods"), "paused 1.5 s ago");
        let mut late = HeadsetDrop::default();
        late.on_media(true, 1_000);
        late.on_media(false, 2_000);
        assert_eq!(late.on_disconnect("AirPods", 2_000 + MUSIC_GRACE_MS + 1), None, "paused long ago by the owner");
        assert_eq!(HeadsetDrop::default().on_disconnect("AirPods", 100), None, "nothing ever played");
    }

    #[test]
    fn music_that_keeps_playing_on_the_speakers_is_not_stopped() {
        let mut h = HeadsetDrop::default();
        h.on_media(true, 0);
        assert_eq!(h.on_disconnect("AirPods", 5_000), None);
        h.tick(5_000 + MUSIC_WAIT_MS + 1);
        assert_eq!(h.on_media(false, 60_000), None, "a pause a minute later is the owner's, not the headset's");
    }

    #[test]
    fn only_a_disconnect_alert_names_a_device() {
        let mut bt = Bluetooth::default();
        bt.added("h", "AirPods", true, 0);
        bt.ready();
        let off = bt.updated("h", Some(false), 0).unwrap();
        assert_eq!(disconnected_name(&off), Some("AirPods"));
        let on = bt.updated("h", Some(true), 0).unwrap();
        assert_eq!(disconnected_name(&on), None);
    }

    #[test]
    fn volume_keys_step_by_two_and_unmute() {
        let v = |percent, muted| Volume { percent, muted };
        assert_eq!(VolumeKey::from_vk(0xAF), Some(VolumeKey::Up));
        assert_eq!(VolumeKey::from_vk(0xB3), None, "play/pause is not ours");
        assert_eq!(VolumeKey::Up.apply(v(45, true)), (46, false));
        assert_eq!(VolumeKey::Up.apply(v(44, false)), (46, false));
        assert_eq!(VolumeKey::Up.apply(v(99, false)), (100, false));
        assert_eq!(VolumeKey::Up.apply(v(100, false)), (100, false));
        assert_eq!(VolumeKey::Down.apply(v(45, false)), (44, false));
        assert_eq!(VolumeKey::Down.apply(v(44, false)), (42, false));
        assert_eq!(VolumeKey::Down.apply(v(0, false)), (0, false));
        assert_eq!(VolumeKey::Mute.apply(v(30, false)), (30, true));
        assert_eq!(VolumeKey::Mute.apply(v(30, true)), (30, false));
    }

    #[test]
    fn the_volume_bar() {
        let a = volume_alert(Volume { percent: 45, muted: false }, 10);
        assert_eq!(
            (a.style, a.progress, a.priority, a.expand, a.expires_at),
            (Style::Level, Some(0.45), 100, false, Some(1610))
        );
        assert_eq!(volume_alert(Volume { percent: 45, muted: true }, 0).icon.as_deref(), Some("mute"));
    }
}
