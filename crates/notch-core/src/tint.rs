//! Screen tint for the strip/island glow (owner, 2026-10-26; whole screen 2026-10-30): every 2 s the monitor below each
//! strip is shrunk to 48x27 px and reduced to three colours (left, centre, right), vivid pixels weighing most so a dark
//! tab or title bar does not make the glow black or grey. Privacy: the pixels stay in memory in the sampler
//! (`notch_win::tint`), are never written to disk, logs or diagnostics and never reach plugins; only the three hex
//! colours go to Peeka's own pages (`screen_tint`). No sample is even taken while `paused`.

use crate::model::{px, Monitor, Rect, STRIP_HEIGHT};
use crate::presence::Presence;
use serde::Serialize;

/// The shrunk screen: 48 columns, 27 rows, BGRA (what a 32-bit top-down DIB holds). 16x9 averaged a vivid area with the
/// dark UI around it into grey before the weighting could see it (owner's screen, 2026-10-30).
pub const COLS: usize = 48;
pub const ROWS: usize = 27;
/// Left / centre / right column groups (5-6-5 of 16, scaled).
const GROUPS: [std::ops::Range<usize>; 3] = [0..15, 15..33, 33..48];
pub const BYTES: usize = COLS * ROWS * 4;
/// The sampled area starts this far under the strip (clear of the strip's own bottom edge and glow), in CSS px.
pub const BAND_GAP: f64 = 8.0;
/// A pixel whose saturation * value stays under this has no colour (dark UI, grey, white, thin coloured text shrunk away).
const DULL: f32 = 0.2;
/// A group has a colour of its own only when at least this share of its pixels is colourful: a few blue links or icons on a
/// black page no longer turn the whole glow blue (owner's screen, 2026-10-30).
const MIN_SHARE: f32 = 0.04;
/// Hue bins (30 degrees each) for the dominant colour.
const HUES: usize = 12;
/// A coloured group darker than this (brightest channel / 255) is scaled up to it, hue kept: a glow has to be seen.
const MIN_VALUE: f32 = 0.6;
/// The glow over a screen with no colour (dark UI, grey, white): a soft light grey, never black and no longer the brand's
/// purple, which read as "the glow ignores my screen" (owner, 2026-11-01).
const NEUTRAL: &str = "#c8ccd4";

/// The `screen_tint` payload. `colors` null = sampling is off (setting, demo) or unavailable on that monitor; the page
/// falls back to `--glow-color`.
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

