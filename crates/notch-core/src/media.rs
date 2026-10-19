//! Now playing: the shape `media_changed` / `get_media` carry and the commands the page may
//! send. The SMTC reader is `notch-win::media`.
//!

use serde::{Deserialize, Serialize};

/// None on the wire (`null`) = nothing is playing or paused anywhere.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// "Spotify", "Chrome"...
    pub app: String,
    /// The cover as a `data:image/...;base64,` URL; None until the player publishes one.
    pub art: Option<String>,
    pub playing: bool,
    /// Where playback was at `position_at` (Unix ms); the page projects it forward while `playing`.
    pub position_ms: u64,
    pub position_at: u64,
    /// 0 = the player gives no timeline (no seek bar).
    pub duration_ms: u64,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
    /// Needs `positionMs`.
    Seek,
}

/// Demo cover: an orange-to-violet gradient with a sun (percent-encoded SVG, no file).
const DEMO_COVER: &str = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%23ffb347'/><stop offset='1' stop-color='%23ff5e62'/></linearGradient></defs><rect width='120' height='120' fill='url(%23g)'/><circle cx='60' cy='52' r='20' fill='%23fff1d6'/><path d='M0 92 Q30 74 60 88 T120 84 V120 H0Z' fill='rgba(80,20,110,.7)'/></svg>";

/// Demo mode's "now playing" (no player is asked; the controls change nothing).
pub fn demo(now_ms: u64) -> Media {
    Media {
        // long enough to scroll in the island, with a cover so the card shows its cover-colour light
        title: "Night Walk Through the Quiet City (Extended Mix)".into(),
        artist: "Demo Artist".into(),
        album: "Peeka Demo".into(),
        app: "Spotify".into(),
        art: Some(DEMO_COVER.into()),
        playing: true,
        position_ms: 42_000,
        position_at: now_ms,
        // shortcut: set once at launch, so the track stops at its end after ~9 min; loop it if demos run longer
        duration_ms: 581_000,
        can_next: true,
        can_previous: true,
        can_seek: true,
    }
}

/// The timeline Windows reports is stale between updates: advance it to `now` while playing, capped at the track length.
pub fn project(position_ms: u64, updated_ms: u64, now: u64, playing: bool, duration_ms: u64) -> u64 {
    let p = if playing && updated_ms > 0 && updated_ms < now { position_ms + (now - updated_ms) } else { position_ms };
    if duration_ms > 0 {
        p.min(duration_ms)
    } else {
        p
    }
}

/// The player's AppUserModelID -> a short display name (first table row whose key the id contains wins).
pub fn app_name(app_id: &str) -> String {
    const NAMES: &[(&str, &str)] = &[
        // players
        ("spotify", "Spotify"),
        ("applemusic", "Apple Music"),
        ("zunemusic", "Media Player"),
        ("deezer", "Deezer"),
        ("tidal", "TIDAL"),
        ("vlc", "VLC"),
        // browsers (Firefox publishes a hashed id)
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("youtube", "YouTube Music"),
    ];
    let lower = app_id.to_lowercase();
    if let Some((_, name)) = NAMES.iter().find(|(key, _)| lower.contains(key)) {
        return (*name).to_string();
    }
    // Unknown player: the last path or package segment, without a trailing ".exe".
    let tail = app_id.split(['\\', '!']).next_back().unwrap_or(app_id);
    match tail.len().checked_sub(4) {
        Some(cut) if tail.is_char_boundary(cut) && tail[cut..].eq_ignore_ascii_case(".exe") => tail[..cut].to_string(),
        _ => tail.to_string(),
    }
}

/// shortcut: covers above 2 MB are dropped (no player sends one that big); downscaling would need an image crate.
pub const MAX_ART_BYTES: usize = 2 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_moves_only_while_playing_and_stops_at_the_end() {
        assert_eq!(project(10_000, 1_000, 3_000, true, 0), 12_000);
        assert_eq!(project(10_000, 1_000, 3_000, false, 0), 10_000);
        assert_eq!(project(10_000, 0, 3_000, true, 0), 10_000, "no update time");
        assert_eq!(project(10_000, 5_000, 3_000, true, 0), 10_000, "an update from the future");
        assert_eq!(project(10_000, 1_000, 9_000, true, 15_000), 15_000);
    }

    #[test]
    fn app_names() {
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(app_name("308046B0AF4A39CB"), "Firefox");
        assert_eq!(app_name("C:\\Apps\\foobar2000.exe"), "foobar2000");
        assert_eq!(app_name("Pkg_123!App"), "App");
    }

    #[test]
    fn actions_parse_and_media_serialises_camel_case() {
        assert_eq!(serde_json::from_str::<MediaAction>(r#""play_pause""#).unwrap(), MediaAction::PlayPause);
        assert!(serde_json::from_str::<MediaAction>(r#""stop""#).is_err());
        let v = serde_json::to_value(Media::default()).unwrap();
        assert!(v["positionMs"].is_number() && v["canPrevious"].is_boolean() && v["art"].is_null());
    }
}
