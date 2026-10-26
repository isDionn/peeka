//! Bluetooth audio devices connecting and disconnecting: a WinRT `DeviceWatcher` over paired classic
//! Bluetooth association endpoints, event driven (no PowerShell, no polling). What a change means is
//! `notch_core::sources::Bluetooth` (tested there): nothing is announced until the first enumeration completes.
//!
//!
//! Headset battery (Wave 5): the level Windows itself shows in Settings › Bluetooth, the hands-free (HFP) battery
//! property on the headset's device nodes, read through WinRT `DeviceInformation` by the headset's container id. Only
//! the headset's own level; a charging case is never read. No GATT: a classic headset has no battery service, and
//! opening one could disturb the audio link. Not reported -> null.

#[cfg(windows)]
const BT_CLASSIC_PROTOCOL: &str = "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}";
#[cfg(windows)]
const KEY_CONNECTED: &str = "System.Devices.Aep.IsConnected";
#[cfg(windows)]
const KEY_CONTAINER: &str = "System.Devices.Aep.ContainerId";
/// `DEVPKEY_Bluetooth_Battery`-like property Windows fills from the HFP battery report (a byte, 0-100).
#[cfg(windows)]
const KEY_BATTERY: &str = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
#[cfg(windows)]
const KEY_COD_MAJOR: &str = "System.Devices.Aep.Bluetooth.Cod.Major";
/// The Bluetooth Class-of-Device major value for audio/video gear (headsets, speakers).
#[cfg(windows)]
const COD_AUDIO: u16 = 4;

#[cfg(windows)]
type Props = windows_collections::IMapView<windows::core::HSTRING, windows::core::IInspectable>;

#[cfg(windows)]
fn prop(props: &Props, key: &str) -> Option<windows::Foundation::IPropertyValue> {
    use windows::core::Interface;
    props.Lookup(&windows::core::HSTRING::from(key)).ok()?.cast().ok()
}

#[cfg(windows)]
fn is_connected(props: &Props) -> Option<bool> {
    prop(props, KEY_CONNECTED)?.GetBoolean().ok()
}

#[cfg(windows)]
fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The headset's battery percent from any of its device nodes; None = not reported. Blocking (a WinRT query).
#[cfg(windows)]
pub fn battery(container: &windows::core::GUID) -> Option<u8> {
    use windows::core::HSTRING;
    use windows::Devices::Enumeration::DeviceInformation;
    let aqs = HSTRING::from(["System.Devices.ContainerId:=\"{", &format!("{container:?}"), "}\""].concat());
    let props = windows_collections::IIterable::<HSTRING>::from(vec![HSTRING::from(KEY_BATTERY)]);
    let all = DeviceInformation::FindAllAsyncAqsFilterAndAdditionalProperties(&aqs, &props).ok()?.get().ok()?;
    (0..all.Size().ok()?)
        .filter_map(|i| prop(&all.GetAt(i).ok()?.Properties().ok()?, KEY_BATTERY)?.GetUInt8().ok())
        .find(|b| *b <= 100)
}

/// Starts the watcher for the process's life; `sink` gets each alert (on a WinRT pool thread), `connected` the
/// headset's name and battery when one connects (the battery read again once after 4 s if Windows had none yet).
/// False = no watcher (no Bluetooth stack); nothing is shown then.
#[cfg(windows)]
pub fn watch(
    sink: impl Fn(notch_core::alerts::Alert) + Send + Sync + 'static,
    connected: impl Fn(String, Option<u8>) + Send + Sync + 'static,
) -> bool {
    use notch_core::sources::Bluetooth;
    use parking_lot::Mutex;
    use std::sync::Arc;
    use windows::core::HSTRING;
    use windows::Devices::Enumeration::{
        DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
    };
    use windows::Foundation::TypedEventHandler;

    static WATCHER: std::sync::OnceLock<DeviceWatcher> = std::sync::OnceLock::new();
    crate::com();
    let paired = "System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True";
    let aqs = HSTRING::from([paired, &format!("System.Devices.Aep.ProtocolId:=\"{BT_CLASSIC_PROTOCOL}\"")].join(" AND "));
    let props = windows_collections::IIterable::<HSTRING>::from(vec![
        HSTRING::from(KEY_CONNECTED),
        HSTRING::from(KEY_COD_MAJOR),
        HSTRING::from(KEY_CONTAINER),
    ]);
    let Ok(watcher) = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
        &aqs,
        &props,
        DeviceInformationKind::AssociationEndpoint,
    ) else {
        return false;
    };
    let state = Arc::new(Mutex::new(Bluetooth::default()));
    let containers = Arc::new(Mutex::new(std::collections::HashMap::<String, windows::core::GUID>::new()));
    let connected = Arc::new(connected);
    let sink = {
        let (containers, connected) = (containers.clone(), connected.clone());
        Arc::new(move |id: &str, a: notch_core::alerts::Alert| {
            if a.id.starts_with("system.bluetooth.connected:") {
                let (name, guid, connected) = (a.title.clone(), containers.lock().get(id).copied(), connected.clone());
                std::thread::spawn(move || {
                    crate::com();
                    let first = guid.as_ref().and_then(battery);
                    connected(name.clone(), first);
                    if first.is_none() {
                        std::thread::sleep(std::time::Duration::from_secs(4));
                        if let Some(b) = guid.as_ref().and_then(battery) {
                            connected(name, Some(b));
                        }
                    }
                });
            }
            sink(a);
        })
    };
    let (s, out, c) = (state.clone(), sink.clone(), containers.clone());
    let _ = watcher.Added(&TypedEventHandler::new(move |_, info: windows::core::Ref<'_, DeviceInformation>| {
        let Ok(info) = info.ok() else { return Ok(()) };
        let props = info.Properties()?;
        if prop(&props, KEY_COD_MAJOR).and_then(|v| v.GetUInt16().ok()) == Some(COD_AUDIO) {
            let id = info.Id()?.to_string();
            if let Some(g) = prop(&props, KEY_CONTAINER).and_then(|v| v.GetGuid().ok()) {
                c.lock().insert(id.clone(), g);
            }
            let alert = s.lock().added(&id, &info.Name()?.to_string(), is_connected(&props).unwrap_or(false), now_ms());
            if let Some(a) = alert {
                out(&id, a);
            }
        }
        Ok(())
    }));
    let (s, out) = (state.clone(), sink.clone());
    let _ =
        watcher.Updated(&TypedEventHandler::new(move |_, update: windows::core::Ref<'_, DeviceInformationUpdate>| {
            let update = update.ok()?;
            let id = update.Id()?.to_string();
            let alert = s.lock().updated(&id, is_connected(&update.Properties()?), now_ms());
            if let Some(a) = alert {
                out(&id, a);
            }
            Ok(())
        }));
    let s = state.clone();
    let _ =
        watcher.Removed(&TypedEventHandler::new(move |_, update: windows::core::Ref<'_, DeviceInformationUpdate>| {
            let update = update.ok()?;
            s.lock().removed(&update.Id()?.to_string());
            Ok(())
        }));
    let s = state;
    let _ = watcher.EnumerationCompleted(&TypedEventHandler::new(move |_, _| {
        s.lock().ready();
        Ok(())
    }));
    if watcher.Start().is_err() {
        return false;
    }
    WATCHER.set(watcher).is_ok()
}

