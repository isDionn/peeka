//! The primary monitor's brightness over DDC/CI (`dxva2`: `GetMonitorBrightness` / `SetMonitorBrightness`).
//! shortcut: a laptop's built-in panel answers only through WMI (`WmiMonitorBrightnessMethods`), not read here; such
//! a machine gets "unsupported" and the slider is hidden. Add the WMI path in Wave 2 if the owner's machine needs it.
//! DDC/CI calls can take ~50 ms each: read once at start and after a set, never on the status tick.

/// Raw DDC value in `min..=max` -> whole percent.
pub fn percent(min: u32, cur: u32, max: u32) -> Option<u8> {
    (max > min).then(|| ((cur.clamp(min, max) - min) as f64 * 100.0 / (max - min) as f64).round() as u8)
}

/// Percent -> the raw value for `min..=max`.
pub fn raw(min: u32, max: u32, pct: u8) -> u32 {
    min + ((max.saturating_sub(min)) as f64 * f64::from(pct.min(100)) / 100.0).round() as u32
}

#[cfg(windows)]
fn with_primary<T>(f: impl FnOnce(windows::Win32::Foundation::HANDLE) -> Option<T>) -> Option<T> {
    use windows::Win32::Devices::Display::{
        DestroyPhysicalMonitors, GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR,
        PHYSICAL_MONITOR,
    };
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    // SAFETY: (0,0) is always on the primary; the physical monitor array is ours and destroyed before returning.
    unsafe {
        let hmon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut n = 0u32;
        GetNumberOfPhysicalMonitorsFromHMONITOR(hmon, &mut n).ok()?;
        if n == 0 {
            return None;
        }
        let mut list = vec![PHYSICAL_MONITOR::default(); n as usize];
        GetPhysicalMonitorsFromHMONITOR(hmon, &mut list).ok()?;
        let out = f(list[0].hPhysicalMonitor);
        let _ = DestroyPhysicalMonitors(&list);
        out
    }
}

/// 0-100, None = not controllable.
#[cfg(windows)]
pub fn read() -> Option<u8> {
    use windows::Win32::Devices::Display::GetMonitorBrightness;
    with_primary(|h| {
        let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
        // SAFETY: a physical monitor handle valid inside `with_primary`; out-params are ours.
        (unsafe { GetMonitorBrightness(h, &mut min, &mut cur, &mut max) } != 0).then_some(())?;
        percent(min, cur, max)
    })
}

/// True = the monitor took it.
#[cfg(windows)]
pub fn set(pct: u8) -> bool {
    use windows::Win32::Devices::Display::{GetMonitorBrightness, SetMonitorBrightness};
    with_primary(|h| {
        let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
        // SAFETY: as in `read`.
        unsafe {
            (GetMonitorBrightness(h, &mut min, &mut cur, &mut max) != 0).then_some(())?;
            (SetMonitorBrightness(h, raw(min, max, pct)) != 0).then_some(())
        }
    })
    .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ddc_ranges_map_to_percent_and_back() {
        assert_eq!(percent(0, 50, 100), Some(50));
        assert_eq!(percent(10, 10, 10), None, "a fake range is not controllable");
        assert_eq!(percent(0, 300, 255), Some(100));
        assert_eq!(raw(0, 255, 50), 128);
        assert_eq!(raw(20, 120, 200), 120, "over 100 % is 100 %");
    }
}
