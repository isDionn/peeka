//! `GetLastInputInfo` for `input_tick` (Wave 5): keyboard and mouse alike (no hook is
//! added to tell them apart). The decisions: `notch_core::input`.

/// (the last input's tick count, ms since then); None = Windows would not say.
#[cfg(windows)]
pub fn last_input() -> Option<(u32, u64)> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: a sized out-param we own.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return None;
    }
    // SAFETY: no arguments. Both are 32-bit tick counts, so the wrap after 49.7 days cancels out.
    let now = unsafe { GetTickCount() };
    Some((info.dwTime, u64::from(now.wrapping_sub(info.dwTime))))
}
