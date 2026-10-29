//! The screen tint sample behind `notch_core::tint`: GDI `StretchBlt` (HALFTONE, which averages) of the whole monitor
//! under the strip into one 16x9 DIB. Not Windows.Graphics.Capture: an unpackaged app cannot drop its yellow border,
//! and it would mark Peeka itself as "capturing the screen" in the privacy keys `privacy::SCREEN` watches.
//! No CAPTUREBLT: layered windows are left out, and the cursor does not flicker.
//! Privacy: the 576 bytes are returned in memory only; nothing here logs or stores them.

/// The area shrunk to `tint::COLS` x `tint::ROWS` BGRA bytes; None = GDI failed or an empty area.
#[cfg(windows)]
pub fn sample(area: notch_core::model::Rect) -> Option<Vec<u8>> {
    use notch_core::tint::{BYTES, COLS, ROWS};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, ReleaseDC, SelectObject,
        SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE,
        HGDIOBJ, SRCCOPY,
    };
    if area.width() <= 0 || area.height() <= 0 {
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
                let ok = StretchBlt(
                    mem, 0, 0, COLS as i32, ROWS as i32, Some(screen), area.left, area.top, area.width(), area.height(), SRCCOPY,
                )
                .as_bool();
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

#[cfg(all(test, windows))]
mod tests {
    /// Prints only the elapsed time of one sample of the primary monitor (no colours): `cargo test -p notch-win --lib -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn one_sample_costs() {
        let m = crate::monitors::list().into_iter().next().expect("a monitor");
        let t = std::time::Instant::now();
        let ok = super::sample(notch_core::tint::region(&m)).is_some();
        println!("one sample: {:.2} ms, ok {ok}", t.elapsed().as_secs_f64() * 1000.0);
    }
}
