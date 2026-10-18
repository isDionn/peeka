// Peeka — original implementation (MIT).
//! Asks the installed keyboard layouts what a Ctrl+Alt(+Shift) combination types, for
//! `notch_core::shortcuts::altgr_reason`.

/// Text that Ctrl+Alt(+Shift)+`vk` produces on the first installed layout where it produces any printable
/// character. Windows treats Ctrl+Alt as AltGr, so registering such a combination globally would stop the owner
/// typing that character (on Turkish Q, AltGr+Q is `@`).
#[cfg(windows)]
pub fn ctrl_alt_types(vk: u16, shift: bool) -> Option<String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayoutList, MapVirtualKeyExW, ToUnicodeEx, MAPVK_VK_TO_VSC, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    // ToUnicodeEx flag: leave the keyboard state alone, so probing a dead key does not alter the next keystroke.
    const KEEP_STATE: u32 = 0x4;
    const DOWN: u8 = 0x80;

    let mut layouts = [Default::default(); 32];
    // SAFETY: the slice is valid for writes of its full length, which the call is told.
    let count = unsafe { GetKeyboardLayoutList(Some(&mut layouts)) };
    let count = usize::try_from(count).unwrap_or(0).min(layouts.len());

    let mut state = [0u8; 256];
    state[usize::from(VK_CONTROL.0)] = DOWN;
    state[usize::from(VK_MENU.0)] = DOWN;
    if shift {
        state[usize::from(VK_SHIFT.0)] = DOWN;
    }

    for &hkl in &layouts[..count] {
        let mut out = [0u16; 8];
        // SAFETY: plain lookups with a layout handle the OS just listed; `state` and `out` are live local buffers
        // whose lengths the bindings pass on, and KEEP_STATE leaves the shared keyboard state untouched.
        let n = unsafe {
            let scan = MapVirtualKeyExW(u32::from(vk), MAPVK_VK_TO_VSC, Some(hkl));
            ToUnicodeEx(u32::from(vk), scan, &state, &mut out, KEEP_STATE, Some(hkl))
        };
        let typed = match n {
            0 => continue,
            // Dead key: its mark is left in the first unit.
            n if n < 0 => &out[..1],
            n => &out[..(n as usize).min(out.len())],
        };
        // Layouts without AltGr answer Ctrl+letter with control codes; those type nothing.
        if char::decode_utf16(typed.iter().copied()).any(|c| c.map_or(true, |c| !c.is_control())) {
            return Some(String::from_utf16_lossy(typed));
        }
    }
    None
}

#[cfg(not(windows))]
pub fn ctrl_alt_types(_vk: u16, _shift: bool) -> Option<String> {
    None
}
