//! Battery (`GetSystemPowerStatus`), volume (`IAudioEndpointVolume`, read and set), network
//! (`GetNetworkConnectivityHint`) and the radios' on/off (`radios`). The raw values go through `notch_core::status`'s mappers (tested there).
//! Volume changes also arrive as events (`volume::watch`); the rest is read on the app's 2 s status tick.
//! shortcut: network and power are still polled there wants `NotifyNetworkConnectivityHintChange` and
//! `RegisterPowerSettingNotification` (a message window) - upgrade when the tick's cost shows up.

#[cfg(windows)]
use notch_core::status::{self, Battery, Network, Radio, Status, Volume};

/// Everything Windows can tell; `dnd` and `brightness` are Notch's (settings, the cached DDC read) and the caller
/// fills them. SSID / Bluetooth device names are not read yet (None).
#[cfg(windows)]
pub fn read() -> Status {
    use crate::radios::{state, Kind};
    let v = volume();
    let radio = |k| state(k).map(|on| Radio { on, name: None });
    Status {
        volume: v.map(|v| v.percent),
        muted: v.is_some_and(|v| v.muted),
        wifi: radio(Kind::Wifi),
        bluetooth: radio(Kind::Bluetooth),
        network: network(),
        battery: battery(),
        ..Status::default()
    }
}

#[cfg(windows)]
pub fn battery() -> Option<Battery> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    // SAFETY: an out-param struct we own.
    unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
    let mut b = status::battery_from_raw(s.BatteryFlag, s.BatteryLifePercent, s.BatteryLifeTime, s.ACLineStatus)?;
    if b.charging {
        b.remaining = time_to_full().map(status::remaining_text);
    }
    Some(b)
}

/// Approximate seconds to full from the battery's own charge rate (`SystemBatteryState`); None = not reported.
#[cfg(windows)]
fn time_to_full() -> Option<u32> {
    use windows::Win32::System::Power::{CallNtPowerInformation, SystemBatteryState, SYSTEM_BATTERY_STATE};
    let mut st = SYSTEM_BATTERY_STATE::default();
    let size = std::mem::size_of::<SYSTEM_BATTERY_STATE>() as u32;
    // SAFETY: no input; an output struct of exactly `size` bytes we own.
    let r = unsafe { CallNtPowerInformation(SystemBatteryState, None, 0, Some(&mut st as *mut _ as *mut _), size) };
    if r.is_err() || !st.BatteryPresent || !st.Charging {
        return None;
    }
    status::time_to_full(st.MaxCapacity, st.RemainingCapacity, st.Rate)
}

#[cfg(windows)]
fn endpoint() -> Option<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    crate::com();
    // SAFETY: plain COM calls on objects released on drop.
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let speaker = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        speaker.Activate(CLSCTX_ALL, None).ok()
    }
}

/// The default speaker to `pct` %; a non-zero level also unmutes. False = no speaker / refused.
#[cfg(windows)]
pub fn set_volume(pct: u8) -> bool {
    let Some(endpoint) = endpoint() else { return false };
    let ctx = &crate::volume::NOTCH_CONTEXT; // the volume watcher sees this change as Notch's own
                                             // SAFETY: a live endpoint; the context GUID outlives the calls.
    unsafe {
        let ok = endpoint.SetMasterVolumeLevelScalar(f32::from(pct.min(100)) / 100.0, ctx).is_ok();
        ok && (pct == 0 || endpoint.SetMute(false, ctx).is_ok())
    }
}

#[cfg(windows)]
pub fn volume() -> Option<Volume> {
    let endpoint = endpoint()?;
    // SAFETY: a live endpoint.
    unsafe {
        let level = endpoint.GetMasterVolumeLevelScalar().ok()?;
        let muted = endpoint.GetMute().ok()?.as_bool();
        Some(status::volume_from_scalar(level, muted))
    }
}

#[cfg(windows)]
pub fn network() -> Network {
    use windows::Win32::NetworkManagement::IpHelper::GetNetworkConnectivityHint;
    use windows::Win32::Networking::WinSock::NL_NETWORK_CONNECTIVITY_HINT;
    let mut hint = NL_NETWORK_CONNECTIVITY_HINT::default();
    // SAFETY: an out-param struct we own; NO_ERROR = 0.
    if unsafe { GetNetworkConnectivityHint(&mut hint) }.0 != 0 {
        return Network::Unknown;
    }
    status::network_from_level(hint.ConnectivityLevel.0)
}
