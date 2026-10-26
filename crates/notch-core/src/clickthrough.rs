//! Click-through for the fixed-size transparent island window. The page reports its clickable
//! rectangles (CSS px, relative to the window) on every shape change; a cursor poll in Rust at the island monitor's
//! refresh rate (`poll_interval`) asks `captures`
//! and turns `set_ignore_cursor_events` off inside a rectangle, on outside. The poll is in Rust because a window that
//! ignores the mouse gets no mouse events.

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// The cursor poll's interval for a monitor of `hz` (owner request: follow 60/120/144/165/240 Hz), clamped to
/// 30..=360 Hz; 0 or 1 (Windows's "hardware default" / unknown) = 60 Hz.
pub fn poll_interval(hz: u32) -> Duration {
    let hz = if hz <= 1 { 60 } else { hz.clamp(30, 360) };
    Duration::from_micros(1_000_000 / u64::from(hz))
}

/// Where a mouse press landed, for `notch://outside_press`: the strip's monitor index, `"island"` for the island
/// window (its card is inside it), `""` for anything else (another app, the desktop).
pub fn press_target<'a>(root: isize, island: isize, strips: impl IntoIterator<Item = (&'a str, isize)>) -> String {
    if root != 0 && root == island {
        return "island".into();
    }
    strips.into_iter().find(|&(_, h)| h == root).map(|(l, _)| l.trim_start_matches("strip-").to_string()).unwrap_or_default()
}

/// A page never needs more than a handful (middle content, protrusion, card); more is a bug or abuse.
pub const MAX_RECTS: usize = 32; // every shown ghost adds up to two (lib/hitRects.ts)

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Painted but not clickable (shadow, bubble): it widens a strip's window region, never the click area.
    #[serde(default)]
    pub paint: bool,
}

/// Validates what the page sent: finite, non-negative sizes, at most `MAX_RECTS`. None = reject the whole report
/// (the previous rectangles stay).
pub fn sanitize(rects: Vec<CssRect>) -> Option<Vec<CssRect>> {
    let ok = |r: &CssRect| [r.x, r.y, r.w, r.h].iter().all(|v| v.is_finite()) && r.w >= 0.0 && r.h >= 0.0;
    (rects.len() <= MAX_RECTS && rects.iter().all(ok)).then_some(rects)
}

