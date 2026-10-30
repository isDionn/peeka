//! Offline plan-usage snapshots.  This deliberately reads session history only;
//! it never opens auth files or contacts a provider.
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub used_percent: u8,
    pub window_minutes: u32,
    pub resets_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_in_seconds: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub agent: &'static str,
    pub windows: Vec<Window>,
}

/// Parse one Codex rollout line.  The file is untrusted history, so malformed
/// lines and unknown windows simply produce no snapshot.
pub fn codex_line(line: &str) -> Vec<Window> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
    let Some(limits) = v.pointer("/payload/rate_limits") else { return vec![] };
    ["primary", "secondary"]
        .into_iter()
        .filter_map(|key| {
            let w = limits.get(key)?;
            let minutes = w.get("window_minutes")?.as_u64()?.try_into().ok()?;
            let used = w.get("used_percent")?.as_f64()?.round().clamp(0.0, 100.0) as u8;
            let reset = w.get("resets_at").and_then(Value::as_i64);
            let remaining = w.get("resets_in_seconds").and_then(Value::as_i64);
            Some(Window { used_percent: used, window_minutes: minutes, resets_at: reset, resets_in_seconds: remaining })
        })
        .collect()
}

/// Session logs looked at, newest-written first, and how much of each one's end: every `token_count` event carries
/// the counters, so the tail of a recent log holds the latest ones without reading a multi-megabyte rollout.
const CODEX_FILES: usize = 12;
const CODEX_TAIL: u64 = 512 * 1024;

/// The newest Codex counters under `root` (`~/.codex/sessions`): the valid `rate_limits` event with the latest event
/// timestamp across the recent logs, not the last line of the last-written file (a resumed old session writes last).
/// ISO-8601 UTC timestamps order as plain strings.
pub fn codex_latest(root: &std::path::Path) -> Vec<Window> {
    use std::io::{Read, Seek, SeekFrom};
    let mut files = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path);
            } else if path.extension().is_some_and(|e| e == "jsonl") {
                if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                    files.push((modified, path));
                }
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut best: Option<(String, Vec<Window>)> = None;
    for (_, path) in files.into_iter().take(CODEX_FILES) {
        let Ok(mut file) = std::fs::File::open(path) else { continue };
        let len = file.metadata().map_or(0, |m| m.len());
        let mut bytes = Vec::new();
        if file.seek(SeekFrom::Start(len.saturating_sub(CODEX_TAIL))).is_err() || file.read_to_end(&mut bytes).is_err() {
            continue;
        }
        // a cut tail starts mid-line: that first line fails to parse and is skipped like any bad line
        let found = String::from_utf8_lossy(&bytes).lines().rev().filter(|l| l.contains("rate_limits")).find_map(|line| {
            let windows = codex_line(line);
            let at = serde_json::from_str::<Value>(line).ok()?.get("timestamp")?.as_str()?.to_owned();
            (!windows.is_empty()).then_some((at, windows))
        });
        if let Some(found) = found {
            if best.as_ref().is_none_or(|b| found.0 > b.0) {
                best = Some(found);
            }
        }
    }
    best.map(|b| b.1).unwrap_or_default()
}

/// The statusline collector retains only these four public Claude Code meter
/// values. Everything else in the statusline payload is discarded before disk.
pub fn claude_statusline(bytes: &[u8]) -> Option<Value> {
    let input: Value = serde_json::from_slice(bytes).ok()?;
    let limits = input.get("rate_limits")?;
    let mut kept = serde_json::Map::new();
    // a plan can report only one of the two meters: keep whichever is there
    for key in ["five_hour", "seven_day"] {
        let Some(meter) = limits.get(key) else { continue };
        let Some(used) = meter.get("used_percentage").and_then(Value::as_f64) else { continue };
        kept.insert(key.into(), json!({ "used_percentage": used, "resets_at": meter.get("resets_at")?.clone() }));
    }
    (!kept.is_empty()).then_some(Value::Object(kept))
}

