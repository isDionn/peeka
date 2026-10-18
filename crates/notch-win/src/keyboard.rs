//! What Ctrl+Alt(+Shift)+key types on the installed keyboard layouts (`notch_core::shortcuts::altgr_reason`).
//! Adapted from CouCou (`windows/src-tauri/src/platform/windows.rs` `ctrl_alt_types`, commit ff825663, MIT; see
//! `docs/THIRD_PARTY_NOTICES.md`).

/// The character Ctrl+Alt(+Shift)+`vk` types on one of the installed layouts, if any. Windows reads Ctrl+Alt as
/// AltGr, so a global shortcut on such a combination would stop the owner typing it (Turkish Q: AltGr+Q is `@`).
#[cfg(windows)]
pub fn ctrl_alt_types(vk: u16, shift: bool) -> Option<String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyboardLayoutList, MapVirtualKeyExW, ToUnicodeEx, HKL, MAPVK_VK_TO_VSC, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    let mut layouts = [HKL(std::ptr::null_mut()); 32];
    // SAFETY: the buffer is ours; Windows fills at most its length.
    let count = unsafe { GetKeyboardLayoutList(Some(&mut layouts[..])) };
    let count = usize::try_from(count).unwrap_or(0).min(layouts.len());
    let mut state = [0u8; 256];
    state[VK_CONTROL.0 as usize] = 0x80;
    state[VK_MENU.0 as usize] = 0x80;
    if shift {
        state[VK_SHIFT.0 as usize] = 0x80;
    }
    for &layout in &layouts[..count] {
        // SAFETY: plain value calls on a layout handle Windows just listed.
        let scan = unsafe { MapVirtualKeyExW(u32::from(vk), MAPVK_VK_TO_VSC, Some(layout)) };
        let mut buf = [0u16; 8];
        // Flag 0x4: leave the keyboard state alone, so a dead key met here does not change what the owner types next.
        // SAFETY: the key state and the buffer are ours and sized as the call wants.
        let n = unsafe { ToUnicodeEx(u32::from(vk), scan, &state, &mut buf, 0x4, Some(layout)) };
        let typed = match n {
            // A dead key (´ ^ ¨) is still something the owner types with it.
            n if n < 0 => String::from_utf16_lossy(&buf[..1]),
            0 => continue,
            n => String::from_utf16_lossy(&buf[..(n as usize).min(buf.len())]),
        };
        if typed.chars().any(|c| !c.is_control()) {
            return Some(typed);
        }
    }
    None
}

#[cfg(not(windows))]
pub fn ctrl_alt_types(_vk: u16, _shift: bool) -> Option<String> {
    None
}
