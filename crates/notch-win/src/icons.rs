//! App icons as PNG data URLs (`IShellItemImageFactory::GetImage`, icon only, 48 px, trimmed to what is drawn). The
//! page paints the alpha as a mask, or the PNG itself in colour; `Icon` says which of the two would look wrong.
//! Cached by the caller.

/// Icon edge in px (the strip shows them at 16-32 CSS px; 48 keeps 150-200 % sharp).
pub const SIZE: u32 = 48;

/// An extracted icon and how it reads.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Icon {
    pub url: String,
    /// Nearly black: invisible in colour on the dark strip, so only its silhouette (the mask) is shown.
    pub dark: bool,
    /// No silhouette: the alpha is a filled square or circle (a logo drawn in colour), so the mask is a blank shape
    /// and only the colour icon is shown.
    pub blob: bool,
}

/// Alpha above this counts as drawn (soft shadows and anti-aliasing fringes do not).
const DRAWN: u8 = 128;

/// Top-down BGRA -> a trimmed `Icon`. None = nothing visible, or a dark blob (no form either way: the page's glyph).
pub fn analyze(bgra: &[u8], width: u32, height: u32) -> Option<Icon> {
    if bgra.len() != (width * height * 4) as usize || width == 0 {
        return None;
    }
    let no_alpha = bgra.chunks_exact(4).all(|p| p[3] == 0);
    let alpha = |i: usize| if no_alpha { 255 } else { bgra[i * 4 + 3] };
    let (mut x0, mut y0, mut x1, mut y1) = (width, height, 0, 0);
    let (mut drawn, mut light) = (0u32, 0u32);
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) as usize;
            if alpha(i) < DRAWN {
                continue;
            }
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1));
            drawn += 1;
            let p = &bgra[i * 4..i * 4 + 3];
            let lum = 0.0722 * f32::from(p[0]) + 0.7152 * f32::from(p[1]) + 0.2126 * f32::from(p[2]);
            light += u32::from(lum > 64.0);
        }
    }
    if drawn == 0 || (no_alpha && bgra.iter().all(|&b| b == 0)) {
        return None;
    }
    // shortcut: thresholds calibrated on this PC's tray and taskbar apps (`calibrate`); retune if an owner icon misreads.
    let dark = light * 10 < drawn;
    // A blank shape (square, rounded square, circle) fills the ellipse inside its box; a real silhouette (notepad
    // 83 %, OneDrive's cloud 91 %, Everything 53 %) leaves gaps in it.
    let (cx, cy) = ((x0 + x1) as f32 / 2.0, (y0 + y1) as f32 / 2.0);
    let (rx, ry) = ((x1 - x0) as f32 / 2.0, (y1 - y0) as f32 / 2.0);
    let (mut inside, mut filled) = (0u32, 0u32);
    for y in y0..y1 {
        for x in x0..x1 {
            if ((x as f32 + 0.5 - cx) / rx).powi(2) + ((y as f32 + 0.5 - cy) / ry).powi(2) <= 1.0 {
                inside += 1;
                filled += u32::from(alpha((y * width + x) as usize) >= DRAWN);
            }
        }
    }
    let blob = filled * 100 >= inside * 95;
    if dark && blob {
        return None;
    }
    // Trim to a square around what is drawn, so every icon fills its box the same.
    let side = (x1 - x0).max(y1 - y0);
    let (ox, oy) = ((i64::from(x0 + x1) - i64::from(side)) / 2, (i64::from(y0 + y1) - i64::from(side)) / 2);
    let mut out = vec![0u8; (side * side * 4) as usize];
    for y in 0..side {
        for x in 0..side {
            let (sx, sy) = (ox + i64::from(x), oy + i64::from(y));
            if sx < 0 || sy < 0 || sx >= i64::from(width) || sy >= i64::from(height) {
                continue;
            }
            let (s, d) = (((sy as u32 * width + sx as u32) * 4) as usize, ((y * side + x) * 4) as usize);
            out[d..d + 4].copy_from_slice(&bgra[s..s + 4]);
            if no_alpha {
                out[d + 3] = 255;
            }
        }
    }
    Some(Icon { url: bgra_to_data_url(&out, side, side)?, dark, blob })
}

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
pub fn icon(parsing_name: &str) -> Option<Icon> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE as WSIZE;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY, SIIGBF_SCALEUP,
    };

    let name = crate::to_wide(parsing_name);
    // SAFETY: a NUL-terminated wide string that outlives the call; the factory is released on drop.
    let factory: IShellItemImageFactory = unsafe { SHCreateItemFromParsingName(PCWSTR(name.as_ptr()), None) }.ok()?;
    let size = WSIZE { cx: SIZE as i32, cy: SIZE as i32 };
    // Exactly SIZE: a 16 px-only icon is scaled up, not left small in a corner; a 256 px one is scaled down.
    // SAFETY: a valid factory; the returned HBITMAP is ours and deleted below.
    let hbmp = unsafe { factory.GetImage(size, SIIGBF_ICONONLY | SIIGBF_SCALEUP) }.ok()?;
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
    ok.then(|| analyze(&buf, w, h)).flatten()
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

    /// A `w`x`h` canvas with a `fill`ed rectangle of `px` (BGRA) at (x, y).
    fn canvas(w: u32, h: u32, rect: (u32, u32, u32, u32), px: [u8; 4], hole: bool) -> Vec<u8> {
        let mut b = vec![0u8; (w * h * 4) as usize];
        for y in rect.1..rect.1 + rect.3 {
            for x in rect.0..rect.0 + rect.2 {
                // `hole`: a cross-hatch, so the shape has a real silhouette
                if hole && (x + y) % 2 == 0 {
                    continue;
                }
                let i = ((y * w + x) * 4) as usize;
                b[i..i + 4].copy_from_slice(&px);
            }
        }
        b
    }

    fn png_size(url: &str) -> (u32, u32) {
        use base64::Engine;
        let png = base64::engine::general_purpose::STANDARD.decode(url.split(',').nth(1).unwrap()).unwrap();
        let r = png::Decoder::new(std::io::Cursor::new(png)).read_info().unwrap();
        (r.info().width, r.info().height)
    }

    #[test]
    fn icons_are_trimmed_and_read_for_dark_and_blob() {
        let white = [255, 255, 255, 255];
        let i = analyze(&canvas(48, 48, (10, 20, 16, 8), white, true), 48, 48).unwrap();
        assert_eq!(png_size(&i.url), (16, 16), "a small drawing fills a square around it");
        assert!(!i.dark && !i.blob);
        let i = analyze(&canvas(48, 48, (4, 4, 40, 40), [200, 100, 50, 255], false), 48, 48).unwrap();
        assert!(i.blob && !i.dark, "a filled colour square: no silhouette");
        let mut ring = canvas(48, 48, (0, 0, 48, 48), [200, 100, 50, 255], false);
        for (i, p) in ring.chunks_exact_mut(4).enumerate() {
            let (x, y) = ((i % 48) as f32 - 23.5, (i / 48) as f32 - 23.5);
            if x * x + y * y > 24.0 * 24.0 {
                p[3] = 0; // a disc, like Discord's or Chrome's icon
            }
        }
        assert!(analyze(&ring, 48, 48).unwrap().blob, "a filled disc: no silhouette");
        let i = analyze(&canvas(48, 48, (4, 4, 40, 40), [20, 20, 20, 255], true), 48, 48).unwrap();
        assert!(i.dark && !i.blob, "a black glyph: shown as its silhouette");
        assert_eq!(analyze(&canvas(48, 48, (4, 4, 40, 40), [20, 20, 20, 255], false), 48, 48), None, "black square");
        assert_eq!(analyze(&[0; 48 * 48 * 4], 48, 48), None, "an empty bitmap is no icon, not a black block");
        assert_eq!(analyze(&canvas(4, 4, (0, 0, 4, 4), [255, 255, 255, 40], false), 4, 4), None, "only a faint shadow");
    }

    /// `cargo test -p notch-win --lib calibrate -- --ignored --nocapture`: how this PC's app icons read.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn calibrate() {
        crate::com();
        for exe in std::env::var("ICON_EXES").unwrap_or_default().split(';').filter(|s| !s.is_empty()) {
            let i = icon(exe);
            println!("{exe}: {:?}", i.map(|i| (i.dark, i.blob, png_size(&i.url))));
        }
    }
}