/// Should the window take the mouse? `cursor` and `origin` are physical px on the virtual screen, `scale` the window's
/// scale factor, `rects` the page's clickable rectangles in CSS px. Outside every rectangle = let clicks through.
pub fn captures(cursor: (i32, i32), origin: (i32, i32), scale: f64, rects: &[CssRect]) -> bool {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let x = f64::from(cursor.0 - origin.0) / scale;
    let y = f64::from(cursor.1 - origin.1) / scale;
    rects.iter().any(|r| !r.paint && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
}

/// Should a strip window take the mouse? Like the island (`captures`), plus its bar (`bar` physical px tall), which is
/// clickable before the page's first report. `size` is the window's (physical px); outside it, never. The strips have
/// no window region any more: the real-PC 1 px white lines sat on the region's edges (tanitim/bug-rc4 6, the Status box).
pub fn strip_captures(cursor: (i32, i32), origin: (i32, i32), size: (i32, i32), bar: i32, scale: f64, rects: &[CssRect]) -> bool {
    let (x, y) = (cursor.0 - origin.0, cursor.1 - origin.1);
    x >= 0 && y >= 0 && x < size.0 && y < size.1 && (y < bar || captures(cursor, origin, scale, rects))
}

/// What a strip's window region would be (with its bar, `strip_region_boxes`; for diagnostics only now) and the island's diagnostics:
/// every reported rectangle, clickable or painted, as `(left, top, right, bottom)` physical px inside a `win` (w, h)
/// window. The page already holds a rectangle at its target size while a panel grows and until the close animation
/// ends, so following the report never cuts an animation. Empty rectangles are dropped; nothing = an empty region (the window covers nothing).
pub fn region_boxes(rects: &[CssRect], scale: f64, win: (i32, i32)) -> Vec<(i32, i32, i32, i32)> {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let clamp = |v: f64, max: i32| (v.clamp(0.0, f64::from(max))) as i32;
    rects
        .iter()
        .map(|r| (clamp((r.x * scale).floor(), win.0), clamp((r.y * scale).floor(), win.1), clamp(((r.x + r.w) * scale).ceil(), win.0), clamp(((r.y + r.h) * scale).ceil(), win.1)))
        .filter(|b| b.2 > b.0 && b.3 > b.1)
        .collect()
}

/// The strip window's region: the bar (`bar_h` physical px, always, so the strip shows before the page's first report)
/// plus every rectangle the page reported (open panel at its target size, context menu, toast, preview).
pub fn strip_region_boxes(rects: &[CssRect], scale: f64, win: (i32, i32), bar_h: i32) -> Vec<(i32, i32, i32, i32)> {
    let mut boxes = vec![(0, 0, win.0, bar_h.clamp(0, win.1))];
    boxes.extend(region_boxes(rects, scale, win));
    boxes
}

#[cfg(test)]
mod tests {
    use super::*;

    const PILL: CssRect = CssRect { x: 280.0, y: 0.0, w: 200.0, h: 30.0, paint: false };

    #[test]
    fn a_press_is_told_apart_by_its_window() {
        let strips = [("strip-0", 7), ("strip-1", 9)];
        assert_eq!(press_target(9, 5, strips), "1");
        assert_eq!(press_target(5, 5, strips), "island");
        assert_eq!(press_target(42, 5, strips), "", "another app");
        assert_eq!(press_target(0, 0, strips), "", "no window, no island yet");
    }

    #[test]
    fn the_poll_follows_the_refresh_rate_within_bounds() {
        let us = |hz| poll_interval(hz).as_micros();
        assert_eq!((us(60), us(144), us(240)), (16_666, 6_944, 4_166));
        assert_eq!((us(0), us(1)), (16_666, 16_666), "unknown = 60 Hz");
        assert_eq!((us(24), us(1000)), (33_333, 2_777), "clamped to 30..=360");
    }

    #[test]
    fn inside_a_rect_captures_outside_lets_through() {
        assert!(captures((1000, 10), (580, 0), 1.0, &[PILL]));
        assert!(!captures((1000, 40), (580, 0), 1.0, &[PILL]), "the transparent shadow below");
        assert!(!captures((500, 10), (580, 0), 1.0, &[PILL]), "left of the window");
        assert!(!captures((1000, 10), (580, 0), 1.0, &[]), "nothing clickable");
    }

    #[test]
    fn the_scale_maps_physical_to_css_px() {
        // 150 %: the pill's right edge (480 css) is at 720 physical px from the window's left.
        assert!(captures((100 + 719, 44), (100, 0), 1.5, &[PILL]));
        assert!(!captures((100 + 720, 10), (100, 0), 1.5, &[PILL]));
        assert!(!captures((100 + 500, 45), (100, 0), 1.5, &[PILL]), "30 css = 45 physical, exclusive");
    }

    #[test]
    fn a_painted_rect_never_captures_clicks() {
        let shadow = CssRect { y: 30.0, h: 100.0, paint: true, ..PILL };
        assert!(!captures((1000, 60), (580, 0), 1.0, &[shadow]));
        assert!(captures((1000, 10), (580, 0), 1.0, &[shadow, PILL]));
    }

    #[test]
    fn the_region_follows_the_rects_in_physical_px_inside_the_window() {
        let card = CssRect { x: 100.0, y: 30.0, w: 300.0, h: 200.0, paint: false };
        assert_eq!(region_boxes(&[PILL, card], 1.0, (760, 590)), vec![(280, 0, 480, 30), (100, 30, 400, 230)]);
        assert_eq!(region_boxes(&[PILL], 1.5, (1140, 885)), vec![(420, 0, 720, 45)], "150 % scale");
        let big = CssRect { x: -20.0, y: 0.0, w: 900.0, h: 700.0, paint: true };
        assert_eq!(region_boxes(&[big], 1.0, (760, 590)), vec![(0, 0, 760, 590)], "clamped to the window");
        assert!(region_boxes(&[], 1.0, (760, 590)).is_empty(), "no rects = covers nothing");
        assert!(region_boxes(&[CssRect { w: 0.0, ..PILL }], 1.0, (760, 590)).is_empty());
    }

    #[test]
    fn a_strip_takes_the_bar_always_and_below_it_only_its_rects() {
        let (o, size) = ((1920, 0), (1920, 1079));
        assert!(strip_captures((1920 + 5, 37), o, size, 38, 1.25, &[]), "the bar, before any report");
        assert!(!strip_captures((1920 + 5, 38), o, size, 38, 1.25, &[]), "just under the bar: the desktop");
        let status = CssRect { x: 1552.0, y: 30.0, w: 360.0, h: 400.0, paint: false };
        assert!(strip_captures((1920 + 1600, 100), o, size, 30, 1.0, &[status]), "the open panel");
        assert!(!strip_captures((1920 + 1500, 31), o, size, 30, 1.0, &[status]), "left of the panel, under the bar");
        assert!(!strip_captures((1919, 10), o, size, 30, 1.0, &[]), "another monitor");
    }

    #[test]
    fn the_strip_region_is_the_bar_plus_the_open_panel() {
        assert_eq!(strip_region_boxes(&[], 1.25, (1920, 1079), 38), vec![(0, 0, 1920, 38)], "before the first report");
        let status = CssRect { x: 1480.0, y: 30.0, w: 504.0, h: 400.0, paint: false }; // 360 + 72 each side
        assert_eq!(
            strip_region_boxes(&[status], 1.0, (1920, 1079), 30),
            vec![(0, 0, 1920, 30), (1480, 30, 1920, 430)],
            "clamped to the window's right edge"
        );
    }

    #[test]
    fn bad_reports_are_rejected_whole() {
        assert!(sanitize(vec![PILL]).is_some());
        assert!(sanitize(vec![CssRect { w: f64::NAN, ..PILL }]).is_none());
        assert!(sanitize(vec![CssRect { h: -1.0, ..PILL }]).is_none());
        assert!(sanitize(vec![PILL; MAX_RECTS + 1]).is_none());
    }
}
