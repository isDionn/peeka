//! The consent window's rules. Rust decides, the page only shows: "Reddet" is what happens unless
//! the owner grants; a decision within 300 ms of the page first showing the request is ignored; no decision within
//! 2 minutes of showing (10 minutes when the window could not open, e.g. fullscreen) is a "Reddet"; high-risk scopes
//! are granted only when the owner ticked them; "main assistant" is the owner's tick, never the plugin's.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::manifest::Manifest;
use super::{Level, Scope, GUARD_MS};

pub const TIMEOUT_MS: u64 = 120_000;
/// The window never opened (fullscreen the whole time): the plugin gets its "no" after this.
pub const UNSHOWN_TIMEOUT_MS: u64 = 600_000;

/// What `WinVerifyTrust` said about the client's exe; shown only, never trusted.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Signature {
    Signed {
        by: String,
    },
    Unsigned,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Client {
    /// Full path from `GetNamedPipeClientProcessId` (spoofable: shown with "unverified").
    pub exe: Option<String>,
    pub signature: Signature,
}

#[derive(Debug)]
pub struct Consent {
    pub request: u64,
    pub conn: u64,
    /// The `hello`'s JSON-RPC id: the answer goes there.
    pub rpc_id: serde_json::Value,
    pub manifest: Manifest,
    pub client: Client,
    pub created: u64,
    pub displayed: Option<u64>,
    pub lookalike: Option<String>,
    /// Same id paired before: its old scopes come pre-ticked, its old token stops working on "Allow".
    pub previous: BTreeSet<Scope>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Answer {
    /// Too early (or the page never showed it): nothing happens, the window stays.
    Ignored,
    Deny {
        never_ask: bool,
    },
    Allow {
        scopes: BTreeSet<Scope>,
        main: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeLine {
    pub scope: Scope,
    pub level: Level,
    pub text: &'static str,
    /// How the box comes: low/medium ticked, high not (unless granted before).
    pub checked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConsentPlugin {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    /// "" when Windows did not say (an elevated or vanished client).
    pub path: String,
    /// The signer; None = unsigned or not checkable.
    pub signed_by: Option<String>,
    /// signed | unsigned | unknown (extra: tells "Unsigned" from "could not check").
    pub signature: &'static str,
}

/// `consent_get` payload, plugin-api.ts `ConsentRequest` (fixed sentences are the page's own); the fields after
/// `expiresAt` are extra.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentView {
    pub request_id: String,
    pub plugin: ConsentPlugin,
    pub program: Program,
    /// The paired plugin or reserved name this one looks like (the orange warning).
    pub lookalike: Option<String>,
    pub scopes: Vec<Scope>,
    pub why: BTreeMap<Scope, String>,
    /// Unix ms when it counts as "Reddet".
    pub expires_at: u64,
    /// The initial-letter tile Notch draws (the plugin cannot send an icon).
    pub initial: String,
    /// Same id paired before (its old token stops working on "Allow").
    pub repair: bool,
    pub lines: Vec<ScopeLine>,
    /// Show "Make main assistant?" (unticked): the plugin asked for composer.handler or voice.line.
    pub ask_main: bool,
    pub guard_ms: u64,
}

impl Consent {
    fn checked(&self, s: Scope) -> bool {
        s.level() != Level::High || self.previous.contains(&s)
    }

    /// The page shows it now: the 300 ms guard and the 2 minutes start at the first call.
    pub fn view(&mut self, now: u64) -> ConsentView {
        let shown = *self.displayed.get_or_insert(now);
        let m = &self.manifest;
        let (signed_by, signature) = match &self.client.signature {
            Signature::Signed { by } => (Some(by.clone()), "signed"),
            Signature::Unsigned => (None, "unsigned"),
            Signature::Unknown => (None, "unknown"),
        };
        ConsentView {
            request_id: self.request.to_string(),
            plugin: ConsentPlugin {
                id: m.id.clone(),
                name: m.name.clone(),
                publisher: m.publisher.clone(),
                version: m.version.clone(),
            },
            program: Program { path: self.client.exe.clone().unwrap_or_default(), signed_by, signature },
            lookalike: self.lookalike.clone(),
            scopes: m.scopes.clone(),
            why: m.why.clone(),
            expires_at: shown + TIMEOUT_MS,
            initial: m
                .name
                .chars()
                .find(|c| c.is_alphanumeric())
                .map(|c| c.to_uppercase().collect())
                .unwrap_or_default(),
            repair: !self.previous.is_empty(),
            lines: m
                .scopes
                .iter()
                .map(|&s| ScopeLine { scope: s, level: s.level(), text: s.text(), checked: self.checked(s) })
                .collect(),
            ask_main: m.scopes.iter().any(|s| matches!(s, Scope::ComposerHandler | Scope::VoiceLine)),
            guard_ms: GUARD_MS,
        }
    }

    /// The owner's click. `scopes` = the ticked boxes (None = the boxes as they came). Only requested scopes can be
    /// granted; `main` only together with composer.handler.
    pub fn answer(&self, allow: bool, scopes: Option<&[Scope]>, main: bool, never_ask: bool, now: u64) -> Answer {
        match self.displayed {
            Some(t) if now >= t + GUARD_MS => {}
            _ => return Answer::Ignored,
        }
        if !allow {
            return Answer::Deny { never_ask };
        }
        let asked = &self.manifest.scopes;
        let scopes: BTreeSet<Scope> = match scopes {
            Some(list) => list.iter().copied().filter(|s| asked.contains(s)).collect(),
            None => asked.iter().copied().filter(|&s| self.checked(s)).collect(),
        };
        if scopes.is_empty() {
            return Answer::Deny { never_ask };
        }
        let main = main && scopes.contains(&Scope::ComposerHandler);
        Answer::Allow { scopes, main }
    }

    pub fn timed_out(&self, now: u64) -> bool {
        match self.displayed {
            Some(t) => now >= t + TIMEOUT_MS,
            None => now >= self.created + UNSHOWN_TIMEOUT_MS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest;
    use serde_json::json;

    fn consent(scopes: &[&str]) -> Consent {
        let m = manifest::parse(&json!({"id":"com.example.a","name":"élan","publisher":"x","version":"1","api":1,
                                        "scopes":scopes}))
        .unwrap();
        Consent {
            request: 1,
            conn: 1,
            rpc_id: json!(1),
            manifest: m,
            client: Client::default(),
            created: 0,
            displayed: None,
            lookalike: None,
            previous: BTreeSet::new(),
        }
    }

    #[test]
    fn a_decision_within_300_ms_of_display_or_before_display_is_ignored() {
        let mut c = consent(&["island.protrusion"]);
        assert_eq!(c.answer(true, None, false, false, 5_000), Answer::Ignored, "never shown");
        c.view(10_000);
        c.view(10_200); // a second call does not restart the clock
        assert_eq!(c.answer(true, None, false, false, 10_299), Answer::Ignored);
        assert_eq!(c.answer(false, None, false, false, 10_100), Answer::Ignored, "even Reddet");
        assert!(matches!(c.answer(true, None, false, false, 10_300), Answer::Allow { .. }));
    }

    #[test]
    fn timeout_is_two_minutes_after_display_and_counts_as_deny() {
        let mut c = consent(&["island.protrusion"]);
        assert!(!c.timed_out(599_999) && c.timed_out(600_000), "never shown: 10 min");
        c.view(1_000);
        assert!(!c.timed_out(120_999) && c.timed_out(121_000));
    }

    #[test]
    fn high_risk_is_off_unless_ticked_and_nothing_unrequested_is_granted() {
        let mut c = consent(&["island.protrusion", "clipboard.read", "composer.handler"]);
        let v = c.view(0);
        assert_eq!(v.initial, "É");
        assert!(v.ask_main);
        let ticked: Vec<_> = v.lines.iter().filter(|l| l.checked).map(|l| l.scope).collect();
        assert_eq!(ticked, [Scope::IslandProtrusion, Scope::ComposerHandler]);
        let Answer::Allow { scopes, main } = c.answer(true, None, false, false, 500) else { panic!() };
        assert!(!scopes.contains(&Scope::ClipboardRead) && !main, "defaults never hold a high scope");
        let picked = [Scope::ClipboardRead, Scope::WindowsRead, Scope::IslandProtrusion];
        let Answer::Allow { scopes, .. } = c.answer(true, Some(&picked), false, false, 500) else { panic!() };
        assert_eq!(scopes, [Scope::IslandProtrusion, Scope::ClipboardRead].into(), "windows.read was not asked");
        let Answer::Allow { main, .. } = c.answer(true, Some(&[Scope::IslandProtrusion]), true, false, 500) else {
            panic!()
        };
        assert!(!main, "main assistant needs composer.handler");
        assert_eq!(c.answer(true, Some(&[]), false, true, 500), Answer::Deny { never_ask: true });
    }
}