/// Left / centre / right as `#rrggbb`. Each group takes its dominant hue: colourful pixels go into `HUES` hue bins weighted
/// by (saturation * value)^2 and the heaviest bin's mean is the colour, so orange walls under a blue sky stay orange instead
/// of averaging to grey (owner's game screen, 2026-10-30). A group needs `MIN_SHARE` colourful pixels; one without takes the
/// most colourful other group's colour; if no group has colour: `NEUTRAL` on all three, never a black glow. None = not a
/// whole BGRA screen.
pub fn average(bgra: &[u8]) -> Option<[String; 3]> {
    if bgra.len() != BYTES {
        return None;
    }
    let part = |cols: std::ops::Range<usize>| {
        let (mut bins, mut vivid) = ([([0f32; 3], 0f32); HUES], 0usize);
        for row in 0..ROWS {
            for col in cols.clone() {
                let p = &bgra[(row * COLS + col) * 4..][..4];
                let c = [f32::from(p[2]), f32::from(p[1]), f32::from(p[0])];
                let (hi, lo) = (c[0].max(c[1]).max(c[2]), c[0].min(c[1]).min(c[2]));
                let sv = (hi - lo) / 255.0; // saturation * value
                if sv < DULL {
                    continue; // dark or grey: no colour, would wash the colour out
                }
                vivid += 1;
                let d = hi - lo;
                let h = if hi == c[0] { ((c[1] - c[2]) / d).rem_euclid(6.0) } else if hi == c[1] { (c[2] - c[0]) / d + 2.0 } else { (c[0] - c[1]) / d + 4.0 };
                let bin = &mut bins[(h / 6.0 * HUES as f32) as usize % HUES];
                for i in 0..3 {
                    bin.0[i] += c[i] * sv * sv;
                }
                bin.1 += sv * sv;
            }
        }
        let (sum, wsum) = bins.into_iter().max_by(|a, b| a.1.total_cmp(&b.1)).unwrap_or_default();
        let mut rgb = sum.map(|x| x / wsum.max(f32::EPSILON));
        let hi = rgb[0].max(rgb[1]).max(rgb[2]);
        if hi > 0.0 && hi < MIN_VALUE * 255.0 {
            rgb = rgb.map(|x| x * MIN_VALUE * 255.0 / hi);
        }
        let share = vivid as f32 / (ROWS * cols.len()) as f32;
        (share, format!("#{:02x}{:02x}{:02x}", rgb[0].round() as u8, rgb[1].round() as u8, rgb[2].round() as u8))
    };
    let parts = GROUPS.map(part);
    let best = parts.iter().max_by(|a, b| a.0.total_cmp(&b.0))?;
    if best.0 < MIN_SHARE {
        return Some([NEUTRAL; 3].map(String::from));
    }
    let best = best.1.clone();
    Some(parts.map(|(share, hex)| if share < MIN_SHARE { best.clone() } else { hex }))
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
        let px = screen_of(|c| if c < 15 { [255, 0, 0] } else if c < 33 { [0, 255, 0] } else { [0, 0, 255] });
        assert_eq!(average(&px).unwrap(), ["#ff0000", "#00ff00", "#0000ff"]);
        assert_eq!(average(&px[..10]), None, "a short buffer is not a screen");
    }

    #[test]
    fn a_vivid_area_beats_a_dark_bar_but_a_few_pixels_do_not() {
        // dark grey everywhere, one orange pixel per group (1 of 405 / 486 pixels): blue links on a black page, not a colour
        let mut px = screen_of(|_| [10, 10, 10]);
        for col in [7, 24, 40] {
            px[((ROWS - 1) * COLS + col) * 4..][..4].copy_from_slice(&[0, 128, 255, 255]);
        }
        assert_eq!(average(&px).unwrap(), [NEUTRAL; 3]);
        // one orange column per group (27 of 405 / 486 pixels, over 4%)
        let px = screen_of(|c| if [7, 24, 40].contains(&c) { [255, 128, 0] } else { [10, 10, 10] });
        for g in average(&px).unwrap() {
            let (r, b) = (u8::from_str_radix(&g[1..3], 16).unwrap(), u8::from_str_radix(&g[5..7], 16).unwrap());
            assert!(r > 150 && b < 100, "orange expected, got {g}");
        }
    }

    #[test]
    fn a_screen_without_colour_glows_soft_grey_never_black() {
        for plain in [[0, 0, 0], [20, 20, 20], [128, 128, 128], [255, 255, 255]] {
            assert_eq!(average(&screen_of(|_| plain)).unwrap(), [NEUTRAL; 3], "{plain:?}");
        }
        // a dull group beside colour takes that colour
        let c = average(&screen_of(|c| if c < 15 { [0, 0, 0] } else { [255, 0, 0] })).unwrap();
        assert_eq!(c, ["#ff0000"; 3]);
    }

    #[test]
    fn mixed_colours_take_the_dominant_hue_not_a_grey_mean() {
        // orange walls (2 of 3 columns), green trees, blue sky: the mean would be grey-green
        let c = average(&screen_of(|c| match c % 4 { 0 | 1 => [200, 110, 70], 2 => [60, 140, 60], _ => [70, 120, 220] })).unwrap();
        assert_eq!(c, ["#c86e46"; 3]);
    }

    #[test]
    fn a_dark_colour_is_brightened_keeping_its_hue() {
        assert_eq!(average(&screen_of(|_| [0, 60, 0])).unwrap(), ["#009900"; 3]);
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
