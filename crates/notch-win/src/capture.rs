//! `SetWindowDisplayAffinity` on the island window, behind `notch_core::capture::Affinity`. Windows
//! honours it only with DWM composition on and for a window of the calling process (Windows 10 2004+); Microsoft
//! does not call it a security feature. Not tried on a real desktop by an agent.

pub struct IslandAffinity(pub isize);

#[cfg(windows)]
impl notch_core::capture::Affinity for IslandAffinity {
    fn exclude(&self, on: bool) -> bool {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
        let flag = if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        // SAFETY: a window of this process (the island); a stale handle only fails.
        unsafe { SetWindowDisplayAffinity(HWND(self.0 as _), flag) }.is_ok()
    }
}

#[cfg(not(windows))]
impl notch_core::capture::Affinity for IslandAffinity {
    fn exclude(&self, _on: bool) -> bool {
        false
    }
}
