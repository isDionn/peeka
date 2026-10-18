//! Notch's own lock. Three ways in: the Windows session locked (`WTS_SESSION_LOCK`), the owner's
//! "Kilitle" (`lock_now`), a plugin's `lock.signal`. Windows unlock lifts only its own reason; the other two need the
//! owner's click in Notch (`lock_release`). A plugin can never unlock. While locked: no password rows, no reveal,
//! no copy-back of a password, no new password item written, and nothing of the owner's goes out to a plugin
//! (Ctrl+Space, Ctrl+K "Asistana sor", shelf, pano share, scan, paperclip, share sheet, mirror; `cmd::unlocked`).

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Windows,
    Manual,
    Plugin,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Lock {
    windows: bool,
    manual: bool,
    plugin: bool,
}

/// `wave4-api.ts` `LockState`: `reason` is the strongest one held (Windows first: it lifts by itself).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct LockState {
    pub locked: bool,
    pub reason: Option<&'static str>,
}

impl Lock {
    pub fn locked(&self) -> bool {
        self.windows || self.manual || self.plugin
    }

    /// Sets or clears one reason; true = the locked state changed. Only Windows clears its own reason here.
    pub fn set(&mut self, reason: Reason, on: bool) -> bool {
        let before = self.locked();
        match reason {
            Reason::Windows => self.windows = on,
            Reason::Manual => self.manual |= on,
            Reason::Plugin => self.plugin |= on,
        }
        before != self.locked()
    }

    /// The owner's click in Notch: the button's and the plugins' reasons go; a Windows lock stays until Windows
    /// unlocks. True = the locked state changed.
    pub fn release(&mut self) -> bool {
        let before = self.locked();
        self.manual = false;
        self.plugin = false;
        before != self.locked()
    }

    pub fn state(&self) -> LockState {
        let reason = if self.windows {
            Some("windows")
        } else if self.manual {
            Some("manual")
        } else if self.plugin {
            Some("plugin")
        } else {
            None
        };
        LockState { locked: self.locked(), reason }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_unlock_lifts_only_its_own_reason_and_a_plugin_cannot_unlock() {
        let mut l = Lock::default();
        assert!(l.set(Reason::Windows, true));
        assert_eq!(l.state(), LockState { locked: true, reason: Some("windows") });
        assert!(l.set(Reason::Windows, false) && !l.locked(), "Windows unlock opens a Windows-only lock");

        l.set(Reason::Plugin, true);
        assert!(!l.set(Reason::Plugin, false) && l.locked(), "lock.signal never unlocks");
        l.set(Reason::Windows, true);
        l.set(Reason::Windows, false);
        assert!(l.locked(), "Windows unlock leaves the plugin's lock");
        assert_eq!(l.state().reason, Some("plugin"));

        l.set(Reason::Manual, true);
        assert_eq!(l.state().reason, Some("manual"));
        assert!(l.release() && !l.locked(), "the owner's click releases button + plugin");

        l.set(Reason::Windows, true);
        assert!(!l.release() && l.locked(), "a Windows lock stays until Windows unlocks");
    }
}
