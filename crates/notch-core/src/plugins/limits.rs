//! Control messages and stream messages are counted apart. Control: 50 per 10 s per connection, then
//! `-32005` with `retry_after`. Stream (`composer.delta`, `voice.transcript`, `live_text.append`): 40 a second are
//! taken one by one, the rest are merged into the same 50 ms batch (never dropped); a stream stops at 64 KB in all.

use std::collections::{BTreeMap, VecDeque};

pub const CONTROL_MAX: usize = 50;
pub const CONTROL_WINDOW_MS: u64 = 10_000;
pub const STREAM_MAX: usize = 40;
pub const STREAM_WINDOW_MS: u64 = 1_000;
pub const PROTRUSION_OPENS_MAX: usize = 6;
pub const PROTRUSION_WINDOW_MS: u64 = 60_000;
pub const COALESCE_MS: u64 = 50;
pub const STREAM_TOTAL: usize = 64 * 1024;

/// A sliding window of hit times.
#[derive(Debug, Default)]
pub struct Window {
    hits: VecDeque<u64>,
}

impl Window {
    /// Counts a hit when there is room; Some(seconds to wait) when there is none (the hit is not counted).
    pub fn hit(&mut self, now: u64, max: usize, window_ms: u64) -> Option<u64> {
        while self.hits.front().is_some_and(|t| now.saturating_sub(*t) >= window_ms) {
            self.hits.pop_front();
        }
        if self.hits.len() >= max {
            let oldest = self.hits.front().copied().unwrap_or(now);
            return Some((window_ms - now.saturating_sub(oldest)).div_ceil(1000).max(1));
        }
        self.hits.push_back(now);
        None
    }
}

/// What one stream's text is merged for.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum StreamKey {
    Composer(u64),
    /// (plugin id, stream id): `voice.transcript` and `live_text.append`.
    Live(String, String),
}

#[derive(Debug, Default)]
struct Pending {
    text: String,
    since: u64,
    /// Bytes taken so far, flushed or not.
    total: usize,
    truncated: bool,
    /// The 64 KB cut was already reported.
    told: bool,
}

/// Per-stream batches, flushed at most every 50 ms.
#[derive(Debug, Default)]
pub struct Coalescer {
    streams: BTreeMap<StreamKey, Pending>,
}

/// A batch to draw: the merged text since the last one; `truncated` once, when the 64 KB cut happened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    pub key: StreamKey,
    pub text: String,
    pub truncated: bool,
}

impl Coalescer {
    /// Appends `text`; beyond 64 KB per stream the rest is cut (at a char boundary).
    pub fn push(&mut self, key: StreamKey, text: &str, now: u64) {
        let p = self.streams.entry(key).or_default();
        if p.text.is_empty() {
            p.since = now;
        }
        let room = STREAM_TOTAL.saturating_sub(p.total);
        let mut take = text.len().min(room);
        while !text.is_char_boundary(take) {
            take -= 1;
        }
        p.text.push_str(&text[..take]);
        p.total += take;
        if take < text.len() {
            p.truncated = true;
        }
    }

    /// The batches whose first piece waited 50 ms (all of them when `all`).
    pub fn due(&mut self, now: u64, all: bool) -> Vec<Batch> {
        let mut out = vec![];
        for (key, p) in &mut self.streams {
            let report = p.truncated && !p.told;
            if (p.text.is_empty() && !report) || (!all && now.saturating_sub(p.since) < COALESCE_MS) {
                continue;
            }
            p.told |= report;
            out.push(Batch { key: key.clone(), text: std::mem::take(&mut p.text), truncated: report });
        }
        out
    }

    /// What is pending for one stream now (before a chip, so the order on screen stays right); the stream goes on.
    pub fn take(&mut self, key: &StreamKey) -> Option<Batch> {
        let p = self.streams.get_mut(key)?;
        let report = p.truncated && !p.told;
        p.told |= report;
        (!p.text.is_empty() || report).then(|| Batch {
            key: key.clone(),
            text: std::mem::take(&mut p.text),
            truncated: report,
        })
    }

    /// The stream ended: what is left of it, then it is forgotten (a new stream with the same key starts at 0).
    pub fn end(&mut self, key: &StreamKey) -> Option<Batch> {
        let p = self.streams.remove(key)?;
        (!p.text.is_empty() || (p.truncated && !p.told)).then(|| Batch {
            key: key.clone(),
            text: p.text,
            truncated: p.truncated && !p.told,
        })
    }

    pub fn end_where(&mut self, keep: impl Fn(&StreamKey) -> bool) {
        self.streams.retain(|k, _| keep(k));
    }

    pub fn is_empty(&self) -> bool {
        self.streams.values().all(|p| p.text.is_empty() && !(p.truncated && !p.told))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_counts_and_says_how_long_to_wait() {
        let mut w = Window::default();
        for i in 0..CONTROL_MAX as u64 {
            assert_eq!(w.hit(i, CONTROL_MAX, CONTROL_WINDOW_MS), None);
        }
        assert_eq!(w.hit(100, CONTROL_MAX, CONTROL_WINDOW_MS), Some(10));
        assert_eq!(w.hit(9_500, CONTROL_MAX, CONTROL_WINDOW_MS), Some(1));
        assert_eq!(w.hit(10_000, CONTROL_MAX, CONTROL_WINDOW_MS), None, "the oldest left the window");
    }

    #[test]
    fn deltas_merge_into_one_batch_per_50_ms_and_nothing_is_lost() {
        let mut c = Coalescer::default();
        let k = StreamKey::Composer(1);
        for (i, w) in ["Mer", "ha", "ba", " dü", "nya"].iter().enumerate() {
            c.push(k.clone(), w, 1000 + i as u64);
        }
        assert!(c.due(1049, false).is_empty(), "not yet 50 ms");
        let b = c.due(1050, false);
        assert_eq!(b, [Batch { key: k.clone(), text: "Merhaba dünya".into(), truncated: false }]);
        assert!(c.due(2000, false).is_empty() && c.is_empty());
        c.push(k.clone(), "!", 2000);
        assert_eq!(c.end(&k).unwrap().text, "!");
        assert!(c.end(&k).is_none());
    }

    #[test]
    fn a_stream_is_cut_at_64_kb_on_a_char_boundary_and_says_so_once() {
        let mut c = Coalescer::default();
        let k = StreamKey::Live("p".into(), "s".into());
        c.push(k.clone(), &"a".repeat(STREAM_TOTAL - 1), 0);
        c.push(k.clone(), "ğğ", 0); // 2 bytes each: none fits in the last byte
        let b = c.due(50, false);
        assert_eq!((b[0].text.len(), b[0].truncated), (STREAM_TOTAL - 1, true));
        c.push(k.clone(), "more", 60);
        let b = c.due(200, false);
        assert_eq!((b[0].text.as_str(), b[0].truncated), ("m", false), "the last byte, and the cut is told once");
        c.push(k.clone(), "x", 300);
        assert!(c.due(400, false).is_empty(), "full: nothing more is taken");
    }
}
