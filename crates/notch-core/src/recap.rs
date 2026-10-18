//! Weekly recap (F8): aggregate counters only, kept in `<data>/recap.json`. No names, paths or session ids reach the
//! file; session starts and edited files are tracked in memory only (for time and de-duplication). Weeks start on
//! Monday, local time; the caller passes the local day (days since 1970-01-01) so this stays testable.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const FILE: &str = "recap.json";
/// A session with no event for this long counts as ended (agents are often killed without a SessionEnd).
const IDLE_MS: u64 = 30 * 60_000;
/// One session never adds more than this.
const SESSION_MAX_MS: u64 = 12 * 3_600_000;

/// One week's counts (bridge.ts `RecapWeek`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Week {
    /// The Monday, local days since 1970-01-01.
    pub start_day: i64,
    pub sessions: u32,
    pub session_ms: u64,
    pub allowed: u32,
    pub denied: u32,
    pub files: u32,
    pub clips: u32,
    /// Coding activity (session starts, approvals, changed files) per weekday, Monday first.
    pub days: [u32; 7],
}

impl Week {
    fn new(start_day: i64) -> Self {
        Week { start_day, ..Week::default() }
    }

    fn is_empty(&self) -> bool {
        self.sessions == 0 && self.allowed == 0 && self.denied == 0 && self.files == 0 && self.clips == 0
    }
}

pub enum Ev<'a> {
    /// A coding agent's hook event (`cc_event`'s `kind`, `sid`).
    Agent { kind: &'a str, sid: Option<&'a str> },
    /// `cc_edit`: one file changed in a session.
    Edit { sid: Option<&'a str>, file: &'a str },
    Allowed,
    Denied,
    /// A new clipboard history item.
    Clip,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Recap {
    cur: Week,
    last: Week,
    /// The Monday of the week in which the owner closed the card (it is offered once a week).
    seen: i64,
    /// sid -> (first, last event ms). Memory only.
    #[serde(skip)]
    live: HashMap<String, (u64, u64)>,
    /// "sid\0file" already counted this week. Memory only.
    #[serde(skip)]
    files_seen: HashSet<String>,
}

/// The Monday on or before `day` (1970-01-01 was a Thursday).
pub fn monday(day: i64) -> i64 {
    day - (day + 3).rem_euclid(7)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's `days_from_civil`).
pub fn day_of(y: i32, m: u32, d: u32) -> i64 {
    let y = i64::from(y) - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

impl Recap {
    /// Counts one event. True = the stored counts changed (the caller saves).
    pub fn add(&mut self, ev: Ev, day: i64, now: u64) -> bool {
        let mut changed = self.roll(day);
        changed |= self.sweep(now);
        let wd = (day - self.cur.start_day).clamp(0, 6) as usize;
        let w = &mut self.cur;
        match ev {
            Ev::Agent { kind, sid } => {
                if kind == "session_start" {
                    w.sessions += 1;
                    w.days[wd] += 1;
                    changed = true;
                }
                let Some(sid) = sid else { return changed };
                if kind == "session_end" {
                    if let Some((start, _)) = self.live.remove(sid) {
                        w.session_ms += now.saturating_sub(start).min(SESSION_MAX_MS);
                        changed = true;
                    }
                } else if kind == "session_start" {
                    self.live.insert(sid.to_string(), (now, now));
                } else {
                    // a session that began before Peeka started still gets its time from here on
                    self.live.entry(sid.to_string()).or_insert((now, now)).1 = now;
                }
            }
            Ev::Edit { sid, file } => {
                if let Some(s) = sid.and_then(|s| self.live.get_mut(s)) {
                    s.1 = now;
                }
                if self.files_seen.insert(format!("{}\0{file}", sid.unwrap_or(""))) {
                    w.files += 1;
                    w.days[wd] += 1;
                    changed = true;
                }
            }
            Ev::Allowed | Ev::Denied => {
                if matches!(ev, Ev::Allowed) {
                    w.allowed += 1;
                } else {
                    w.denied += 1;
                }
                w.days[wd] += 1;
                changed = true;
            }
            Ev::Clip => {
                w.clips += 1;
                changed = true;
            }
        }
        changed
    }

    /// Last week's counts while its card is still to be offered: a new week began, the owner has not closed the card
    /// this week, and last week had anything in it.
    pub fn due(&mut self, day: i64) -> Option<Week> {
        self.roll(day);
        (self.seen != self.cur.start_day && !self.last.is_empty()).then(|| self.last.clone())
    }

    /// The owner closed the card: not again this week.
    pub fn ack(&mut self, day: i64) {
        self.roll(day);
        self.seen = self.cur.start_day;
    }

    /// A new week: open sessions are folded into the old one (at their last event), which becomes `last`.
    fn roll(&mut self, day: i64) -> bool {
        let m = monday(day);
        if self.cur.start_day == m {
            return false;
        }
        for (_, (start, end)) in self.live.drain() {
            self.cur.session_ms += end.saturating_sub(start).min(SESSION_MAX_MS);
        }
        let old = std::mem::replace(&mut self.cur, Week::new(m));
        self.last = if old.start_day == m - 7 { old } else { Week::new(m - 7) };
        self.files_seen.clear();
        true
    }

    /// Sessions idle for [`IDLE_MS`] end at their last event.
    fn sweep(&mut self, now: u64) -> bool {
        let before = self.cur.session_ms;
        let cur = &mut self.cur;
        self.live.retain(|_, &mut (start, end)| {
            let idle = now.saturating_sub(end) >= IDLE_MS;
            if idle {
                cur.session_ms += end.saturating_sub(start).min(SESSION_MAX_MS);
            }
            !idle
        });
        self.cur.session_ms != before
    }
}

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE)
}

