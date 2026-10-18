//! Start panel power buttons. Restart / shut down are hold-to-confirm in the UI; here they are an enum, so the page
//! can never pass anything else. Restart / shut down run `%SystemRoot%\System32\shutdown.exe` with fixed arguments
//! (no shell, no page text): it does the privilege dance `ExitWindowsEx` would need.

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PowerAction {
    Lock,
    Sleep,
    Restart,
    Shutdown,
}

/// `shutdown.exe`'s arguments for the two that use it.
pub fn shutdown_args(a: PowerAction) -> Option<&'static [&'static str]> {
    match a {
        PowerAction::Restart => Some(&["/r", "/t", "0"]),
        PowerAction::Shutdown => Some(&["/s", "/t", "0"]),
        PowerAction::Lock | PowerAction::Sleep => None,
    }
}

/// True = Windows took it.
#[cfg(windows)]
pub fn run(a: PowerAction) -> bool {
    use std::os::windows::process::CommandExt;
    use windows::Win32::System::Power::SetSuspendState;
    use windows::Win32::System::Shutdown::LockWorkStation;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match a {
        // SAFETY: no arguments.
        PowerAction::Lock => unsafe { LockWorkStation() }.is_ok(),
        // SAFETY: plain flags: sleep (not hibernate), not forced, wake events allowed.
        PowerAction::Sleep => unsafe { SetSuspendState(false, false, false) },
        PowerAction::Restart | PowerAction::Shutdown => {
            let Some(root) = std::env::var_os("SystemRoot") else { return false };
            let exe = std::path::PathBuf::from(root).join("System32").join("shutdown.exe");
            std::process::Command::new(exe)
                .args(shutdown_args(a).unwrap_or_default())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .is_ok()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_four_actions_parse_and_only_two_use_shutdown_exe() {
        assert_eq!(serde_json::from_str::<PowerAction>(r#""restart""#).unwrap(), PowerAction::Restart);
        assert!(serde_json::from_str::<PowerAction>(r#""logoff""#).is_err());
        assert_eq!(shutdown_args(PowerAction::Shutdown), Some(&["/s", "/t", "0"][..]));
        assert_eq!(shutdown_args(PowerAction::Lock), None);
    }
}
