//! Screen tint for the strip/island glow (owner, 2026-10-26): every 2 s a thin band just under each monitor's strip
//! is shrunk to 16x2 px and averaged into three colours (left, centre, right). Privacy: the pixels stay in memory in
//! the sampler (`notch_win::tint`), are never written to disk, logs or diagnostics and never reach plugins; only the
//! three hex colours go to Peeka's own pages (`screen_tint`). No sample is even taken while `paused`.

use crate::model::{island_rect, px, Monitor, Rect, STRIP_HEIGHT};
use crate::presence::Presence;
use serde::Serialize;

/// The shrunk band: 16 columns, 2 rows, BGRA (what a 32-bit top-down DIB holds).
pub const COLS: usize = 16;
pub const ROWS: usize = 2;
pub const BYTES: usize = COLS * ROWS * 4;
/// The band in CSS px: starts this far under the strip (clear of the strip's own bottom edge and glow), this tall.
pub const BAND_GAP: f64 = 8.0;
pub const BAND_HEIGHT: f64 = 6.0;

/// The `screen_tint` payload. `colors` null = sampling is off (setting, demo) or unavailable on that monitor; the page
/// falls back to `--glow-color`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScreenTint {
    pub monitor: String,
    pub colors: Option<[String; 3]>,
}

/// The band to sample on `m`, in virtual-screen px, kept inside the monitor (a tiny monitor gets an empty band), as two
/// halves left and right of the island's x range: the island's own shoulder glow must never tint itself. Each half fills
/// 8 of the 16 columns, so the centre colour is what sits right beside the island.
pub fn band(m: &Monitor) -> [Rect; 2] {
    let top = (m.rect.top + px(STRIP_HEIGHT, m.scale) + px(BAND_GAP, m.scale)).min(m.rect.bottom);
    let full = Rect { top, bottom: (top + px(BAND_HEIGHT, m.scale)).min(m.rect.bottom), ..m.rect };
    // shortcut: secondary strips (no island) also skip the middle 760 px, and a monitor narrower than that gets no tint; gate on m.primary if the owner sees it
    let island = island_rect(m);
    [Rect { right: island.left, ..full }, Rect { left: island.right, ..full }]
}

/// Left / centre / right: the 16 columns split 5-6-5, both rows, as `#rrggbb`. None = not a whole 16x2 BGRA band.
pub fn average(bgra: &[u8]) -> Option<[String; 3]> {
    if bgra.len() != BYTES {
        return None;
    }
    let part = |cols: std::ops::Range<usize>| {
        let mut sum = [0u32; 3];
        let mut n = 0u32;
        for row in 0..ROWS {
            for col in cols.clone() {
                let p = &bgra[(row * COLS + col) * 4..][..4];
                sum[0] += u32::from(p[2]);
                sum[1] += u32::from(p[1]);
                sum[2] += u32::from(p[0]);
                n += 1;
            }
        }
        let c = |s: u32| ((s + n / 2) / n).min(255);
        format!("#{:02x}{:02x}{:02x}", c(sum[0]), c(sum[1]), c(sum[2]))
    };
    Some([part(0..5), part(5..11), part(11..16)])
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

    fn band_of(f: impl Fn(usize) -> [u8; 3]) -> Vec<u8> {
        (0..COLS * ROWS).flat_map(|i| {
            let [r, g, b] = f(i % COLS);
            [b, g, r, 255]
        }).collect()
    }

    #[test]
    fn three_thirds_averaged_from_bgra() {
        let px = band_of(|c| if c < 5 { [255, 0, 0] } else if c < 11 { [0, 255, 0] } else { [0, 0, 255] });
        assert_eq!(average(&px).unwrap(), ["#ff0000", "#00ff00", "#0000ff"]);
        // Two rows mixed: 0 and 255 round to 128.
        let mut px = band_of(|_| [0, 0, 0]);
        px[COLS * 4..].copy_from_slice(&band_of(|_| [255, 255, 255])[COLS * 4..]);
        assert_eq!(average(&px).unwrap()[1], "#808080");
        assert_eq!(average(&px[..10]), None, "a short buffer is not a band");
    }

    #[test]
    fn the_band_sits_under_the_strip_and_stays_on_the_monitor() {
        let m = |h: i32, scale: f64| Monitor {
            index: 0,
            rect: Rect { left: -1920, top: 0, right: 0, bottom: h },
            work: Rect::default(),
            scale,
            primary: false,
            hz: 60,
        };
        let [l, r] = band(&m(1080, 1.5));
        assert_eq!(l, Rect { left: -1920, top: 45 + 12, right: -1920 + 390, bottom: 45 + 12 + 9 });
        assert_eq!(r, Rect { left: -390, right: 0, ..l });
        // the island (760 css px, centred) is never inside either half
        let island = island_rect(&m(1080, 1.5));
        assert!(l.right <= island.left && r.left >= island.right, "{l:?} {r:?} {island:?}");
        let [tl, tr] = band(&m(40, 1.0));
        for tiny in [tl, tr] {
            assert!(tiny.top <= 40 && tiny.bottom <= 40 && tiny.height() >= 0, "clamped: {tiny:?}");
        }
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
        let red = band_of(|_| [255, 0, 0]);
        let on = t.step("1", true, &Pause::default(), || Some(red.clone())).unwrap();
        assert_eq!(on.colors.unwrap()[0], "#ff0000");
        assert!(off(&mut t).is_some(), "switched off again: null again");
        // A failed sample is "unavailable": null, once.
        let mut t = Tint::default();
        assert_eq!(t.step("1", true, &Pause::default(), || None).unwrap().colors, None);
        assert_eq!(t.step("1", true, &Pause::default(), || None), None);
    }
}
