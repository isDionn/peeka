//! Notch's own countdown timer (Wave 5): one at a time, held in Rust so a page reload keeps
//! it. Times are the caller's Unix ms (a fake clock in the tests).

use serde::{Deserialize, Serialize};

/// `wave5-api.ts` `TimerAction`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerAction {
    Pause,
    Resume,
    Add5,
    Stop,
}

/// The longest timer Notch takes (24 h); anything longer is a typo.
pub const MAX_S: u64 = 24 * 3600;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Timer {
    label: String,
    total_ms: u64,
    /// What was left at `anchor`.
    left_ms: u64,
    anchor: u64,
    running: bool,
}

/// `wave5-api.ts` `TimerState`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub label: String,
    pub total_s: f64,
    pub remaining_s: f64,
    pub running: bool,
    pub at: u64,
}

impl Timer {
    /// None = 0 s or longer than `MAX_S`.
    pub fn start(label: &str, seconds: u64, now: u64) -> Option<Self> {
        (1..=MAX_S).contains(&seconds).then(|| {
            let label: String = label.trim().chars().take(40).collect();
            let label = if label.is_empty() { "Timer".into() } else { label };
            Self { label, total_ms: seconds * 1000, left_ms: seconds * 1000, anchor: now, running: true }
        })
    }

    pub fn left_ms(&self, now: u64) -> u64 {
        if self.running {
            self.left_ms.saturating_sub(now.saturating_sub(self.anchor))
        } else {
            self.left_ms
        }
    }

    pub fn done(&self, now: u64) -> bool {
        self.left_ms(now) == 0
    }

    /// Applies an action; false = `Stop` (the caller drops the timer).
    pub fn apply(&mut self, a: TimerAction, now: u64) -> bool {
        self.left_ms = self.left_ms(now);
        self.anchor = now;
        match a {
            TimerAction::Pause => self.running = false,
            TimerAction::Resume => self.running = true,
            TimerAction::Add5 => {
                self.left_ms = (self.left_ms + 5 * 60_000).min(MAX_S * 1000);
                self.total_ms = self.total_ms.max(self.left_ms);
            }
            TimerAction::Stop => return false,
        }
        true
    }

    pub fn view(&self, now: u64) -> TimerState {
        TimerState {
            label: self.label.clone(),
            total_s: self.total_ms as f64 / 1000.0,
            remaining_s: self.left_ms(now) as f64 / 1000.0,
            running: self.running,
            at: now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_down_pauses_adds_and_stops() {
        assert!(Timer::start("x", 0, 0).is_none() && Timer::start("x", MAX_S + 1, 0).is_none());
        let mut t = Timer::start("  ", 60, 1_000).unwrap();
        assert_eq!(t.view(1_000).label, "Timer");
        assert_eq!(Timer::start("  tea  ", 1, 0).unwrap().view(0).label, "tea");
        assert_eq!(Timer::start(&"x".repeat(60), MAX_S, 0).unwrap().view(0).label.len(), 40);
        assert_eq!(MAX_S, 86_400);
        assert_eq!(t.left_ms(21_000), 40_000);
        assert!(t.apply(TimerAction::Pause, 21_000));
        assert_eq!(t.left_ms(99_000), 40_000, "frozen while paused");
        t.apply(TimerAction::Resume, 99_000);
        assert_eq!(t.left_ms(109_000), 30_000);
        t.apply(TimerAction::Add5, 109_000);
        let v = t.view(109_000);
        assert_eq!((v.remaining_s, v.total_s, v.running, v.at), (330.0, 330.0, true, 109_000));
        assert!(!t.done(438_999) && t.done(439_000) && t.done(900_000));
        assert!(!t.apply(TimerAction::Stop, 1));
        assert_eq!(serde_json::from_str::<TimerAction>("\"add5\"").unwrap(), TimerAction::Add5);
        assert!(serde_json::from_str::<TimerAction>("\"start\"").is_err());
    }
}
