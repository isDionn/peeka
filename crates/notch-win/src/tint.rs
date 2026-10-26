//! The screen tint sample behind `notch_core::tint`: GDI `StretchBlt` (HALFTONE, which averages) of the two band halves
//! beside the island into one 16x2 DIB (8 columns each). Not Windows.Graphics.Capture: an unpackaged app cannot drop its yellow border,
//! and it would mark Peeka itself as "capturing the screen" in the privacy keys `privacy::SCREEN` watches.
//! No CAPTUREBLT: layered windows are left out, and the cursor does not flicker.
//! Privacy: the 128 bytes are returned in memory only; nothing here logs or stores them.

/// The band shrunk to `tint::COLS` x `tint::ROWS` BGRA bytes; None = GDI failed or an empty band.
#[cfg(windows)]
pub fn sample(band: [notch_core::model::Rect; 2]) -> Option<Vec<u8>> {
    use notch_core::tint::{BYTES, COLS, ROWS};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, ReleaseDC, SelectObject,
        SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE,
        HGDIOBJ, SRCCOPY,
    };
    if band.iter().any(|b| b.width() <= 0 || b.height() <= 0) {
        return None;
    }
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: COLS as i32,
            biHeight: -(ROWS as i32), // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    // SAFETY: every DC and bitmap made here is released below on every path; `bits` is the DIB's own memory, read only
    // while the bitmap lives and after GdiFlush.
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return None;
        }
        let mem = CreateCompatibleDC(Some(screen));
        let mut bits = std::ptr::null_mut();
        let out = match CreateDIBSection(Some(mem), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bmp) => {
                let old = SelectObject(mem, HGDIOBJ(bmp.0));
                SetStretchBltMode(mem, HALFTONE);
                let _ = SetBrushOrgEx(mem, 0, 0, None); // required after HALFTONE
                let half = (COLS / 2) as i32;
                let ok = band.iter().zip([0, half]).all(|(b, x)| {
                    StretchBlt(mem, x, 0, half, ROWS as i32, Some(screen), b.left, b.top, b.width(), b.height(), SRCCOPY)
                        .as_bool()
                });
                let _ = GdiFlush();
                let px = (ok && !bits.is_null()).then(|| std::slice::from_raw_parts(bits as *const u8, BYTES).to_vec());
                SelectObject(mem, old);
                let _ = DeleteObject(HGDIOBJ(bmp.0));
                px
            }
            _ => None,
        };
        if !mem.is_invalid() {
            let _ = DeleteDC(mem);
        }
        ReleaseDC(None, screen);
        out
    }
}
