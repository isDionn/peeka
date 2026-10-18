//! Capture exclusion while the pano is on screen: the island window gets `WDA_EXCLUDEFROMCAPTURE`
//! when the clipboard card or the Modules' Pano tab opens and `WDA_NONE` once the last of them has closed. The page
//! calls `clip_visible {on: true}` and awaits it before it draws the card (the flag is set before the call returns),
//! and `{on: false}` after the card is gone. A counter, not a bool: the card and the tab can both be open.

/// The island window's display affinity. Real one: `notch_win::capture`; tests: a recorder.
pub trait Affinity {
    /// true = `WDA_EXCLUDEFROMCAPTURE`, false = `WDA_NONE`; returns whether Windows accepted it.
    fn exclude(&self, on: bool) -> bool;
}

#[derive(Debug, Default)]
pub struct CaptureGuard {
    open: u32,
}

impl CaptureGuard {
    /// One pano view is about to draw. The flag goes on with the first one; returns whether it is on.
    pub fn open(&mut self, a: &dyn Affinity) -> bool {
        self.open = self.open.saturating_add(1);
        // Re-applied on every open: a window rebuilt meanwhile (monitor change) starts at WDA_NONE.
        a.exclude(true)
    }

    /// One pano view has closed. The flag goes off only when none is left; a close with none open is ignored.
    pub fn close(&mut self, a: &dyn Affinity) {
        if self.open == 0 {
            return;
        }
        self.open -= 1;
        if self.open == 0 {
            a.exclude(false);
        }
    }

    pub fn is_open(&self) -> bool {
        self.open > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Rec(RefCell<Vec<&'static str>>);

    impl Affinity for Rec {
        fn exclude(&self, on: bool) -> bool {
            self.0.borrow_mut().push(if on { "exclude" } else { "none" });
            true
        }
    }

    #[test]
    fn the_flag_is_on_before_the_card_draws_and_off_only_after_the_last_view_closed() {
        let (a, mut g) = (Rec::default(), CaptureGuard::default());
        let mut frames = vec![];
        // The page: await open, then draw.
        if g.open(&a) {
            frames.push(a.0.borrow().last().copied());
        }
        assert_eq!(frames, [Some("exclude")], "excluded before the first frame");
        g.open(&a); // the Pano tab too
        g.close(&a);
        assert_eq!(a.0.borrow().last(), Some(&"exclude"), "one view still open: still excluded");
        g.close(&a);
        assert_eq!(a.0.borrow().last(), Some(&"none"), "removed after the last close");
        g.close(&a);
        assert_eq!(a.0.borrow().len(), 3, "a stray close changes nothing");
        assert!(!g.is_open());
    }
}
