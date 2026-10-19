//! The `input_tick` feed (Wave 5): how long since the last keyboard/mouse input (`GetLastInputInfo`), the cursor in
//! the island window's CSS px, and Windows's presentation / busy state (`SHQueryUserNotificationState`), for the
//! mascot's eyes and its pranks (decisions 5-9). At most once a second (`wave5-api.ts`), nothing
//! while nothing changed, and polled slower while the owner is away.

use serde::Serialize;

use crate::model::Rect;
use crate::presence::Presence;

/// `wave5-api.ts` `InputTick`; `presentation` / `busy` are Wave 5's additions for the prank gate.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputTick {
    pub last_input_ago_ms: u64,
    pub cursor: Option<Point>,
    /// `QUNS_PRESENTATION_MODE`, or the screen is being shared / recorded (`PrivacyState::screen`).
    pub presentation: bool,
    /// `QUNS_BUSY` / an exclusive D3D app / a Store app in fullscreen.
    pub busy: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The fewest ms between two ticks (the contract's "at most once a second").
pub const MIN_GAP_MS: u64 = 1000;
/// After this long without input the poll slows down.
pub const IDLE_MS: u64 = 60_000;

/// How long the reader sleeps before the next look.
pub fn poll_ms(last_input_ago_ms: u64) -> u64 {
    if last_input_ago_ms >= IDLE_MS {
        3000
    } else {
        MIN_GAP_MS
    }
}

/// The cursor (physical px) in the island window's CSS px; None outside the window.
pub fn island_cursor(cursor: (i32, i32), rect: Rect, scale: f64) -> Option<Point> {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    rect.contains(cursor.0, cursor.1).then(|| Point {
        x: (f64::from(cursor.0 - rect.left) / scale).round(),
        y: (f64::from(cursor.1 - rect.top) / scale).round(),
    })
}

/// Decides what goes out. `input_tick` is `GetLastInputInfo`'s `dwTime` (changes only on new input), so an idle
/// owner sends nothing: the page counts `lastInputAgoMs` up itself.
#[derive(Default)]
pub struct InputFeed {
    last: Option<(u32, Option<Point>, bool, bool)>,
    sent_at: Option<u64>,
}

impl InputFeed {
    /// `input_tick` = the last input's tick count, `ago_ms` = now minus it, `now` = a monotonic ms clock.
    pub fn feed(
        &mut self,
        input_tick: u32,
        ago_ms: u64,
        cursor: Option<Point>,
        presence: Presence,
        sharing: bool,
        now: u64,
    ) -> Option<InputTick> {
        // Screen shared or recorded (B1): the page treats it as presentation mode (generic labels, no peeks).
        let presentation = presence == Presence::Presentation || sharing;
        let busy = matches!(presence, Presence::Busy | Presence::D3dFullscreen | Presence::App);
        let key = (input_tick, cursor, presentation, busy);
        if self.last == Some(key) || self.sent_at.is_some_and(|t| now.saturating_sub(t) < MIN_GAP_MS) {
            return None;
        }
        self.last = Some(key);
        self.sent_at = Some(now);
        Some(InputTick { last_input_ago_ms: ago_ms, cursor, presentation, busy })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sends_only_changes_at_most_once_a_second() {
        let mut f = InputFeed::default();
        let p = Some(Point { x: 1.0, y: 2.0 });
        assert!(f.feed(10, 0, p, Presence::Normal, false, 0).is_some(), "the first tick");
        assert!(f.feed(10, 900, p, Presence::Normal, false, 1_000).is_none(), "nothing changed");
        assert!(f.feed(10, 9_000, p, Presence::Normal, false, 9_000).is_none(), "idle: still nothing");
        assert!(f.feed(11, 0, p, Presence::Normal, false, 9_500).is_some(), "new input");
        assert!(f.feed(12, 0, None, Presence::Normal, false, 9_900).is_none(), "under a second: wait");
        let t = f.feed(12, 100, None, Presence::Presentation, false, 10_500).unwrap();
        assert!(t.presentation && !t.busy && t.cursor.is_none());
        assert!(f.feed(12, 0, None, Presence::D3dFullscreen, false, 11_600).unwrap().busy);
        assert_eq!((poll_ms(0), poll_ms(IDLE_MS)), (1000, 3000));
    }

    #[test]
    fn a_screen_share_reads_as_presentation_and_its_end_resends() {
        let mut f = InputFeed::default();
        assert!(!f.feed(1, 0, None, Presence::Normal, false, 0).unwrap().presentation);
        let t = f.feed(1, 0, None, Presence::Normal, true, 1_000).unwrap();
        assert!(t.presentation && !t.busy, "sharing alone, same input: still sent");
        assert!(f.feed(1, 0, None, Presence::Busy, true, 2_000).unwrap().presentation, "fullscreen while sharing");
        assert!(!f.feed(1, 0, None, Presence::Normal, false, 3_000).unwrap().presentation, "the share ended");
    }

    #[test]
    fn the_cursor_is_in_island_css_px_or_none() {
        let r = Rect { left: 100, top: 0, right: 400, bottom: 90 };
        assert_eq!(island_cursor((250, 45), r, 1.5), Some(Point { x: 100.0, y: 30.0 }));
        assert_eq!(island_cursor((99, 45), r, 1.5), None);
        assert_eq!(island_cursor((100, 0), r, 0.0), Some(Point { x: 0.0, y: 0.0 }));
        let v = serde_json::to_value(InputTick { last_input_ago_ms: 5, cursor: None, presentation: true, busy: false });
        assert_eq!(
            v.unwrap(),
            serde_json::json!({"lastInputAgoMs": 5, "cursor": null, "presentation": true, "busy": false})
        );
    }
}
