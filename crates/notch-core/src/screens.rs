// Peeka — original implementation (MIT).
//! Which screen does what (scenarios 39, 40, 41), platform-free so `cargo test --lib` holds the rules:
//! - 39: a fullscreen video on the SECOND monitor hides that monitor's strip only; the main island keeps working.
//! - 40: an approval while the cursor is on another monitor puts a badge on that monitor's strip (the island stays on
//!   the primary).
//! - 41: when a monitor goes (unplugged, laptop lid closed) the island moves to the new primary; the island window is
//!   the same window, so what its page holds (an open card) stays.
//!
//! None of this was run against two real screens by an agent (Faz E checks it). The inputs are the readings Windows
//! gives: the fullscreen window's monitor, the cursor's monitor, the monitor list.

use crate::model::{island_rect, primary, Monitor, Rect};
use crate::presence::Presence;

/// What fullscreen hides right now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenPlan {
    /// The island (and Notch's other pop-up windows) hide, and its alerts wait: the fullscreen is on its monitor, or
    /// Windows says "presentation".
    pub island_hidden: bool,
    /// Monitor indexes whose strip window hides.
    pub hidden_strips: Vec<usize>,
    /// The presence the island's attention budget reads: a fullscreen app on ANOTHER monitor does not make the
    /// island "busy".
    pub island_presence: Presence,
}

/// `presence` = `SHQueryUserNotificationState` (session-wide: it says "busy" whichever monitor the fullscreen app is
/// on). `covered` = the monitor the foreground window covers completely, if any. `primary` = the island's monitor;
/// `strips` = the monitors that have a strip.
///
/// - Presentation mode is the owner's own switch: everything hides.
/// - A covering window explains "busy" / "D3D fullscreen" / "Store app fullscreen": only its monitor hides (the island
///   too, if that is the primary one).
/// - "Busy" and friends with no covering window found (an exclusive game Windows reports but no window rect shows):
///   everything hides, as before.
pub fn screen_plan(presence: Presence, covered: Option<usize>, primary: usize, strips: &[usize]) -> ScreenPlan {
    let busy = matches!(presence, Presence::Busy | Presence::D3dFullscreen | Presence::App);
    let everywhere = presence == Presence::Presentation || (busy && covered.is_none());
    if everywhere {
        return ScreenPlan { island_hidden: true, hidden_strips: strips.to_vec(), island_presence: presence };
    }
    let Some(m) = covered else {
        return ScreenPlan { island_hidden: false, hidden_strips: vec![], island_presence: presence };
    };
    let elsewhere = m != primary && busy;
    ScreenPlan {
        island_hidden: m == primary,
        hidden_strips: strips.iter().copied().filter(|s| *s == m).collect(),
        island_presence: if elsewhere { Presence::Normal } else { presence },
    }
}

/// The badge on a secondary strip: `(monitor, approvals)`. Only for a monitor that is not the island's, has a strip,
/// and whose strip is not hidden (a fullscreen video there); None = no badge (the island alone shows the approval).
pub fn approval_badge(
    cursor: Option<usize>,
    island: usize,
    strips: &[usize],
    hidden: &[usize],
    approvals: usize,
) -> Option<(usize, usize)> {
    let m = cursor?;
    (approvals > 0 && m != island && strips.contains(&m) && !hidden.contains(&m)).then_some((m, approvals))
}

/// Where the island goes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IslandSpot {
    pub monitor: usize,
    pub rect: Rect,
    pub scale: f64,
    pub hz: u32,
}

/// What `app::layout` builds for a monitor list.
#[derive(Clone, Debug, PartialEq)]
pub struct LayoutPlan {
    /// Monitors that get a strip: the primary always, the others when `secondary`.
    pub strips: Vec<usize>,
    /// None only when Windows lists no monitor at all: the island window then stays where it is.
    pub island: Option<IslandSpot>,
}

