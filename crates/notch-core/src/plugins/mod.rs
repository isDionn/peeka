//! The plugin API (wire contract `docs/plugin-api.md`): everything that can be decided without
//! Windows. The named pipe, the SID, `GetNamedPipeClientProcessId` and `WinVerifyTrust` live in
//! `crates/notch-app/src/plugins.rs`, which only moves bytes between the pipe and [`host::Host`] and runs its [`host::Out`]s.
//!
//! Trust model: every program of this user can open the pipe, so the identity is the token the owner
//! approved, nothing else. The exe path and its signature are shown in the consent window as information only.

pub mod cc_hooks;
pub mod consent;
pub mod host;
pub mod items;
pub mod limits;
pub mod manifest;
pub mod names;
pub mod pipe;
pub mod registry;
pub mod share;

use serde::{Deserialize, Serialize};

pub const API_VERSION: u32 = 1;
/// One NDJSON line.
pub const MAX_MESSAGE: usize = 64 * 1024;
/// A `card.module.set` line may carry an image.
pub const MAX_CARD_MESSAGE: usize = 256 * 1024;
/// One `composer.submit` line to the main assistant: 256 KB of clip text plus the envelope and JSON escaping (Notch -> plugin only).
pub const MAX_SUBMIT: usize = 512 * 1024;
/// Notch -> UI decisions within this long after display are ignored (consent, approvals, plugin buttons).
pub const GUARD_MS: u64 = 300;

/// JSON-RPC error codes (docs/plugin-api.md §11).
pub mod code {
    pub const PARSE: i64 = -32700;
    pub const INVALID_REQUEST: i64 = -32600;
    pub const NO_METHOD: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    /// No `auth` yet, wrong token, or the plugin was removed.
    pub const UNAUTHORIZED: i64 = -32001;
    /// The method needs a scope this plugin was not given (or the owner turned it off).
    pub const FORBIDDEN: i64 = -32003;
    pub const TOO_LARGE: i64 = -32004;
    /// Rate limit; `data.retry_after` in seconds.
    pub const RATE: i64 = -32005;
    /// The owner said no (or the consent timed out, or "never ask again").
    pub const DENIED: i64 = -32006;
    /// Another consent window is open; `data.retry_after`.
    pub const BUSY: i64 = -32007;
    /// Only the main assistant may do this.
    pub const NOT_MAIN: i64 = -32008;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Low,
    Medium,
    High,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Scope {
    #[serde(rename = "island.protrusion")]
    IslandProtrusion,
    #[serde(rename = "card.module")]
    CardModule,
    #[serde(rename = "alerts.post")]
    AlertsPost,
    #[serde(rename = "notifications.post")]
    NotificationsPost,
    #[serde(rename = "search.provider")]
    SearchProvider,
    #[serde(rename = "composer.handler")]
    ComposerHandler,
    #[serde(rename = "voice.line")]
    VoiceLine,
    #[serde(rename = "approvals.prompt")]
    ApprovalsPrompt,
    #[serde(rename = "files.drop")]
    FilesDrop,
    #[serde(rename = "lock.signal")]
    LockSignal,
    #[serde(rename = "media.read")]
    MediaRead,
    #[serde(rename = "windows.read")]
    WindowsRead,
    #[serde(rename = "clipboard.read")]
    ClipboardRead,
    #[serde(rename = "notifications.read")]
    NotificationsRead,
}

impl Scope {
    pub const ALL: [Scope; 14] = [
        Scope::IslandProtrusion,
        Scope::CardModule,
        Scope::AlertsPost,
        Scope::NotificationsPost,
        Scope::SearchProvider,
        Scope::ComposerHandler,
        Scope::VoiceLine,
        Scope::ApprovalsPrompt,
        Scope::FilesDrop,
        Scope::LockSignal,
        Scope::MediaRead,
        Scope::WindowsRead,
        Scope::ClipboardRead,
        Scope::NotificationsRead,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Scope::IslandProtrusion => "island.protrusion",
            Scope::CardModule => "card.module",
            Scope::AlertsPost => "alerts.post",
            Scope::NotificationsPost => "notifications.post",
            Scope::SearchProvider => "search.provider",
            Scope::ComposerHandler => "composer.handler",
            Scope::VoiceLine => "voice.line",
            Scope::ApprovalsPrompt => "approvals.prompt",
            Scope::FilesDrop => "files.drop",
            Scope::LockSignal => "lock.signal",
            Scope::MediaRead => "media.read",
            Scope::WindowsRead => "windows.read",
            Scope::ClipboardRead => "clipboard.read",
            Scope::NotificationsRead => "notifications.read",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|x| x.name() == s)
    }

    /// Low and medium come checked in the consent window, high unchecked.
    pub fn level(self) -> Level {
        match self {
            Scope::IslandProtrusion | Scope::CardModule | Scope::AlertsPost | Scope::NotificationsPost => Level::Low,
            Scope::WindowsRead | Scope::ClipboardRead | Scope::NotificationsRead => Level::High,
            _ => Level::Medium,
        }
    }

    /// The consent window's plain-English line (what it can see / do).
    pub fn text(self) -> &'static str {
        match self {
            Scope::IslandProtrusion => "Can show a short line in the middle of the island",
            Scope::CardModule => "Can add up to 3 tabs to the Modules card and short rows to the General page",
            Scope::AlertsPost => "Can show short alerts and a running job",
            Scope::NotificationsPost => "Can add entries to the Notifications list",
            Scope::SearchProvider => "Can add results to Ctrl+K; sees what you type in the search",
            Scope::ComposerHandler => "Receives what you type in the Ctrl+Space box and the attachments you add, and writes the reply",
            Scope::VoiceLine => "Can show the voice line below the strip and the live transcript",
            Scope::ApprovalsPrompt => {
                "Can ask for your approval; the plugin states the risk level and Peeka cannot verify it"
            }
            Scope::FilesDrop => "Receives the paths of files you drop on the island, only at the moment you drop them",
            Scope::LockSignal => "Can lock Peeka (only you can unlock it)",
            Scope::MediaRead => "Sees the title and artist of the playing track",
            Scope::WindowsRead => "Sees the titles of open windows",
            Scope::ClipboardRead => "Sees the clipboard history (never passwords)",
            Scope::NotificationsRead => "Sees Windows notifications",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_names_round_trip_through_serde_and_parse() {
        for s in Scope::ALL {
            assert_eq!(Scope::parse(s.name()), Some(s));
            assert_eq!(serde_json::to_value(s).unwrap(), s.name());
        }
        assert_eq!(Scope::parse("keyboard.read"), None);
        assert_eq!(Scope::ClipboardRead.level(), Level::High);
        assert_eq!(Scope::IslandProtrusion.level(), Level::Low);
        assert_eq!(Scope::ComposerHandler.level(), Level::Medium);
    }
}
