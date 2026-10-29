// Peeka — original implementation (MIT).
//! The daily update check, pure part: reading GitHub's "latest release" reply, comparing versions, deciding when to
//! ask again. The request itself is `notch_win::update`; the one thing sent is a GET of `URL` with a plain User-Agent.

use serde::{Deserialize, Serialize};

/// The only address Peeka ever contacts.
pub const URL: &str = "https://api.github.com/repos/isDionn/peeka/releases/latest";
/// A release page must live here: the notice's "Download" opens it, so nothing else is accepted.
const PAGE: &str = "https://github.com/isDionn/peeka/";
pub const DAY_S: u64 = 86_400;

/// What the notice needs: a bare version ("0.4.0") and the release page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Release {
    pub version: String,
    pub url: String,
}

/// Kept in `update.json` in the data folder: when GitHub was last asked (unix seconds) and the version the owner
/// dismissed, so a restart neither asks again within a day nor repeats a notice.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    #[serde(default)]
    pub last_check: u64,
    #[serde(default)]
    pub dismissed: String,
}

/// A clock set back counts as due, so a wrong date cannot silence the check.
pub fn due(last_check: u64, now: u64) -> bool {
    last_check > now || now - last_check >= DAY_S
}

/// "v1.2.3" / "1.2.3" (a pre-release or build suffix is ignored) as numbers; anything else is None.
fn nums(v: &str) -> Option<[u64; 3]> {
    let core = v.trim().trim_start_matches('v').split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>().ok());
    let out = [it.next()??, it.next()??, it.next()??];
    it.next().is_none().then_some(out)
}

pub fn is_newer(current: &str, latest: &str) -> bool {
    matches!((nums(current), nums(latest)), (Some(c), Some(l)) if l > c)
}

/// `tag_name` and `html_url` of the reply; None for anything unexpected (wrong shape, a tag that is no version, a
/// page outside Peeka's own releases).
pub fn parse(body: &str) -> Option<Release> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let tag = v.get("tag_name")?.as_str()?;
    let url = v.get("html_url")?.as_str()?;
    nums(tag)?;
    url.starts_with(PAGE).then(|| Release { version: tag.trim_start_matches('v').to_string(), url: url.to_string() })
}

/// The notice to show for a reply: newer than `current`, and not the version already dismissed.
pub fn notice(body: &str, current: &str, dismissed: &str) -> Option<Release> {
    parse(body).filter(|r| is_newer(current, &r.version) && r.version != dismissed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPLY: &str = r#"{"tag_name":"v0.4.0","html_url":"https://github.com/isDionn/peeka/releases/tag/v0.4.0","name":"x"}"#;

    #[test]
    fn versions_compare_by_number_not_text() {
        assert!(is_newer("0.3.6", "0.4.0") && is_newer("0.3.9", "0.3.10") && is_newer("0.9.0", "1.0.0"));
        assert!(!is_newer("0.3.6", "0.3.6") && !is_newer("0.4.0", "0.3.9"));
        assert!(!is_newer("0.3.6", "nightly") && !is_newer("0.3.6", "0.4"));
    }

    #[test]
    fn a_reply_gives_version_and_page() {
        let r = parse(REPLY).unwrap();
        assert_eq!((r.version.as_str(), r.url.as_str()), ("0.4.0", "https://github.com/isDionn/peeka/releases/tag/v0.4.0"));
    }

    #[test]
    fn odd_replies_are_ignored() {
        assert!(parse("not json").is_none() && parse("{}").is_none());
        assert!(parse(r#"{"tag_name":"latest","html_url":"https://github.com/isDionn/peeka/x"}"#).is_none());
        assert!(parse(r#"{"tag_name":"v9.0.0","html_url":"https://evil.example/isDionn/peeka/"}"#).is_none());
    }

    #[test]
    fn the_notice_is_for_newer_undismissed_versions_only() {
        assert!(notice(REPLY, "0.3.6", "").is_some());
        assert!(notice(REPLY, "0.4.0", "").is_none(), "already running it");
        assert!(notice(REPLY, "0.3.6", "0.4.0").is_none(), "dismissed");
        assert!(notice(REPLY, "0.3.6", "0.3.9").is_some(), "a newer one than the dismissed one shows again");
    }

    #[test]
    fn asks_again_after_a_day_or_when_the_clock_went_back() {
        assert!(due(0, DAY_S) && !due(100, 100 + DAY_S - 1) && due(5000, 10));
    }
}
