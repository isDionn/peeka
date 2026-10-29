//! Screen tint for the strip/island glow (owner, 2026-10-26; whole screen 2026-10-30): every 2 s the monitor below each
//! strip is shrunk to 16x9 px and reduced to three colours (left, centre, right), vivid pixels weighing most so a dark
//! tab or title bar does not make the glow black. Privacy: the pixels stay in memory in the sampler
//! (`notch_win::tint`), are never written to disk, logs or diagnostics and never reach plugins; only the three hex
//! colours go to Peeka's own pages (`screen_tint`). No sample is even taken while `paused`.

use crate::model::{px, Monitor, Rect, STRIP_HEIGHT};
use crate::presence::Presence;
use serde::Serialize;

/// The shrunk screen: 16 columns, 9 rows, BGRA (what a 32-bit top-down DIB holds).
pub const COLS: usize = 16;
pub const ROWS: usize = 9;
pub const BYTES: usize = COLS * ROWS * 4;
/// The sampled area starts this far under the strip (clear of the strip's own bottom edge and glow), in CSS px.
pub const BAND_GAP: f64 = 8.0;
/// Weight floor so a group with no colourful pixel still has a plain average.
const EPS: f32 = 0.005;
/// A group whose most colourful pixel (saturation * value) stays under this has no colour of its own (dark UI, grey, white).
const DULL: f32 = 0.1;
/// A dull, dark group is lifted to at least this value (brightest channel / 255), so it never glows black.
const MIN_VALUE: f32 = 0.35;

/// The `screen_tint` payload. `colors` null = sampling is off (setting, demo), unavailable on that monitor, or the whole
/// screen is dull and dark; the page falls back to `--glow-color`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScreenTint {
    pub monitor: String,
    pub colors: Option<[String; 3]>,
}

/// The area to sample on `m`, in virtual-screen px: everything under the strip, kept inside the monitor (a tiny monitor
/// gets an empty area). The island's x range is no longer cut out: the island sits in the strip area, and its panels are
/// dark or grey, which the colour weighting ignores.
pub fn region(m: &Monitor) -> Rect {
    Rect { top: (m.rect.top + px(STRIP_HEIGHT, m.scale) + px(BAND_GAP, m.scale)).min(m.rect.bottom), ..m.rect }
}

/// Left / centre / right: the 16 columns split 5-6-5, as `#rrggbb`. Each group is a mean weighted by saturation * value,
/// so a small vivid area beats a large dark one. A group with no colour of its own gets its plain mean; if that is darker
/// than `MIN_VALUE` it is lifted to it. If all three are dull and dark: None (the page uses `--glow-color`). None also =
/// not a whole BGRA screen.
pub fn average(bgra: &[u8]) -> Option<[String; 3]> {
    if bgra.len() != BYTES {
        return None;
    }
    let part = |cols: std::ops::Range<usize>| {
        let (mut sum, mut plain, mut top, mut wsum, mut n) = ([0f32; 3], [0f32; 3], 0f32, 0f32, 0f32);
        for row in 0..ROWS {
            for col in cols.clone() {
                let p = &bgra[(row * COLS + col) * 4..][..4];
                let c = [f32::from(p[2]), f32::from(p[1]), f32::from(p[0])];
                let (hi, lo) = (c[0].max(c[1]).max(c[2]), c[0].min(c[1]).min(c[2]));
                let s = if hi > 0.0 { (hi - lo) / hi } else { 0.0 };
                let sv = s * hi / 255.0;
                let w = sv + EPS;
                top = top.max(sv);
                wsum += w;
                n += 1.0;
                for i in 0..3 {
                    sum[i] += c[i] * w;
                    plain[i] += c[i];
                }
            }
        }
        let dull = top < DULL;
        let mut rgb = if dull { plain.map(|x| x / n) } else { sum.map(|x| x / wsum) };
        let v = rgb[0].max(rgb[1]).max(rgb[2]) / 255.0;
        let dark = dull && v < MIN_VALUE;
        if dark {
            // every channel moves the same share of the way to 255: black turns grey, a dark tint keeps its hue
            let t = (MIN_VALUE - v) / (1.0 - v);
            rgb = rgb.map(|x| x + (255.0 - x) * t);
        }
        (dark, format!("#{:02x}{:02x}{:02x}", rgb[0].round() as u8, rgb[1].round() as u8, rgb[2].round() as u8))
    };
    let parts = [part(0..5), part(5..11), part(11..16)];
    if parts.iter().all(|p| p.0) {
        return None;
    }
    Some(parts.map(|p| p.1))
}

/// What pauses sampling: nothing new is sent, the page keeps the last colours.
#[derive(Clone, Copy, Debug, Default)]
pub struct Pause {
    /// Peeka's lock (Windows lock included, `plugins::locked`).
    pub locked: bool,
    pub presence: Presence,
    /// Screen sharing / recording (`PrivacyState::screen`).
    pub sharing: bool,
    /// A clipboard view is on screen (`CaptureGuard::is_open`: the island is excluded from capture meanwhile).
    pub clip_open: bool,
    /// A fullscreen app covers this monitor.
    pub covered: bool,
}

pub fn paused(p: &Pause) -> bool {
    p.locked || p.sharing || p.clip_open || p.covered || !matches!(p.presence, Presence::Normal | Presence::QuietTime)
}

