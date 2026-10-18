//! Monitors with their DPI and refresh rate (`EnumDisplayMonitors` + `GetMonitorInfoW` + `GetDpiForMonitor` +
//! `EnumDisplaySettingsW`'s `dmDisplayFrequency`), physical px.
//! The process must be per-monitor DPI aware (Tauri/tao set PMv2), else Windows hands out scaled rectangles.

#[cfg(windows)]
use notch_core::model::{sort_monitors, Monitor, Rect};

/// Effective DPI -> scale; 0 or an absurd value (the call failed) = 100 %.
pub fn scale_of(dpi: u32) -> f64 {
    if (48..=960).contains(&dpi) {
        f64::from(dpi) / 96.0
    } else {
        1.0
    }
}

#[cfg(windows)]
pub fn list() -> Vec<Monitor> {
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, EnumDisplaySettingsW, GetMonitorInfoW, DEVMODEW, ENUM_CURRENT_SETTINGS, HDC, HMONITOR,
        MONITORINFO, MONITORINFOEXW,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

    fn rect(r: RECT) -> Rect {
        Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }

    unsafe extern "system" fn collect(
        monitor: HMONITOR,
        _dc: HDC,
        _rect: *mut RECT,
        out: LPARAM,
    ) -> windows::core::BOOL {
        // SAFETY: `out` is the &mut Vec passed below, alive for the whole EnumDisplayMonitors call.
        let list = unsafe { &mut *(out.0 as *mut Vec<Monitor>) };
        let mut ex = MONITORINFOEXW::default();
        ex.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        // SAFETY: a monitor handle Windows just gave us and a sized MONITORINFOEXW (its first field is MONITORINFO).
        if !unsafe { GetMonitorInfoW(monitor, &mut ex as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool() {
            return true.into();
        }
        let info = ex.monitorInfo;
        let mut mode = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
        // SAFETY: the device name Windows just wrote (NUL-terminated) and a sized DEVMODEW out-param.
        let hz = if unsafe {
            EnumDisplaySettingsW(windows::core::PCWSTR(ex.szDevice.as_ptr()), ENUM_CURRENT_SETTINGS, &mut mode)
        }
        .as_bool()
        {
            mode.dmDisplayFrequency
        } else {
            0
        };
        let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
        // SAFETY: as above; out-params are plain u32s.
        let _ = unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
        list.push(Monitor {
            index: 0,
            rect: rect(info.rcMonitor),
            work: rect(info.rcWork),
            scale: scale_of(dpi_x),
            primary: info.dwFlags & 1 != 0, // MONITORINFOF_PRIMARY
            hz,
        });
        true.into()
    }

    let mut list: Vec<Monitor> = Vec::new();
    // SAFETY: the callback only writes into `list`, which outlives the call.
    let _ = unsafe { EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut list as *mut Vec<Monitor> as isize)) };
    sort_monitors(&mut list);
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpi_maps_to_scale_and_failures_are_100_percent() {
        assert_eq!(scale_of(96), 1.0);
        assert_eq!(scale_of(120), 1.25);
        assert_eq!(scale_of(144), 1.5);
        assert_eq!(scale_of(0), 1.0);
        assert_eq!(scale_of(100_000), 1.0);
    }
}
