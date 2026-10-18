//! Window previews on hover (Wave 5): a `PrintWindow(PW_RENDERFULLCONTENT)` snapshot,
//! scaled down, as a PNG data URL. The rules here: one capture per window per `MIN_GAP_MS` (hover in and out
//! repeats the last frame), a minimised window only ever gets its last frame, the cache is bounded.

use std::collections::HashMap;

/// The fewest ms between two captures of the same window.
pub const MIN_GAP_MS: u64 = 750;
/// Frames kept (one per window); the oldest goes first.
pub const MAX_FRAMES: usize = 24;
/// The preview's largest edge in physical px (the card shows it at ~220 CSS px).
pub const MAX_EDGE: u32 = 440;

#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
    /// Send this frame again.
    Cached(String),
    /// Take a new one.
    Capture,
    /// Minimised and never seen: nothing to show.
    Nothing,
}

#[derive(Default)]
pub struct Previews {
    frames: HashMap<isize, (String, u64)>,
}

impl Previews {
    pub fn plan(&self, hwnd: isize, minimised: bool, now: u64) -> Plan {
        match self.frames.get(&hwnd) {
            Some((png, _)) if minimised => Plan::Cached(png.clone()),
            Some((png, at)) if now.saturating_sub(*at) < MIN_GAP_MS => Plan::Cached(png.clone()),
            None if minimised => Plan::Nothing,
            _ => Plan::Capture,
        }
    }

    pub fn store(&mut self, hwnd: isize, png: String, now: u64) {
        self.frames.insert(hwnd, (png, now));
        while self.frames.len() > MAX_FRAMES {
            let Some(old) = self.frames.iter().min_by_key(|(_, (_, at))| *at).map(|(h, _)| *h) else { break };
            self.frames.remove(&old);
        }
    }

    /// Windows that closed lose their frame.
    pub fn retain(&mut self, alive: impl Fn(isize) -> bool) {
        self.frames.retain(|h, _| alive(*h));
    }
}

/// The size a `w`x`h` capture is scaled to (aspect kept, never up).
pub fn fit(w: u32, h: u32) -> (u32, u32) {
    let edge = w.max(h);
    if edge <= MAX_EDGE {
        return (w, h);
    }
    let s = f64::from(MAX_EDGE) / f64::from(edge);
    (((f64::from(w) * s).round() as u32).max(1), ((f64::from(h) * s).round() as u32).max(1))
}

/// Box-filter downscale of top-down BGRA to `fit(w, h)`; alpha forced opaque (`PrintWindow` leaves it 0).
pub fn downscale(bgra: &[u8], w: u32, h: u32) -> Option<(Vec<u8>, u32, u32)> {
    if w == 0 || h == 0 || bgra.len() != (w as usize) * (h as usize) * 4 {
        return None;
    }
    let (tw, th) = fit(w, h);
    let span = |t: u32, src: u32, dst: u32| {
        let a = t * src / dst;
        (a, ((t + 1) * src / dst).max(a + 1))
    };
    let mut out = Vec::with_capacity((tw * th * 4) as usize);
    for ty in 0..th {
        let (y0, y1) = span(ty, h, th);
        for tx in 0..tw {
            let (x0, x1) = span(tx, w, tw);
            let mut sum = [0u32; 3];
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = ((y * w + x) * 4) as usize;
                    for (c, s) in sum.iter_mut().enumerate() {
                        *s += u32::from(bgra[i + c]);
                    }
                }
            }
            let n = (y1 - y0) * (x1 - x0);
            out.extend([(sum[0] / n) as u8, (sum[1] / n) as u8, (sum[2] / n) as u8, 255]);
        }
    }
    Some((out, tw, th))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limited_per_window_and_minimised_gets_the_last_frame() {
        let mut p = Previews::default();
        assert_eq!(p.plan(1, true, 0), Plan::Nothing);
        assert_eq!(p.plan(1, false, 0), Plan::Capture);
        p.store(1, "a".into(), 1_000);
        assert_eq!(p.plan(1, false, 1_500), Plan::Cached("a".into()), "hover in-out-in");
        assert_eq!(p.plan(1, false, 1_000 + MIN_GAP_MS), Plan::Capture);
        assert_eq!(p.plan(1, true, 99_000), Plan::Cached("a".into()), "minimised: the cache, however old");
        assert_eq!(p.plan(2, false, 1_500), Plan::Capture, "per window");
        for h in 10..10 + MAX_FRAMES as isize {
            p.store(h, "x".into(), 2_000 + h as u64);
        }
        assert_eq!(p.plan(1, true, 0), Plan::Nothing, "the oldest went");
        p.retain(|h| h != 10);
        assert_eq!(p.plan(10, true, 0), Plan::Nothing);
    }

    #[test]
    fn scaled_down_with_aspect_and_opaque() {
        assert_eq!(fit(1920, 1080), (440, 248));
        assert_eq!(fit(300, 200), (300, 200));
        let (px, w, h) = downscale(&[10, 20, 30, 0, 30, 40, 50, 0], 2, 1).unwrap();
        assert_eq!((px, w, h), (vec![10, 20, 30, 255, 30, 40, 50, 255], 2, 1));
        let big = vec![100u8; 880 * 2 * 4];
        let (px, w, h) = downscale(&big, 880, 2).unwrap();
        assert_eq!((w, h, px.len()), (440, 1, 440 * 4));
        assert_eq!(&px[..4], &[100, 100, 100, 255]);
        assert!(downscale(&[0; 3], 1, 1).is_none());
    }
}