/// Missing or unreadable = a fresh start (it is only counters).
pub fn load(path: &Path) -> Recap {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Temp file, then rename over (as `settings::save`).
pub fn save(path: &Path, r: &Recap) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(r).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    const MIN: u64 = 60_000;
    // 2026-10-12 is a Monday
    fn mon() -> i64 {
        day_of(2026, 10, 12)
    }

    #[test]
    fn dates_and_mondays() {
        assert_eq!(day_of(1970, 1, 1), 0);
        assert_eq!(day_of(2000, 3, 1), 11_017);
        assert_eq!(monday(mon()), mon());
        assert_eq!(monday(mon() + 6), mon(), "Sunday belongs to the week before the next Monday");
        assert_eq!(monday(mon() + 7), mon() + 7);
        assert_eq!(monday(0), -3, "1970-01-01 was a Thursday");
    }

    #[test]
    fn a_week_is_counted_then_offered_once_the_next_week_begins() {
        let mut r = Recap::default();
        let d = mon() + 2; // Wednesday
        assert!(r.add(Ev::Agent { kind: "session_start", sid: Some("a") }, d, 0));
        assert!(!r.add(Ev::Agent { kind: "post_tool", sid: Some("a") }, d, 10 * MIN), "memory only");
        r.add(Ev::Edit { sid: Some("a"), file: "src/x.rs" }, d, 11 * MIN);
        assert!(!r.add(Ev::Edit { sid: Some("a"), file: "src/x.rs" }, d, 12 * MIN), "same file once");
        r.add(Ev::Edit { sid: Some("a"), file: "src/y.rs" }, d, 13 * MIN);
        r.add(Ev::Agent { kind: "session_end", sid: Some("a") }, d, 20 * MIN);
        r.add(Ev::Allowed, d, 0);
        r.add(Ev::Allowed, mon() + 4, 0);
        r.add(Ev::Denied, d, 0);
        r.add(Ev::Clip, d, 0);
        assert_eq!(r.due(mon() + 6), None, "not during the week itself");
        let w = r.due(mon() + 7).expect("Monday after");
        assert_eq!((w.sessions, w.session_ms, w.files, w.allowed, w.denied, w.clips), (1, 20 * MIN, 2, 2, 1, 1));
        assert_eq!(w.days, [0, 0, 5, 0, 1, 0, 0], "clips are not coding activity");
        assert_eq!(r.due(mon() + 8), Some(w), "until closed, any day of the week");
        r.ack(mon() + 8);
        assert_eq!(r.due(mon() + 9), None);
        assert_eq!(r.due(mon() + 14), None, "the week after was empty");
    }

    #[test]
    fn sessions_without_an_end_still_count_their_time() {
        let mut r = Recap::default();
        r.add(Ev::Agent { kind: "session_start", sid: Some("a") }, mon(), 0);
        r.add(Ev::Agent { kind: "stop", sid: Some("a") }, mon(), 5 * MIN);
        assert!(r.add(Ev::Clip, mon(), 5 * MIN + IDLE_MS), "idle: folded in");
        r.add(Ev::Agent { kind: "stop", sid: Some("b") }, mon(), 100 * MIN); // began before Peeka
        r.add(Ev::Agent { kind: "stop", sid: Some("b") }, mon(), 103 * MIN);
        let w = r.due(mon() + 7).unwrap();
        assert_eq!((w.sessions, w.session_ms), (1, 8 * MIN), "5 min + 3 min, open one folded at the week's end");
    }

    #[test]
    fn a_gap_of_weeks_offers_nothing_old() {
        let mut r = Recap::default();
        r.add(Ev::Clip, mon(), 0);
        assert_eq!(r.due(mon() + 14), None, "the week before last is not last week");
    }

    #[test]
    fn save_and_load_keep_only_counts() {
        let tmp = Tmp::new();
        let p = path(tmp.path());
        let mut r = Recap::default();
        r.add(Ev::Agent { kind: "session_start", sid: Some("secret-sid") }, mon(), 0);
        r.add(Ev::Edit { sid: Some("secret-sid"), file: "private/plan.md" }, mon(), 0);
        save(&p, &r).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(!text.contains("secret") && !text.contains("plan.md"), "{text}");
        let mut back = load(&p);
        assert_eq!(back.due(mon() + 7).map(|w| (w.sessions, w.files)), Some((1, 1)));
        std::fs::write(&p, b"{oops").unwrap();
        assert_eq!(load(&p).cur, Week::default(), "corrupt = fresh");
    }
}
