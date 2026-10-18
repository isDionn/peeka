//! Fullscreen detection: `SHQueryUserNotificationState` plus "the foreground window covers
//! its whole monitor". In fullscreen the strip hides (its AppBar registration stays); an approval may drop it for 4 s,
//! except over an exclusive D3D game, where a topmost window could minimise the game.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Presence {
    /// Nothing special (`QUNS_ACCEPTS_NOTIFICATIONS`, or the call failed).
    #[default]
    Normal,
    /// `QUNS_NOT_PRESENT`: locked, screen saver, fast user switching.
    NotPresent,
    /// `QUNS_BUSY`: a fullscreen app.
    Busy,
    /// `QUNS_RUNNING_D3D_FULL_SCREEN`: an exclusive fullscreen Direct3D app.
    D3dFullscreen,
    /// `QUNS_PRESENTATION_MODE`.
    Presentation,
    /// `QUNS_QUIET_TIME`: the first hour after a new install.
    QuietTime,
    /// `QUNS_APP`: a Store app in fullscreen.
    App,
}

impl Presence {
    /// The `QUERY_USER_NOTIFICATION_STATE` value; anything unknown is Normal (never hide on a guess).
    pub fn from_quns(value: i32) -> Self {
        match value {
            1 => Self::NotPresent,
            2 => Self::Busy,
            3 => Self::D3dFullscreen,
            4 => Self::Presentation,
            6 => Self::QuietTime,
            7 => Self::App,
            _ => Self::Normal,
        }
    }
}

/// Does the strip hide? `foreground_covers` = the foreground window covers its monitor (a borderless fullscreen
/// video or game that Windows does not report as busy).
pub fn strip_hidden(p: Presence, foreground_covers: bool) -> bool {
    foreground_covers || matches!(p, Presence::Busy | Presence::D3dFullscreen | Presence::Presentation | Presence::App)
}

/// May an approval drop the hidden strip for a moment? Never over an exclusive D3D game (owner decision 16).
pub fn may_drop_for_approval(p: Presence) -> bool {
    p != Presence::D3dFullscreen
}

/// Do the mascot's jokes and Notch's own protrusions stay quiet?
pub fn quiet(p: Presence) -> bool {
    matches!(p, Presence::Presentation | Presence::Busy | Presence::D3dFullscreen | Presence::NotPresent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_quns_values_map_and_unknown_is_normal() {
        assert_eq!(Presence::from_quns(3), Presence::D3dFullscreen);
        assert_eq!(Presence::from_quns(5), Presence::Normal);
        assert_eq!(Presence::from_quns(99), Presence::Normal);
    }

    #[test]
    fn fullscreen_hides_the_strip_and_d3d_never_drops_it() {
        assert!(!strip_hidden(Presence::Normal, false));
        assert!(strip_hidden(Presence::Normal, true), "borderless fullscreen");
        assert!(strip_hidden(Presence::Busy, false));
        assert!(!strip_hidden(Presence::QuietTime, false));
        assert!(may_drop_for_approval(Presence::Busy));
        assert!(!may_drop_for_approval(Presence::D3dFullscreen));
        assert!(quiet(Presence::Presentation) && !quiet(Presence::Normal));
    }
}
