// Peeka — original implementation (MIT).
//! Clipboard pictures as plain bytes: Windows `CF_DIB` in and out, PNG in and out, a box-filtered thumbnail and a
//! duplicate fingerprint. No Win32 here, so it builds and is tested on every platform.

use sha2::{Digest, Sha256};

/// Top-down RGBA, 4 bytes a pixel, `rgba.len() == width * height * 4`.
#[derive(Debug, Clone, PartialEq)]
pub struct Picture {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Memory guard: bigger clipboard images are refused rather than allocated.
const MAX_PIXELS: u64 = 60_000_000;
const INFO_HEADER: usize = 40;
const BI_RGB: u32 = 0;
const BI_BITFIELDS: u32 = 3;

fn le_u16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn le_u32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// `CF_DIB` (info header, optional masks, pixels; no file header) -> picture. 24- or 32-bit only.
pub fn from_dib(bytes: &[u8]) -> Option<Picture> {
    let header = le_u32(bytes, 0)? as usize;
    let width = le_u32(bytes, 4)? as i32;
    let height = le_u32(bytes, 8)? as i32;
    let bits = le_u16(bytes, 14)?;
    let compression = le_u32(bytes, 16)?;
    if header < INFO_HEADER || width <= 0 || height == 0 || !(bits == 24 || bits == 32) {
        return None;
    }
    let masks = match compression {
        BI_RGB => 0,
        BI_BITFIELDS if bits == 32 => {
            if header == INFO_HEADER {
                12
            } else {
                0
            }
        }
        _ => return None,
    };
    let (w, h) = (width as u64, height.unsigned_abs() as u64);
    if w * h > MAX_PIXELS {
        return None;
    }
    let stride = (w * bits as u64).div_ceil(32) * 4;
    let start = header.checked_add(masks)?;
    let end = start.checked_add(usize::try_from(stride * h).ok()?)?;
    let pixels = bytes.get(start..end)?;

    let (w, h, stride, step) = (w as usize, h as usize, stride as usize, bits as usize / 8);
    let mut rgba = Vec::with_capacity(w * h * 4);
    for row in 0..h {
        // Positive height = bottom-up storage.
        let src = if height > 0 { h - 1 - row } else { row };
        let line = pixels.get(src * stride..src * stride + w * step)?;
        for px in line.chunks_exact(step) {
            let alpha = if step == 4 { px[3] } else { 255 };
            rgba.extend_from_slice(&[px[2], px[1], px[0], alpha]);
        }
    }
    // Many apps leave the fourth byte as unused padding: all zero means "opaque", not "invisible".
    if step == 4 && rgba.chunks_exact(4).all(|px| px[3] == 0) {
        rgba.chunks_exact_mut(4).for_each(|px| px[3] = 255);
    }
    Some(Picture { width: w as u32, height: h as u32, rgba })
}

/// Picture -> 40-byte info header + 32-bit uncompressed bottom-up BGRA rows (what `from_dib` reads back).
pub fn to_dib(p: &Picture) -> Vec<u8> {
    let (w, h) = (p.width as usize, p.height as usize);
    let size = w * h * 4;
    let mut out = Vec::with_capacity(INFO_HEADER + size);
    out.extend_from_slice(&(INFO_HEADER as u32).to_le_bytes());
    out.extend_from_slice(&(p.width as i32).to_le_bytes());
    out.extend_from_slice(&(p.height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&BI_RGB.to_le_bytes());
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.resize(INFO_HEADER, 0); // resolution and palette fields
    for row in (0..h).rev() {
        for x in 0..w {
            let at = (row * w + x) * 4;
            let px = p.rgba.get(at..at + 4).unwrap_or(&[0; 4]);
            out.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
        }
    }
    out
}

/// 8-bit PNG, fast compression; RGB when every pixel is opaque, else RGBA. The error text is for diagnosis only.
pub fn encode_png(p: &Picture) -> Result<Vec<u8>, String> {
    let expected = p.width as usize * p.height as usize * 4;
    if p.rgba.len() != expected {
        return Err(format!("rgba is {} bytes, expected {expected}", p.rgba.len()));
    }
    let opaque = p.rgba.chunks_exact(4).all(|px| px[3] == 255);
    let rgb: Vec<u8>;
    let (data, color) = if opaque {
        rgb = p.rgba.chunks_exact(4).flat_map(|px| [px[0], px[1], px[2]]).collect();
        (rgb.as_slice(), png::ColorType::Rgb)
    } else {
        (p.rgba.as_slice(), png::ColorType::Rgba)
    };
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, p.width, p.height);
    enc.set_color(color);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut writer = enc.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(data).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

/// Any PNG -> RGBA (palettes and small depths expanded, 16-bit cut to 8). Broken or oversized input = `None`.
pub fn decode_png(bytes: &[u8]) -> Option<Picture> {
    // Default 64 MiB would refuse big screenshots the listener itself accepted; this matches MAX_PIXELS.
    let limits = png::Limits { bytes: (MAX_PIXELS as usize) * 4 + (16 << 20) };
    let mut dec = png::Decoder::new_with_limits(bytes, limits);
    dec.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = dec.read_info().ok()?;
    // The frame buffer is ours, not the decoder's: check the claimed size before allocating it.
    let claimed = reader.info();
    if (claimed.width as u64) * (claimed.height as u64) > MAX_PIXELS {
        return None;
    }
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.bit_depth != png::BitDepth::Eight || (info.width as u64) * (info.height as u64) > MAX_PIXELS {
        return None;
    }
    let data = buf.get(..info.buffer_size())?;
    let rgba: Vec<u8> = match info.color_type {
        png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::GrayscaleAlpha => data.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Rgb => data.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Indexed => return None,
    };
    (rgba.len() == info.width as usize * info.height as usize * 4).then_some(Picture {
        width: info.width,
        height: info.height,
        rgba,
    })
}

/// (width, height) from the IHDR chunk alone (first 24 bytes), no decode.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.get(..8)? != SIGNATURE || bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    let be = |at: usize| Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?));
    Some((be(16)?, be(20)?))
}

/// Shrinks so the longer side fits `max_side` (never enlarges), averaging each output pixel's source box.
pub fn thumbnail(p: &Picture, max_side: u32) -> Picture {
    let (w, h) = (p.width as u64, p.height as u64);
    let longest = w.max(h);
    if longest <= max_side as u64 || p.rgba.len() as u64 != w * h * 4 {
        return p.clone();
    }
    let scale = max_side as f64 / longest as f64;
    let nw = ((w as f64 * scale).round() as u64).max(1);
    let nh = ((h as f64 * scale).round() as u64).max(1);
    // Source span of output index i along an axis of `src` pixels mapped onto `dst`: never empty.
    let span = |i: u64, src: u64, dst: u64| {
        let a = i * src / dst;
        let b = ((i + 1) * src / dst).clamp(a + 1, src);
        (a as usize, b as usize)
    };
    let mut rgba = Vec::with_capacity((nw * nh * 4) as usize);
    for y in 0..nh {
        let (y0, y1) = span(y, h, nh);
        for x in 0..nw {
            let (x0, x1) = span(x, w, nw);
            let mut sum = [0u64; 4];
            for sy in y0..y1 {
                let row = sy * w as usize;
                for sx in x0..x1 {
                    let at = (row + sx) * 4;
                    for (c, total) in sum.iter_mut().enumerate() {
                        *total += p.rgba[at + c] as u64;
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u64;
            rgba.extend(sum.iter().map(|&t| (t / n) as u8));
        }
    }
    Picture { width: nw as u32, height: nh as u32, rgba }
}

/// `clip_preview`: the PNG itself when it already fits `max_side`, else a shrunk copy (aspect kept, never enlarged).
/// `None` = not a PNG Notch can decode.
pub fn preview_png(bytes: &[u8], max_side: u32) -> Option<Vec<u8>> {
    let (w, h) = png_size(bytes)?;
    if w.max(h) <= max_side {
        return Some(bytes.to_vec());
    }
    encode_png(&thumbnail(&decode_png(bytes)?, max_side)).ok()
}

/// Every 29th pixel goes into the digest: ~1 MB of an 8 MP image, a few ms; odd so samples drift across columns.
const SAMPLE_STEP: usize = 29;

/// Same picture -> same value on any machine. SHA-256 of the size and a fixed pixel sample, first 8 bytes LE.
pub fn fingerprint(p: &Picture) -> u64 {
    let mut hash = Sha256::new();
    hash.update(p.width.to_le_bytes());
    hash.update(p.height.to_le_bytes());
    let sample: Vec<u8> = p.rgba.chunks_exact(4).step_by(SAMPLE_STEP).flatten().copied().collect();
    hash.update(&sample);
    let digest = hash.finalize();
    let mut first = [0u8; 8];
    first.copy_from_slice(&digest[..8]);
    u64::from_le_bytes(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A DIB header for the tests: 40 bytes, given size, depth and compression.
    fn header(width: i32, height: i32, bits: u16, compression: u32) -> Vec<u8> {
        let mut h = Vec::new();
        h.extend_from_slice(&40u32.to_le_bytes());
        h.extend_from_slice(&width.to_le_bytes());
        h.extend_from_slice(&height.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes());
        h.extend_from_slice(&bits.to_le_bytes());
        h.extend_from_slice(&compression.to_le_bytes());
        h.resize(40, 0);
        h
    }

    fn solid(width: u32, height: u32, px: [u8; 4]) -> Picture {
        Picture { width, height, rgba: px.repeat((width * height) as usize) }
    }

    /// Fixed, hand-rolled pseudo-random pixels (no RNG crate needed).
    fn pattern(width: u32, height: u32, alpha: u8) -> Picture {
        let mut seed: u32 = 0x5EED_1234;
        let mut rgba = Vec::new();
        for _ in 0..width * height {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            let [a, b, c, _] = seed.to_le_bytes();
            rgba.extend_from_slice(&[a, b, c, alpha]);
        }
        Picture { width, height, rgba }
    }

    #[test]
    fn a_preview_shrinks_big_pictures_to_the_cap_and_leaves_small_ones_alone() {
        let big = encode_png(&solid(2048, 1024, [10, 20, 30, 255])).unwrap();
        let small = encode_png(&solid(300, 200, [1, 2, 3, 255])).unwrap();
        assert_eq!(png_size(&preview_png(&big, 1024).unwrap()), Some((1024, 512)));
        assert_eq!(preview_png(&small, 1024).unwrap(), small, "unchanged bytes");
        assert_eq!(preview_png(b"not a png", 1024), None);
    }

    #[test]
    fn a_24_bit_bottom_up_row_skips_its_padding() {
        let mut dib = header(3, 1, 24, 0);
        // BGR: yellow, cyan, magenta, then 3 padding bytes (9 -> 12).
        dib.extend_from_slice(&[0, 255, 255, 255, 255, 0, 255, 0, 255, 0xEE, 0xEE, 0xEE]);
        let p = from_dib(&dib).unwrap();
        assert_eq!((p.width, p.height), (3, 1));
        assert_eq!(p.rgba, vec![255, 255, 0, 255, 0, 255, 255, 255, 255, 0, 255, 255]);
    }

    #[test]
    fn top_down_and_bottom_up_32_bit_give_the_same_picture() {
        // Rows top to bottom, BGRA, alpha 200.
        let rows: [[u8; 8]; 3] =
            [[1, 2, 3, 200, 4, 5, 6, 200], [7, 8, 9, 200, 10, 11, 12, 200], [13, 14, 15, 200, 16, 17, 18, 200]];
        let mut down = header(2, -3, 32, 0);
        rows.iter().for_each(|r| down.extend_from_slice(r));
        let mut up = header(2, 3, 32, 0);
        rows.iter().rev().for_each(|r| up.extend_from_slice(r));
        let a = from_dib(&down).unwrap();
        assert_eq!(a, from_dib(&up).unwrap());
        assert_eq!(&a.rgba[..4], &[3, 2, 1, 200]);
    }

    #[test]
    fn all_zero_fourth_bytes_mean_opaque() {
        let mut dib = header(2, 1, 32, 0);
        dib.extend_from_slice(&[10, 20, 30, 0, 40, 50, 60, 0]);
        assert!(from_dib(&dib).unwrap().rgba.chunks_exact(4).all(|px| px[3] == 255));
    }

    #[test]
    fn one_real_alpha_keeps_every_alpha_as_is() {
        let mut dib = header(3, 1, 32, 0);
        dib.extend_from_slice(&[1, 1, 1, 0, 2, 2, 2, 90, 3, 3, 3, 0]);
        let alphas: Vec<u8> = from_dib(&dib).unwrap().rgba.chunks_exact(4).map(|px| px[3]).collect();
        assert_eq!(alphas, vec![0, 90, 0]);
    }

    #[test]
    fn bitfields_masks_after_a_40_byte_header_are_skipped() {
        let mut dib = header(1, 1, 32, BI_BITFIELDS);
        dib.extend_from_slice(&[0xFF; 12]); // masks, not interpreted
        dib.extend_from_slice(&[9, 8, 7, 100]);
        assert_eq!(from_dib(&dib).unwrap().rgba, vec![7, 8, 9, 100]);
    }

    #[test]
    fn unsupported_depth_compression_or_header_is_refused() {
        let mut d16 = header(1, 1, 16, 0);
        d16.extend_from_slice(&[0; 4]);
        assert_eq!(from_dib(&d16), None);
        let mut rle = header(1, 1, 24, 1);
        rle.extend_from_slice(&[0; 4]);
        assert_eq!(from_dib(&rle), None);
        let mut short = header(1, 1, 24, 0);
        short[..4].copy_from_slice(&20u32.to_le_bytes());
        short.extend_from_slice(&[0; 4]);
        assert_eq!(from_dib(&short), None);
    }

    #[test]
    fn a_huge_claimed_size_with_a_short_body_is_refused_without_allocating() {
        let mut dib = header(10_000, 7_000, 32, 0);
        dib.extend_from_slice(&[0; 64]);
        assert_eq!(from_dib(&dib), None);
    }

    #[test]
    fn one_missing_pixel_byte_is_refused() {
        let mut dib = header(2, 2, 24, 0); // stride 8, 16 pixel bytes
        dib.extend_from_slice(&[0; 15]);
        assert_eq!(from_dib(&dib), None);
        assert_eq!(from_dib(&[]), None);
    }

    #[test]
    fn dib_round_trip() {
        let p = pattern(5, 4, 200);
        assert_eq!(from_dib(&to_dib(&p)), Some(p));
    }

    #[test]
    fn opaque_png_is_rgb_and_round_trips() {
        let p = pattern(4, 4, 255);
        let png = encode_png(&p).unwrap();
        assert_eq!(png[25], 2); // IHDR colour type: truecolour
        assert_eq!(decode_png(&png), Some(p));
    }

    #[test]
    fn translucent_png_is_rgba_and_round_trips() {
        let mut p = pattern(4, 4, 255);
        p.rgba[3] = 17;
        let png = encode_png(&p).unwrap();
        assert_eq!(png[25], 6); // truecolour with alpha
        assert_eq!(decode_png(&png), Some(p));
        assert_eq!(decode_png(&png[..png.len() / 2]), None);
    }

    #[test]
    fn a_png_header_claiming_a_huge_frame_is_refused_before_allocating() {
        let mut out = Vec::new();
        drop(png::Encoder::new(&mut out, 100_000, 100_000).write_header().unwrap());
        assert_eq!(decode_png(&out), None);
    }

    #[test]
    fn png_size_reads_the_header_only() {
        let png = encode_png(&solid(7, 9, [1, 2, 3, 255])).unwrap();
        assert_eq!(png_size(&png), Some((7, 9)));
        assert_eq!(png_size(&[]), None);
        assert_eq!(png_size(&png[..20]), None);
        let mut unsigned = png.clone();
        unsigned[0] = 0;
        assert_eq!(png_size(&unsigned), None);
    }

    #[test]
    fn thumbnail_sizes() {
        let t = thumbnail(&solid(500, 100, [0; 4]), 50);
        assert_eq!((t.width, t.height, t.rgba.len()), (50, 10, 50 * 10 * 4));
        let small = solid(30, 20, [5; 4]);
        assert_eq!(thumbnail(&small, 50), small);
        let thin = thumbnail(&solid(1, 400, [0; 4]), 40);
        assert_eq!((thin.width, thin.height), (1, 40));
    }

    #[test]
    fn a_solid_picture_shrinks_to_the_same_colour() {
        let t = thumbnail(&solid(64, 64, [200, 100, 50, 255]), 20);
        assert!(t.rgba.chunks_exact(4).all(|px| px == [200, 100, 50, 255]));
    }

    #[test]
    fn fingerprint_is_stable_and_sees_changes_and_shape() {
        let p = pattern(6, 4, 255);
        assert_eq!(fingerprint(&p), fingerprint(&p.clone()));
        let mut changed = p.clone();
        changed.rgba[0] ^= 1; // pixel 0 is always sampled
        assert_ne!(fingerprint(&p), fingerprint(&changed));
        let turned = Picture { width: 4, height: 6, rgba: p.rgba.clone() };
        assert_ne!(fingerprint(&p), fingerprint(&turned));
    }
}
