//! Wi-Fi and Bluetooth on/off (`Windows.Devices.Radios`). Windows may refuse an unpackaged app
//! (`RadioAccessStatus::DeniedBySystem` / `DeniedByUser`): then the tile opens the ms-settings page instead.
//! None of this has been run against a real desktop by an agent. Needs COM/WinRT on the calling thread (MTA).

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Wifi,
    Bluetooth,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RadioError {
    /// Windows said no: the page opens the matching ms-settings page.
    Denied,
    /// No such radio on this machine.
    Missing,
    /// Anything else (the API failed).
    Failed,
}

#[cfg(windows)]
mod sys {
    use super::{Kind, RadioError};
    use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};

    fn kind_of(k: Kind) -> RadioKind {
        match k {
            Kind::Wifi => RadioKind::WiFi,
            Kind::Bluetooth => RadioKind::Bluetooth,
        }
    }

    /// Asks once whether Notch may switch radios. True = allowed.
    pub fn access() -> bool {
        Radio::RequestAccessAsync().and_then(|op| op.get()).is_ok_and(|s| s == RadioAccessStatus::Allowed)
    }

    fn find(k: Kind) -> Option<Radio> {
        let radios = Radio::GetRadiosAsync().ok()?.get().ok()?;
        radios.into_iter().find(|r| r.Kind().is_ok_and(|x| x == kind_of(k)))
    }

    /// On / off; None = no such radio (or the API failed).
    pub fn state(k: Kind) -> Option<bool> {
        find(k).and_then(|r| r.State().ok()).map(|s| s == RadioState::On)
    }

    pub fn set(k: Kind, on: bool) -> Result<(), RadioError> {
        let radio = find(k).ok_or(RadioError::Missing)?;
        let want = if on { RadioState::On } else { RadioState::Off };
        let status = radio.SetStateAsync(want).and_then(|op| op.get()).map_err(|_| RadioError::Failed)?;
        match status {
            RadioAccessStatus::Allowed => Ok(()),
            RadioAccessStatus::DeniedByUser | RadioAccessStatus::DeniedBySystem => Err(RadioError::Denied),
            _ => Err(RadioError::Failed),
        }
    }
}

#[cfg(windows)]
pub use sys::{access, set, state};