/// Bluetooth LE's protocol id (classic is `BT_CLASSIC_PROTOCOL`).
#[cfg(windows)]
const BT_LE_PROTOCOL: &str = "{bb7bb05e-5972-42b5-94fc-76eaa7084d49}";

/// What `devices` listed last: `set` acts only on these ids (id -> container, kind).
#[cfg(windows)]
static LISTED: parking_lot::Mutex<Vec<(String, windows::core::GUID, notch_core::pickers::BtKind)>> =
    parking_lot::Mutex::new(Vec::new());

/// The paired devices (classic and LE; a dual-mode device once), with Windows's battery where it has one. Blocking.
#[cfg(windows)]
pub fn devices() -> Vec<notch_core::pickers::BtDevice> {
    use notch_core::pickers::{bt_kind, BtDevice};
    use windows::core::HSTRING;
    use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind};
    crate::com();
    let protocol = |p: &str| format!("System.Devices.Aep.ProtocolId:=\"{p}\"");
    let aqs = HSTRING::from(format!(
        "System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True AND ({} OR {})",
        protocol(BT_CLASSIC_PROTOCOL),
        protocol(BT_LE_PROTOCOL)
    ));
    let props = windows_collections::IIterable::<HSTRING>::from(vec![
        HSTRING::from(KEY_CONNECTED),
        HSTRING::from(KEY_COD_MAJOR),
        HSTRING::from(KEY_CONTAINER),
    ]);
    let Ok(all) = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(
        &aqs,
        &props,
        DeviceInformationKind::AssociationEndpoint,
    )
    .and_then(|op| op.get()) else {
        return vec![];
    };
    let (mut out, mut listed) = (Vec::<BtDevice>::new(), vec![]);
    for info in (0..all.Size().unwrap_or(0)).filter_map(|i| all.GetAt(i).ok()) {
        let (Ok(id), Ok(name), Ok(props)) = (info.Id(), info.Name(), info.Properties()) else { continue };
        let Some(container) = prop(&props, KEY_CONTAINER).and_then(|v| v.GetGuid().ok()) else { continue };
        if listed.iter().any(|(_, c, _)| *c == container) {
            continue; // the same device over the other protocol
        }
        let kind = bt_kind(prop(&props, KEY_COD_MAJOR).and_then(|v| v.GetUInt16().ok()));
        listed.push((id.to_string(), container, kind));
        out.push(BtDevice {
            id: id.to_string(),
            name: name.to_string(),
            kind,
            battery: battery(&container),
            connected: is_connected(&props).unwrap_or(false),
        });
    }
    *LISTED.lock() = listed;
    out
}

/// Connect / disconnect a device `devices` listed: audio devices only (`audio::bt_audio`); Windows offers an app no
/// way to connect or drop a keyboard, mouse or phone (`unsupported`).
#[cfg(windows)]
pub fn set(id: &str, connect: bool) -> Result<(), notch_core::cmd::CmdError> {
    use notch_core::cmd::CmdError;
    let (container, kind) =
        LISTED.lock().iter().find(|(i, _, _)| i == id).map(|(_, c, k)| (*c, *k)).ok_or(CmdError::Unknown)?;
    if kind != notch_core::pickers::BtKind::Audio {
        return Err(CmdError::Unsupported);
    }
    crate::audio::bt_audio(&container, connect).then_some(()).ok_or(CmdError::Refused)
}