/// One monitor, one round. None = send nothing (paused, or null already sent); `sample` runs only when allowed.
#[derive(Debug, Default)]
pub struct Tint {
    null_sent: bool,
}

impl Tint {
    pub fn step(
        &mut self,
        monitor: &str,
        on: bool,
        pause: &Pause,
        sample: impl FnOnce() -> Option<Vec<u8>>,
    ) -> Option<ScreenTint> {
        let colors = if !on {
            None
        } else if paused(pause) {
            return None;
        } else {
            sample().and_then(|px| average(&px))
        };
        let null = colors.is_none();
        if null && std::mem::replace(&mut self.null_sent, true) {
            return None;
        }
        self.null_sent = null;
        Some(ScreenTint { monitor: monitor.to_string(), colors })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen_of(f: impl Fn(usize) -> [u8; 3]) -> Vec<u8> {
        (0..COLS * ROWS).flat_map(|i| {
            let [r, g, b] = f(i % COLS);
            [b, g, r, 255]
        }).collect()
    }

    #[test]
    fn three_groups_from_bgra() {
        let px = screen_of(|c| if c < 5 { [255, 0, 0] } else if c < 11 { [0, 255, 0] } else { [0, 0, 255] });
        assert_eq!(average(&px).unwrap(), ["#ff0000", "#00ff00", "#0000ff"]);
        assert_eq!(average(&px[..10]), None, "a short buffer is not a screen");
    }

    #[test]
    fn a_small_vivid_area_beats_a_dark_bar() {
        // dark grey everywhere, one orange pixel per group (1 of 45 / 54 pixels)
        let mut px = screen_of(|_| [10, 10, 10]);
        for col in [2, 8, 13] {
            px[((ROWS - 1) * COLS + col) * 4..][..4].copy_from_slice(&[0, 128, 255, 255]);
        }
        for g in average(&px).unwrap() {
            let (r, b) = (u8::from_str_radix(&g[1..3], 16).unwrap(), u8::from_str_radix(&g[5..7], 16).unwrap());
            assert!(r > 150 && b < 100, "orange expected, got {g}");
        }
    }

    #[test]
    fn black_never_glows_black() {
        assert_eq!(average(&screen_of(|_| [0, 0, 0])), None, "all black: the page's own glow colour");
        // a black group beside colour is lifted to grey
        let c = average(&screen_of(|c| if c < 5 { [0, 0, 0] } else { [255, 0, 0] })).unwrap();
        assert_eq!(c, ["#595959", "#ff0000", "#ff0000"]);
        // dark grey is lifted too
        assert_eq!(average(&screen_of(|c| if c < 5 { [20, 20, 20] } else { [255, 0, 0] })).unwrap()[0], "#595959");
    }

    #[test]
    fn white_and_grey_stay_as_they_are() {
        assert_eq!(average(&screen_of(|_| [255, 255, 255])).unwrap(), ["#ffffff"; 3]);
        assert_eq!(average(&screen_of(|_| [128, 128, 128])).unwrap(), ["#808080"; 3]);
    }

    #[test]
    fn the_region_is_the_screen_under_the_strip_and_stays_on_the_monitor() {
        let m = |h: i32, scale: f64| Monitor {
            index: 0,
            rect: Rect { left: -1920, top: 0, right: 0, bottom: h },
            work: Rect::default(),
            scale,
            primary: false,
            hz: 60,
        };
        assert_eq!(region(&m(1080, 1.5)), Rect { left: -1920, top: 45 + 12, right: 0, bottom: 1080 });
        let tiny = region(&m(40, 1.0));
        assert!(tiny.top <= 40 && tiny.height() >= 0, "clamped: {tiny:?}");
    }

    #[test]
    fn every_pause_reason_stops_the_sample() {
        let none = Pause::default();
        assert!(!paused(&none));
        assert!(!paused(&Pause { presence: Presence::QuietTime, ..none }));
        for p in [
            Pause { locked: true, ..none },
            Pause { sharing: true, ..none },
            Pause { clip_open: true, ..none },
            Pause { covered: true, ..none },
            Pause { presence: Presence::NotPresent, ..none },
            Pause { presence: Presence::Presentation, ..none },
            Pause { presence: Presence::Busy, ..none },
            Pause { presence: Presence::D3dFullscreen, ..none },
            Pause { presence: Presence::App, ..none },
        ] {
            let mut t = Tint::default();
            let sent = t.step("0", true, &p, || panic!("sampled while paused: {p:?}"));
            assert_eq!(sent, None, "{p:?}");
        }
    }

    #[test]
    fn off_sends_null_once_and_never_samples() {
        let mut t = Tint::default();
        let off = |t: &mut Tint| t.step("1", false, &Pause::default(), || panic!("sampled while off"));
        assert_eq!(off(&mut t), Some(ScreenTint { monitor: "1".into(), colors: None }));
        assert_eq!(off(&mut t), None, "null only once");
        let red = screen_of(|_| [255, 0, 0]);
        let on = t.step("1", true, &Pause::default(), || Some(red.clone())).unwrap();
        assert_eq!(on.colors.unwrap()[0], "#ff0000");
        assert!(off(&mut t).is_some(), "switched off again: null again");
        // A failed sample is "unavailable": null, once.
        let mut t = Tint::default();
        assert_eq!(t.step("1", true, &Pause::default(), || None).unwrap().colors, None);
        assert_eq!(t.step("1", true, &Pause::default(), || None), None);
    }
}