/// Decode the collector's deliberately small on-disk snapshot into the common
/// usage shape. A malformed or partial local file is simply not shown.
pub fn claude_windows(bytes: &[u8]) -> Vec<Window> {
    let Ok(limits) = serde_json::from_slice::<Value>(bytes) else { return vec![] };
    [("five_hour", 300), ("seven_day", 10_080)].into_iter().filter_map(|(key, minutes)| {
        let meter = limits.get(key)?;
        let used = meter.get("used_percentage")?.as_f64()?.round().clamp(0.0, 100.0) as u8;
        let reset = meter.get("resets_at")?.as_i64()?;
        Some(Window { used_percent: used, window_minutes: minutes, resets_at: Some(reset), resets_in_seconds: None })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_rate_limits_from_token_count_fixture() {
        let line = r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":84.2,"window_minutes":300,"resets_at":1770000000},"secondary":{"used_percent":2,"window_minutes":10080,"resets_in_seconds":3600}}}}"#;
        assert_eq!(
            codex_line(line),
            vec![
                Window { used_percent: 84, window_minutes: 300, resets_at: Some(1770000000), resets_in_seconds: None },
                Window { used_percent: 2, window_minutes: 10080, resets_at: None, resets_in_seconds: Some(3600) }
            ]
        );
    }
    #[test]
    fn ignores_non_usage_lines() {
        assert!(codex_line("{\"payload\":{}}").is_empty());
    }
    #[test]
    fn claude_statusline_keeps_only_public_meters() {
        let got = claude_statusline(br#"{"rate_limits":{"five_hour":{"used_percentage":84,"resets_at":1770000000,"secret":"no"},"seven_day":{"used_percentage":2,"resets_at":"soon"}},"workspace":"private"}"#).unwrap();
        assert_eq!(
            got,
            serde_json::json!({"five_hour":{"used_percentage":84.0,"resets_at":1770000000},"seven_day":{"used_percentage":2.0,"resets_at":"soon"}})
        );
    }
    #[test]
    fn claude_statusline_keeps_a_lone_meter() {
        let got = claude_statusline(br#"{"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":1770000000}}}"#).unwrap();
        assert_eq!(got, serde_json::json!({"five_hour":{"used_percentage":10.0,"resets_at":1770000000}}));
        assert!(claude_statusline(br#"{"rate_limits":{}}"#).is_none());
    }
    fn event(at: &str, used: u8) -> String {
        format!(r#"{{"timestamp":"{at}","type":"event_msg","payload":{{"rate_limits":{{"primary":{{"used_percent":{used},"window_minutes":300,"resets_at":1}}}}}}}}"#)
    }
    #[test]
    fn codex_takes_the_newest_event_not_the_newest_file() {
        let tmp = crate::test_util::Tmp::new();
        // the old session was written to last (resumed), so its file is newer on disk, but its event is older
        tmp.write("2026/10/29/new.jsonl", format!("{}
not json
{}
", event("2026-10-30T11:00:00.000Z", 5), r#"{"timestamp":"2026-10-30T12:00:00.000Z","payload":{"rate_limits":null}}"#).as_bytes());
        std::thread::sleep(std::time::Duration::from_millis(50));
        tmp.write("2026/10/28/old.jsonl", format!("{}
", event("2026-10-29T09:00:00.000Z", 90)).as_bytes());
        let got = codex_latest(tmp.path());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].used_percent, 5, "latest valid event wins; a null rate_limits line is skipped");
        assert!(codex_latest(&tmp.path().join("nope")).is_empty());
    }
    #[test]
    fn reads_the_collectors_claude_snapshot() {
        assert_eq!(claude_windows(br#"{"five_hour":{"used_percentage":84.2,"resets_at":1770000000},"seven_day":{"used_percentage":2,"resets_at":1770003600}}"#), vec![
            Window { used_percent: 84, window_minutes: 300, resets_at: Some(1770000000), resets_in_seconds: None },
            Window { used_percent: 2, window_minutes: 10_080, resets_at: Some(1770003600), resets_in_seconds: None },
        ]);
    }
}