pub fn plan_layout(monitors: &[Monitor], secondary: bool) -> LayoutPlan {
    LayoutPlan {
        strips: monitors.iter().filter(|m| m.primary || secondary).map(|m| m.index).collect(),
        island: primary(monitors).map(|m| IslandSpot { monitor: m.index, rect: island_rect(m), scale: m.scale, hz: m.hz }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clickthrough::{region_boxes, CssRect};
    use crate::model::{sort_monitors, ISLAND_HEIGHT, ISLAND_WIDTH};

    fn mon(left: i32, w: i32, h: i32, scale: f64, primary: bool) -> Monitor {
        let rect = Rect { left, top: 0, right: left + w, bottom: h };
        Monitor { index: 9, rect, work: rect, scale, primary, hz: 60 }
    }

    fn sorted(mut v: Vec<Monitor>) -> Vec<Monitor> {
        sort_monitors(&mut v);
        v
    }

    // ---- 39

    #[test]
    fn a_fullscreen_video_on_the_second_screen_hides_only_that_strip_and_never_silences_the_island() {
        let p = screen_plan(Presence::Busy, Some(1), 0, &[0, 1]);
        assert_eq!((p.island_hidden, p.hidden_strips.as_slice()), (false, &[1][..]));
        assert_eq!(p.island_presence, Presence::Normal, "the island is not 'busy': its alerts still open");
        for busy in [Presence::D3dFullscreen, Presence::App] {
            let p = screen_plan(busy, Some(1), 0, &[0, 1]);
            assert!(!p.island_hidden && p.island_presence == Presence::Normal, "{busy:?}");
        }
        // A borderless fullscreen window Windows does not call busy: the same.
        let p = screen_plan(Presence::Normal, Some(1), 0, &[0, 1]);
        assert_eq!((p.island_hidden, p.hidden_strips.as_slice()), (false, &[1][..]));
    }

    #[test]
    fn fullscreen_on_the_main_screen_hides_the_island_and_that_strip_and_keeps_the_other_strip() {
        let p = screen_plan(Presence::Busy, Some(0), 0, &[0, 1]);
        assert_eq!((p.island_hidden, p.hidden_strips.as_slice()), (true, &[0][..]));
        assert_eq!(p.island_presence, Presence::Busy, "the island is busy: only approvals get through");
        let none = screen_plan(Presence::Normal, None, 0, &[0, 1]);
        assert_eq!((none.island_hidden, none.hidden_strips.is_empty()), (false, true));
    }

    #[test]
    fn presentation_mode_and_a_busy_report_with_no_covering_window_still_hide_everything() {
        for (p, covered) in [(Presence::Presentation, Some(1)), (Presence::Presentation, None), (Presence::Busy, None)] {
            let plan = screen_plan(p, covered, 0, &[0, 1]);
            assert!(plan.island_hidden && plan.hidden_strips == [0, 1], "{p:?} {covered:?}");
        }
        assert!(!screen_plan(Presence::QuietTime, None, 0, &[0, 1]).island_hidden, "quiet time is not fullscreen");
    }

    // ---- 40

    #[test]
    fn an_approval_with_the_cursor_on_another_screen_badges_that_screens_strip() {
        assert_eq!(approval_badge(Some(1), 0, &[0, 1], &[], 1), Some((1, 1)));
        assert_eq!(approval_badge(Some(2), 0, &[0, 1, 2], &[], 3), Some((2, 3)));
        assert_eq!(approval_badge(Some(0), 0, &[0, 1], &[], 1), None, "the cursor is on the island's screen");
        assert_eq!(approval_badge(None, 0, &[0, 1], &[], 1), None, "no cursor reading");
        assert_eq!(approval_badge(Some(1), 0, &[0, 1], &[], 0), None, "nothing to approve");
        assert_eq!(approval_badge(Some(1), 0, &[0], &[], 1), None, "that screen has no strip (secondary strips off)");
        assert_eq!(approval_badge(Some(1), 0, &[0, 1], &[1], 1), None, "its strip is hidden by a fullscreen video");
    }

    // ---- 41

    #[test]
    fn unplugging_the_second_monitor_removes_its_strip_and_the_island_stays_where_it_was() {
        let docked = sorted(vec![mon(0, 1920, 1080, 1.25, true), mon(1920, 2560, 1440, 1.0, false)]);
        let before = plan_layout(&docked, true);
        assert_eq!((before.strips.as_slice(), before.island.unwrap().monitor), (&[0, 1][..], 0));
        let after = plan_layout(&sorted(vec![mon(0, 1920, 1080, 1.25, true)]), true);
        assert_eq!(after.strips, [0]);
        assert_eq!(after.island, before.island, "the same spot: nothing moved");
        assert_eq!(plan_layout(&docked, false).strips, [0], "secondary strips off: the primary only");
    }

    #[test]
    fn closing_the_laptop_lid_moves_the_island_to_the_new_primary_and_the_open_card_keeps_its_clickable_region() {
        let docked = sorted(vec![mon(0, 1920, 1080, 1.25, true), mon(1920, 2560, 1440, 1.0, false)]);
        let before = plan_layout(&docked, true).island.unwrap();
        // The lid closes: Windows lists only the external screen and calls it primary.
        let lone = sorted(vec![mon(0, 2560, 1440, 1.0, true)]);
        let after = plan_layout(&lone, true).island.unwrap();
        assert_ne!((before.rect, before.scale), (after.rect, after.scale), "the island window moves and rescales");
        let screen = lone[0].rect;
        assert!(screen.covers(&after.rect), "the island window sits inside the new screen");
        assert_eq!((after.rect.width(), after.rect.height()), ((ISLAND_WIDTH) as i32, (ISLAND_HEIGHT) as i32));
        assert_eq!(after.rect.top, screen.top, "still on the screen's top edge");

        // An open card: the page reported its rectangle in CSS px; the window region is recomputed at the new scale
        // and stays inside the window, so the card is still there and still clickable after the move.
        let card = [CssRect { x: 60.0, y: 0.0, w: 640.0, h: 420.0, paint: false }];
        let win_before = (before.rect.width(), before.rect.height());
        let win_after = (after.rect.width(), after.rect.height());
        let boxes = region_boxes(&card, after.scale, win_after);
        assert_eq!(boxes.len(), 1, "the card's rectangle is still there");
        let b = boxes[0];
        assert!(b.2 <= win_after.0 && b.3 <= win_after.1 && b.2 > b.0 && b.3 > b.1);
        assert_eq!(b, (60, 0, 700, 420), "at scale 1.0 the CSS px are the physical px");
        assert_ne!(region_boxes(&card, before.scale, win_before), boxes, "and it was recomputed, not reused");
    }

    #[test]
    fn a_smaller_new_primary_clamps_the_island_inside_it_and_no_monitor_leaves_the_island_alone() {
        let small = plan_layout(&sorted(vec![mon(0, 700, 500, 1.0, true)]), true).island.unwrap();
        assert!(small.rect.width() <= 700 && small.rect.height() <= 500);
        let none = plan_layout(&[], true);
        assert_eq!((none.strips.is_empty(), none.island), (true, None), "no screen listed: the window is not touched");
    }

    /// The island page keeps an open card across a monitor change only because the same window is reused: `build`
    /// returns the existing window before it creates anything, and `layout` only moves it. Reads the bin crate's
    /// source (never compiled under `--lib`), like the lock test in `cmd`.
    #[test]
    fn layout_reuses_the_island_window_instead_of_rebuilding_it() {
        let app = include_str!("../../../src-tauri/src/app.rs");
        let at = app.find("fn build(").expect("fn build in app.rs");
        let body = &app[at..];
        let body = &body[body.find(" {\n").unwrap() + 3..];
        let first = body.lines().next().unwrap_or_default().trim();
        assert_eq!(first, "if let Some(w) = app.get_webview_window(label) {", "build must return the existing window first");
    }
}
