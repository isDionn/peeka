//! What "Save diagnostics" reads from Windows (`notch_core::diagnostics`): the Windows build, the GPU adapters, a
//! window's rectangle and its applied region, the local time. Nothing here reads titles, text or other apps.

use notch_core::diagnostics::Box4;
use windows::Win32::Foundation::{HWND, RECT};

/// "24H2, build 26100.2314" from HKLM\...\CurrentVersion.
pub fn windows_build() -> String {
    use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
    let Some(k) = crate::privacy::reg::open(HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", false)
    else {
        return "(unknown)".into();
    };
    let s = |n| crate::privacy::reg::sz(&k, n).unwrap_or_else(|| "?".into());
    format!("{}, build {}.{}", s("DisplayVersion"), s("CurrentBuild"), crate::privacy::reg::dword(&k, "UBR").unwrap_or(0))
}

/// "name, driver a.b.c.d" per DXGI adapter (the driver version is the UMD version DXGI reports for IDXGIDevice).
pub fn gpus() -> Vec<String> {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1};
    // SAFETY: plain DXGI calls on interfaces we own; `Description` is a NUL-terminated UTF-16 buffer.
    unsafe {
        let Ok(f) = CreateDXGIFactory1::<IDXGIFactory1>() else { return vec!["(DXGI unavailable)".into()] };
        let mut out = vec![];
        for i in 0..8 {
            let Ok(a) = f.EnumAdapters1(i) else { break };
            let Ok(d) = a.GetDesc1() else { continue };
            let name = crate::wide_to_string(&d.Description);
            let drv = a.CheckInterfaceSupport(&IDXGIDevice::IID).map_or("?".into(), |v| {
                let v = v as u64;
                format!("{}.{}.{}.{}", v >> 48, (v >> 32) & 0xFFFF, (v >> 16) & 0xFFFF, v & 0xFFFF)
            });
            out.push(format!("{name}, driver {drv}"));
        }
        out.dedup(); // hybrid laptops list the same adapter once per output
        out
    }
}

/// GetWindowRect, screen px.
pub fn window_rect(hwnd: isize) -> Option<Box4> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut r = RECT::default();
    // SAFETY: an out-param we own; a stale handle just fails.
    unsafe { GetWindowRect(HWND(hwnd as _), &mut r) }.ok().map(|_| (r.left, r.top, r.right, r.bottom))
}

/// The rectangles of the region Windows applies to the window (window-relative); None = no region (whole window).
pub fn region(hwnd: isize) -> Option<Vec<Box4>> {
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, HGDIOBJ};
    // SAFETY: a region we create and delete; a stale window handle just reports ERROR.
    unsafe {
        let rgn = CreateRectRgn(0, 0, 0, 0);
        let out = (GetWindowRgn(HWND(hwnd as _), rgn).0 > 1).then(|| rgn_rects(rgn)); // > NULLREGION
        let _ = DeleteObject(HGDIOBJ(rgn.0));
        out
    }
}

/// A region's rectangles (GetRegionData).
fn rgn_rects(rgn: windows::Win32::Graphics::Gdi::HRGN) -> Vec<Box4> {
    use windows::Win32::Graphics::Gdi::{GetRegionData, RGNDATA, RGNDATAHEADER};
    // SAFETY: GetRegionData writes at most `size` bytes into a buffer of that size, aligned for RGNDATAHEADER (u32
    // storage): the header (`dwSize` bytes) followed by `nCount` RECTs, which we read only within that.
    unsafe {
        let size = GetRegionData(rgn, 0, None);
        let mut buf = vec![0u32; (size as usize).div_ceil(4)];
        if size == 0 || GetRegionData(rgn, size, Some(buf.as_mut_ptr() as *mut RGNDATA)) == 0 {
            return vec![];
        }
        let head = &*(buf.as_ptr() as *const RGNDATAHEADER);
        let rects = buf.as_ptr().cast::<u8>().add(head.dwSize as usize) as *const RECT;
        let n = (head.nCount as usize).min((size as usize - head.dwSize as usize) / std::mem::size_of::<RECT>());
        (0..n)
            .map(|i| {
                let r = &*rects.add(i);
                (r.left, r.top, r.right, r.bottom)
            })
            .collect()
    }
}

/// Local time as (file-name stamp "2026-10-26_14-05-09", readable "2026-10-26 14:05:09").
pub fn local_stamp() -> (String, String) {
    // SAFETY: no arguments; returns the struct by value.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let d = format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay);
    (format!("{d}_{:02}-{:02}-{:02}", t.wHour, t.wMinute, t.wSecond), format!("{d} {:02}:{:02}:{:02}", t.wHour, t.wMinute, t.wSecond))
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_this_pc_without_a_window() {
        let (b, g) = (super::windows_build(), super::gpus());
        println!("{b}\n{g:?}\n{:?}", super::local_stamp());
        assert!(b.contains("build") && !g.is_empty());
        assert_eq!((super::window_rect(0), super::region(0)), (None, None));
        println!("altgr: {:?}", notch_core::shortcuts::altgr_reason(notch_core::shortcuts::DIAGNOSTICS_KEYS, crate::keyboard::ctrl_alt_types));
    }

    #[test]
    fn reads_a_two_box_region() {
        use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, HGDIOBJ, RGN_OR};
        // SAFETY: regions we create and delete here.
        unsafe {
            let (a, b) = (CreateRectRgn(0, 0, 10, 10), CreateRectRgn(20, 0, 30, 10));
            CombineRgn(Some(a), Some(a), Some(b), RGN_OR);
            assert_eq!(super::rgn_rects(a), vec![(0, 0, 10, 10), (20, 0, 30, 10)]);
            let _ = (DeleteObject(HGDIOBJ(a.0)), DeleteObject(HGDIOBJ(b.0)));
        }
    }
}
