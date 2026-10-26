//! Screens and the windows Notch puts on them: a 30 px strip per monitor (an AppBar) and one
//! fixed-size transparent island window over the middle of the primary strip. All rectangles are physical pixels on
//! the virtual screen; the page works in CSS px, the scale converts.

use serde::{Deserialize, Serialize};

/// The strip's height in CSS px; times the monitor scale on screen.
pub const STRIP_HEIGHT: f64 = 30.0;
/// The island window's fixed size in CSS px: widest card 640 + shadow and shoulder room, tallest card.
/// shortcut: placeholder numbers until the UI agent measures the tallest card in the maket; change here only.
pub const ISLAND_WIDTH: f64 = 760.0;
pub const ISLAND_HEIGHT: f64 = 620.0;

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

/// The strip window: from the reserved bar's top down to 1 px above the monitor's bottom, so the panels hanging under
/// the bar (Start, Status, Search, settings...) draw at full height in the same page (no region: the cursor poll lets
/// clicks through outside the bar + the open panel, `clickthrough::strip_captures`). The AppBar keeps only `bar` reserved. 1 px short of the
/// bottom: a foreground window covering its monitor counts as fullscreen (`foreground_covers`, Explorer's own check)
/// and would hide the strips.
pub fn strip_window_rect(bar: Rect, m: &Monitor) -> Rect {
    Rect { bottom: (m.rect.bottom - 1).max(bar.bottom), ..bar }
}

/// The island window: centred on the primary monitor, top edge on the screen edge (it covers the strip's middle).
pub fn island_rect(m: &Monitor) -> Rect {
    let w = px(ISLAND_WIDTH, m.scale).min(m.rect.width());
    let h = px(ISLAND_HEIGHT, m.scale).min(m.rect.height());
    let left = m.rect.left + (m.rect.width() - w) / 2;
    Rect { left, top: m.rect.top, right: left + w, bottom: m.rect.top + h }
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
        let w = strip_window_rect(bar, &m);
        assert_eq!(w, Rect { left: 0, top: 0, right: 1920, bottom: 1079 });
        assert!(!w.covers(&m.rect));
        let pushed = Rect { top: 40, bottom: 78, ..bar }; // another top AppBar above ours
        assert_eq!((strip_window_rect(pushed, &m).top, strip_window_rect(pushed, &m).bottom), (40, 1079));
    }

    #[test]
    fn the_island_is_centred_and_never_wider_than_the_screen() {
        let r = island_rect(&mon(0, 1920, 1.0, true));
        assert_eq!((r.left, r.top, r.width()), (580, 0, 760));
        let small = island_rect(&mon(0, 700, 1.0, true));
        assert_eq!((small.left, small.width()), (0, 700));
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
