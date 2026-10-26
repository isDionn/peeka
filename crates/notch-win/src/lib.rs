//! Notch's Windows adapters behind `notch-core`'s ports. Every Win32 call is `#[cfg(windows)]`; the
//! small pure helpers beside them (and `notch-core`'s fakes) carry the decision tests, so `cargo test` never reaches
//! the live desktop. None of this has been run against a real desktop by an agent (Wave 0).

pub mod appbar;
pub mod apps;
pub mod audio;
pub mod autostart;
pub mod bluetooth;
pub mod brightness;
pub mod capture;
pub mod clip_image;
pub mod clipboard;
pub mod cpu;
#[cfg(windows)]
pub mod diagnostics;
pub mod downloads;
pub mod dpapi;
pub mod drag;
pub mod flash;
pub mod foreground;
pub mod icons;
pub mod input;
pub mod keyboard;
pub mod media;
pub mod monitors;
pub mod notifications;
pub mod wpn;
pub mod ocr;
pub mod outline;
pub mod picker;
pub mod power;
pub mod presence;
pub mod preview;
pub mod privacy;
pub mod radios;
pub mod session;
pub mod session_window;
pub mod share;
pub mod startmenu;
pub mod status;
pub mod style;
pub mod sysmon;
pub mod taskbar;
pub mod tint;
pub mod tray;
pub mod volume;
pub mod wifi;
pub mod winkey;
pub mod winsearch;

/// UTF-16 buffer up to its first NUL, lossy.
pub fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// NUL-terminated UTF-16 for a Win32 `PCWSTR`.
pub fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// `<System32>\<exe>` from `GetSystemDirectoryW` (not `%SystemRoot%`, which any parent process can set).
#[cfg(windows)]
pub fn system_exe(exe: &str) -> Option<String> {
    use windows::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buf = [0u16; 260];
    // SAFETY: the buffer is ours; the call writes at most its length.
    let n = unsafe { GetSystemDirectoryW(Some(&mut buf)) } as usize;
    (n > 0 && n < buf.len()).then(|| format!("{}\\{exe}", wide_to_string(&buf[..n])))
}

/// Windows's own Start menu: one Windows key press (down, up), as if typed.
#[cfg(windows)]
pub fn press_windows_key() -> bool {
    win_chord(None)
}

/// Windows's notification center with its calendar: Win+N (Microsoft's Windows 11 shortcut list). It opens even
/// while Peeka hides the taskbar; Win+Alt+D (the taskbar's own date flyout) does not (VM check, t7-02/t7-03).
#[cfg(windows)]
pub fn open_calendar_flyout() -> bool {
    win_chord(Some(windows::Win32::UI::Input::KeyboardAndMouse::VK_N))
}

/// The Windows key, optionally with one more key held, pressed and released as if typed.
#[cfg(windows)]
fn win_chord(with: Option<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY>) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN,
    };
    let key = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, dwFlags: flags, ..Default::default() } },
    };
    let (down, up) = (KEYBD_EVENT_FLAGS(0), KEYEVENTF_KEYUP);
    let inputs: Vec<INPUT> = match with {
        Some(vk) => vec![key(VK_LWIN, down), key(vk, down), key(vk, up), key(VK_LWIN, up)],
        None => vec![key(VK_LWIN, down), key(VK_LWIN, up)],
    };
    // SAFETY: well-formed keyboard inputs and their size.
    unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) as usize == inputs.len() }
}

/// COM (and WinRT) for this thread, multi-threaded; "already initialised" in either apartment is fine.
#[cfg(windows)]
pub fn com() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    // SAFETY: plain COM init, no reserved pointer.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

/// Every reader together, as `notch_core::ports::Desktop`.
#[cfg(windows)]
pub struct Win32Desktop;

#[cfg(windows)]
impl notch_core::ports::Desktop for Win32Desktop {
    fn monitors(&self) -> Vec<notch_core::model::Monitor> {
        monitors::list()
    }
    fn windows(&self) -> Vec<notch_core::apps::RawWindow> {
        apps::enumerate(&monitors::list())
    }
    fn status(&self) -> notch_core::status::Status {
        status::read()
    }
    fn presence(&self) -> notch_core::presence::Presence {
        presence::read()
    }
    fn foreground_covers(&self) -> bool {
        apps::foreground_covers()
    }
}

/// Today's local date (year, month, day) from `GetLocalTime`.
#[cfg(windows)]
pub fn local_date() -> (i32, u32, u32) {
    // SAFETY: no arguments; returns the struct by value.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    (i32::from(t.wYear), u32::from(t.wMonth), u32::from(t.wDay))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_strings_round_trip_and_stop_at_nul() {
        let w = to_wide("Éa");
        assert_eq!(w.last(), Some(&0));
        assert_eq!(wide_to_string(&w), "Éa");
        assert_eq!(wide_to_string(&[0x41, 0, 0x42]), "A");
        assert_eq!(wide_to_string(&[0x41, 0x42]), "AB");
    }
}
