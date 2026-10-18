//! App icons as PNG data URLs (`IShellItemImageFactory::GetImage`, icon only, 32 px). The page paints only the
//! alpha channel, so colour fidelity does not matter; the alpha does. Cached by the caller.

/// Icon edge in px (the strip shows them at 16-20 CSS px; 32 keeps 150-200 % sharp).
pub const SIZE: u32 = 32;

/// Top-down BGRA (what `GetDIBits` gives) -> a `data:image/png;base64,...` URL. A bitmap with no alpha at all
/// (old 24-bit icons) counts as fully opaque rather than invisible.
pub fn bgra_to_data_url(bgra: &[u8], width: u32, height: u32) -> Option<String> {
    use base64::Engine;
    let png = bgra_to_png(bgra, width, height)?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

/// Top-down BGRA -> PNG bytes (same alpha rule as `bgra_to_data_url`).
pub fn bgra_to_png(bgra: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if bgra.len() != (width * height * 4) as usize || width == 0 {
        return None;
    }
    let no_alpha = bgra.chunks_exact(4).all(|p| p[3] == 0);
    let rgba: Vec<u8> =
        bgra.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], if no_alpha { 255 } else { p[3] }]).collect();
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().ok()?;
        w.write_image_data(&rgba).ok()?;
    }
    Some(out)
}

/// The icon of a shell parsing name (an exe or .lnk path, `shell:AppsFolder\<AUMID>`); None = the shell has none.
/// Needs COM on the calling thread (either apartment).
#[cfg(windows)]
pub fn icon(parsing_name: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE as WSIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    let name = crate::to_wide(parsing_name);
    // SAFETY: a NUL-terminated wide string that outlives the call; the factory is released on drop.
    let factory: IShellItemImageFactory = unsafe { SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None) }.ok()?;
    let size = WSIZE { cx: SIZE as i32, cy: SIZE as i32 };
    // SAFETY: a valid factory; the returned HBITMAP is ours and deleted below.
    let hbmp = unsafe { factory.GetImage(size, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK) }.ok()?;
    let mut bm = BITMAP::default();
    // SAFETY: `bm` is a BITMAP-sized out-param.
    let got = unsafe {
        GetObjectW(HGDIOBJ(hbmp.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut BITMAP as *mut _))
    };
    let (w, h) = (bm.bmWidth.max(0) as u32, bm.bmHeight.unsigned_abs());
    let mut buf = vec![0u8; (w * h * 4) as usize];
    let ok = got != 0 && w > 0 && h > 0 && {
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        // SAFETY: a screen DC released right after; `buf` holds w*h 32-bit pixels as the header says.
        unsafe {
            let dc = GetDC(None);
            let lines = GetDIBits(dc, hbmp, 0, h, Some(buf.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            lines == h as i32
        }
    };
    // SAFETY: the bitmap GetImage handed us; never used after this.
    let _ = unsafe { DeleteObject(HGDIOBJ(hbmp.0)) };
    ok.then(|| bgra_to_data_url(&buf, w, h)).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_png_data_url_with_alpha_kept_or_made_opaque() {
        let url = bgra_to_data_url(&[1, 2, 3, 128, 0, 0, 0, 0], 2, 1).unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBOR"), "PNG signature");
        assert!(bgra_to_data_url(&[0; 8], 2, 1).is_some(), "no alpha at all: opaque, still an icon");
        assert_eq!(bgra_to_data_url(&[0; 7], 2, 1), None);
    }
}
