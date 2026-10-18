//! `SHQueryUserNotificationState` -> `notch_core::presence::Presence` (mapping and decisions tested there).

#[cfg(windows)]
pub fn read() -> notch_core::presence::Presence {
    use notch_core::presence::Presence;
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    // SAFETY: no arguments; a failure counts as Normal (never hide on a guess).
    unsafe { SHQueryUserNotificationState() }.map_or(Presence::Normal, |s| Presence::from_quns(s.0))
}
