//! Offline plan-usage snapshots.  This deliberately reads session history only;
//! it never opens auth files or contacts a provider.
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window { pub used_percent: u8, pub window_minutes: u32, pub resets_at: Option<i64>, #[serde(skip_serializing_if = "Option::is_none")] pub resets_in_seconds: Option<i64> }

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage { pub agent: &'static str, pub windows: Vec<Window> }

/// Parse one Codex rollout line.  The file is untrusted history, so malformed
/// lines and unknown windows simply produce no snapshot.
pub fn codex_line(line: &str) -> Vec<Window> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
    let Some(limits) = v.pointer("/payload/rate_limits") else { return vec![] };
    ["primary", "secondary"].into_iter().filter_map(|key| {
        let w = limits.get(key)?;
        let minutes = w.get("window_minutes")?.as_u64()?.try_into().ok()?;
        let used = w.get("used_percent")?.as_f64()?.round().clamp(0.0, 100.0) as u8;
        let reset = w.get("resets_at").and_then(Value::as_i64);
        let remaining = w.get("resets_in_seconds").and_then(Value::as_i64);
        Some(Window { used_percent: used, window_minutes: minutes, resets_at: reset, resets_in_seconds: remaining })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_rate_limits_from_token_count_fixture() {
        let line = r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":84.2,"window_minutes":300,"resets_at":1770000000},"secondary":{"used_percent":2,"window_minutes":10080,"resets_in_seconds":3600}}}}"#;
        assert_eq!(codex_line(line), vec![Window { used_percent: 84, window_minutes: 300, resets_at: Some(1770000000), resets_in_seconds: None }, Window { used_percent: 2, window_minutes: 10080, resets_at: None, resets_in_seconds: Some(3600) }]);
    }
    #[test]
    fn ignores_non_usage_lines() { assert!(codex_line("{\"payload\":{}}").is_empty()); }
}
