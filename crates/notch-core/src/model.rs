//! Screens and the windows Notch puts on them: a 30 px strip per monitor (an AppBar) and one
//! fixed-size transparent island window over the middle of the primary strip. All rectangles are physical pixels on
//! the virtual screen; the page works in CSS px, the scale converts.

use serde::{Deserialize, Serialize};

/// The strip's height in CSS px; times the monitor scale on screen.
pub const STRIP_HEIGHT: f64 = 30.0;
/// The short strip window's height in CSS px: the strip line's blurred glow (notch.css `#line::after`: bottom at 34,
/// blur 9 px reaches 3 sigma = 27 px further) must not be cut. Mirrored in ui/src/lib/stripTall.ts.
pub const STRIP_IDLE_HEIGHT: f64 = 64.0;
/// The island window's fixed size in CSS px: widest card 640 + shadow and shoulder room, tallest card.
/// shortcut: placeholder numbers until the UI agent measures the tallest card in the maket; change here only.
pub const ISLAND_WIDTH: f64 = crate::brand::ISLAND_MAX.0;
pub const ISLAND_HEIGHT: f64 = crate::brand::ISLAND_MAX.1;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
    /// `self` covers all of `other` (a fullscreen window over its monitor).
    pub fn covers(&self, other: &Rect) -> bool {
        self.left <= other.left && self.top <= other.top && self.right >= other.right && self.bottom >= other.bottom
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Monitor {
    /// Stable within one enumeration (sorted: primary first, then left to right, top to bottom).
    pub index: usize,
    pub rect: Rect,
    /// The work area Windows reports (already without the AppBars).
    pub work: Rect,
    /// Effective DPI / 96.
    pub scale: f64,
    pub primary: bool,
    /// Refresh rate (`dmDisplayFrequency`); 0 = Windows did not say (0 and 1 mean "hardware default" there).
    pub hz: u32,
}

/// Physical px of a CSS length on a monitor of `scale`; never 0 for a non-zero length.
pub fn px(css: f64, scale: f64) -> i32 {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    ((css * scale).round() as i32).max(if css > 0.0 { 1 } else { 0 })
}

/// Primary first, then left to right, top to bottom; `index` follows the order.
pub fn sort_monitors(list: &mut [Monitor]) {
    list.sort_by_key(|m| (!m.primary, m.rect.left, m.rect.top));
    for (i, m) in list.iter_mut().enumerate() {
        m.index = i;
    }
}

/// The strip a monitor wants reserved at its top edge.
pub fn strip_rect(m: &Monitor) -> Rect {
    Rect { bottom: m.rect.top + px(STRIP_HEIGHT, m.scale), ..m.rect }
}

/// The strip window, tall: from the reserved bar's top down to 1 px above the monitor's bottom, so the panels hanging under
/// the bar (Start, Status, Search, settings...) draw at full height in the same page (no region: the cursor poll lets
/// clicks through outside the bar + the open panel, `clickthrough::strip_captures`). The AppBar keeps only `bar` reserved. 1 px short of the
/// bottom: a foreground window covering its monitor counts as fullscreen (`foreground_covers`, Explorer's own check)
/// and would hide the strips.
/// Short (nothing hangs below the bar): the bar and what it paints under itself, so the strip's animations recomposite
/// a small surface, not the whole screen (owner's PC: ~1 core + dwm 65 % with music); the page asks for tall first.
pub fn strip_window_rect(bar: Rect, m: &Monitor, tall: bool) -> Rect {
    let bottom = if tall { m.rect.bottom - 1 } else { (bar.top + px(STRIP_IDLE_HEIGHT, m.scale)).min(m.rect.bottom - 1) };
    Rect { bottom: bottom.max(bar.bottom), ..bar }
}

/// The island window: centred on the primary monitor, top edge on the screen edge (it covers the strip's middle).
pub fn island_rect(m: &Monitor) -> Rect {
    let w = px(ISLAND_WIDTH, m.scale).min(m.rect.width());
    let h = px(ISLAND_HEIGHT, m.scale).min(m.rect.height());
    let left = m.rect.left + (m.rect.width() - w) / 2;
    Rect { left, top: m.rect.top, right: left + w, bottom: m.rect.top + h }
}

/// The short island window's height in CSS px: the resting centre with its hanging 40 px mascot (bottom ~51, fx ~60,
/// the hit-rect paint envelope ~76) and the mascot's hover bubble (~70). Width stays: everything there is window-relative.
pub const ISLAND_IDLE_HEIGHT: f64 = 80.0;

/// The island window short (nothing below the resting centre, so its 60 fps mascot, bars and glow recomposite a band,
/// not 760x620) or tall (`full`, a card / peek / hover is about to paint below). Same top-left either way.
pub fn island_window_rect(full: Rect, scale: f64, tall: bool) -> Rect {
    if tall {
        return full;
    }
    Rect { bottom: (full.top + px(ISLAND_IDLE_HEIGHT, scale)).min(full.bottom), ..full }
}

/// The primary monitor (the island's home); the first one if Windows names none.
pub fn primary(list: &[Monitor]) -> Option<&Monitor> {
    list.iter().find(|m| m.primary).or(list.first())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(left: i32, w: i32, scale: f64, primary: bool) -> Monitor {
        let rect = Rect { left, top: 0, right: left + w, bottom: 1080 };
        Monitor { index: 9, rect, work: rect, scale, primary, hz: 60 }
    }

    #[test]
    fn the_strip_is_30_css_px_at_every_scale() {
        assert_eq!(strip_rect(&mon(0, 1920, 1.0, true)).height(), 30);
        assert_eq!(strip_rect(&mon(0, 1920, 1.25, true)).height(), 38); // 37.5 rounds up
        assert_eq!(strip_rect(&mon(1920, 2560, 1.5, false)), Rect { left: 1920, top: 0, right: 4480, bottom: 45 });
        assert_eq!(px(30.0, f64::NAN), 30, "an unreadable scale counts as 100 %");
    }

    #[test]
    fn the_strip_window_hangs_to_the_bottom_but_never_covers_the_monitor() {
        let m = mon(0, 1920, 1.25, true);
        let bar = strip_rect(&m);
        let w = strip_window_rect(bar, &m, true);
        assert_eq!(w, Rect { left: 0, top: 0, right: 1920, bottom: 1079 });
        assert!(!w.covers(&m.rect));
        let pushed = Rect { top: 40, bottom: 78, ..bar }; // another top AppBar above ours
        assert_eq!((strip_window_rect(pushed, &m, true).top, strip_window_rect(pushed, &m, true).bottom), (40, 1079));
    }

    #[test]
    fn the_idle_strip_window_is_the_bar_plus_its_glow() {
        let m = mon(0, 1920, 1.0, true);
        assert_eq!(strip_window_rect(strip_rect(&m), &m, false), Rect { left: 0, top: 0, right: 1920, bottom: 64 });
        let m = mon(0, 1536, 1.25, true);
        assert_eq!(strip_window_rect(strip_rect(&m), &m, false).height(), 80);
        let pushed = Rect { top: 40, bottom: 78, ..strip_rect(&m) };
        assert_eq!(strip_window_rect(pushed, &m, false).bottom, 120, "it hangs from the bar, wherever the bar is");
        let tiny = Monitor { rect: Rect { bottom: 50, ..m.rect }, ..m };
        assert_eq!(strip_window_rect(strip_rect(&tiny), &tiny, false).bottom, 49, "never covers the monitor");
    }

    #[test]
    fn the_island_is_centred_and_never_wider_than_the_screen() {
        let r = island_rect(&mon(0, 1920, 1.0, true));
        assert_eq!((r.left, r.top, r.width()), (580, 0, 760));
        let small = island_rect(&mon(0, 700, 1.0, true));
        assert_eq!((small.left, small.width()), (0, 700));
    }

    #[test]
    fn the_idle_island_window_is_a_band_with_the_same_top_left() {
        let full = island_rect(&mon(0, 1920, 1.0, true));
        assert_eq!(island_window_rect(full, 1.0, true), full);
        assert_eq!(island_window_rect(full, 1.0, false), Rect { bottom: 80, ..full });
        let full = island_rect(&mon(0, 1536, 1.25, true));
        let short = island_window_rect(full, 1.25, false);
        assert_eq!((short.left, short.top, short.width(), short.height()), (full.left, 0, 950, 100));
        let tiny = Rect { bottom: 60, ..full };
        assert_eq!(island_window_rect(tiny, 1.25, false), tiny, "never taller than the full island");
    }

    #[test]
    fn monitors_sort_primary_first_then_left_to_right() {
        let mut list = vec![mon(1920, 1920, 1.0, false), mon(-1920, 1920, 1.0, false), mon(0, 1920, 1.0, true)];
        sort_monitors(&mut list);
        assert_eq!(list.iter().map(|m| (m.rect.left, m.index)).collect::<Vec<_>>(), [(0, 0), (-1920, 1), (1920, 2)]);
        assert_eq!(primary(&list).unwrap().rect.left, 0);
        assert!(primary(&[]).is_none());
    }

    #[test]
    fn covers_and_contains() {
        let screen = Rect { left: 0, top: 0, right: 100, bottom: 100 };
        assert!(Rect { left: -8, top: -8, right: 108, bottom: 108 }.covers(&screen));
        assert!(!Rect { left: 0, top: 30, right: 100, bottom: 100 }.covers(&screen));
        assert!(screen.contains(0, 0) && !screen.contains(100, 50));
    }
}
