//! Demo mode (`notch --demo`): a host that never writes `plugins.json` or the share folder,
//! with a fake main assistant already paired in process: two Claude Code sessions on the card, one waiting approval,
//! the status counts. Nothing reaches a pipe; what Notch would send the fake plugin goes nowhere.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::{Client, Host, Out, Registry};
use crate::plugins::{Scope, GUARD_MS};

/// The fake plugin's connection (no real pipe ever gets this id: real ones count up from 1).
pub const DEMO_CONN: u64 = u64::MAX;
pub const DEMO_ID: &str = "dev.example.assistant";

fn rpc(id: u64, method: &str, params: Value) -> Vec<u8> {
    json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string().into_bytes()
}

impl Host {
    /// A demo host; `data_dir` is only where the real one would write (it never does). Returns what the app must
    /// still run (the approval's alert, UI events); the consent window and every send to the fake plugin are dropped.
    pub fn demo(data_dir: PathBuf, now: u64) -> (Self, Vec<Out>) {
        // `main_seen`: no "first connection" card for a plugin that is not real.
        let mut h = Self::with(data_dir, Registry { main_seen: true, ..Registry::default() }, false);
        let mut outs = vec![];
        h.connect(DEMO_CONN, Client::default());
        let manifest = json!({"id": DEMO_ID, "name": "Sample Assistant", "publisher": "Sample", "version": "demo", "api": 1,
            "scopes": ["island.protrusion", "card.module", "approvals.prompt", "composer.handler"]});
        outs.extend(h.line(DEMO_CONN, &rpc(1, "hello", manifest), now));
        let scopes = [Scope::IslandProtrusion, Scope::CardModule, Scope::ApprovalsPrompt, Scope::ComposerHandler];
        if let Some(req) = h.consent_get(now).and_then(|c| c.request_id.parse().ok()) {
            outs.extend(h.consent_respond(req, true, Some(&scopes), true, false, now + GUARD_MS).unwrap_or_default());
        }
        let at = now + GUARD_MS;
        let card = json!({"tabs": [{"id": "cc", "title": "Claude Code", "icon": "terminal", "general": true, "blocks": [
            {"type": "list", "rows": [
                {"title": "project", "subtitle": "Running tests", "value": "4 min", "state": "info",
                 "session": "demo-session-1"},
                {"title": "notch", "subtitle": "Waiting for approval", "value": "1 min", "state": "attention",
                 "session": "demo-session-2"}]}]}],
            "summary": [{"title": "2 Claude Code sessions", "value": "running", "icon": "terminal"}]});
        let approval = json!({"id": "demo-approval", "source": "Claude Code", "title": "Wants to run a command",
            "risk": "low", "kind": "command", "command": "npm test", "cwd": "C:\\demo\\notch",
            "options": ["allow", "deny"], "expires_s": 3600});
        for (i, (method, params)) in [
            ("card.module.set", card),
            ("approvals.prompt", approval),
            ("assistant.counts.set", json!({"jobs": 2, "memory": 128, "approvals": 1})),
        ]
        .into_iter()
        .enumerate()
        {
            outs.extend(h.line(DEMO_CONN, &rpc(2 + i as u64, method, params), at));
        }
        outs.retain(|o| !matches!(o, Out::Send(..) | Out::Close(_) | Out::ConsentOpen | Out::ConsentClose));
        (h, outs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::host::{Decision, Surface};
    use crate::test_util::Tmp;

    #[test]
    fn the_demo_host_has_a_paired_fake_assistant_with_sessions_and_an_approval() {
        let tmp = Tmp::new();
        let (h, outs) = Host::demo(tmp.path().to_path_buf(), 1_000);
        assert!(h.main_connected());
        assert_eq!(h.assistant_counts().map(|c| c.approvals), Ok(1));
        assert!(outs.iter().any(|o| matches!(o, Out::AlertPut { .. })), "the approval goes into the alert list");
        assert!(!outs.iter().any(|o| matches!(o, Out::ConsentOpen | Out::Send(..))));
        // A fake session id never resolves to a pid: "Open terminal" cannot raise a stranger's window in demo.
        assert!(h.cc_session_pid("demo-session-1").is_err());
    }

    /// The brief's "fake fs": the would-be data folder is an empty temp dir; every owner action that writes in real
    /// mode is driven, and the folder must still be empty.
    #[test]
    fn demo_host_never_writes_to_the_filesystem() {
        let tmp = Tmp::new();
        let (mut h, _) = Host::demo(tmp.path().to_path_buf(), 1_000);
        let now = 10_000;
        h.approval_respond(DEMO_ID, "demo-approval", Decision::Allow, None, None, Surface::Card, now).unwrap();
        h.set_scope(DEMO_ID, Scope::CardModule, false, now).unwrap();
        h.set_scope(DEMO_ID, Scope::CardModule, true, now).unwrap();
        h.modules_set(vec![DEMO_ID.into()], vec![]).unwrap();
        h.first_connect_ack();
        h.line(DEMO_CONN, &rpc(9, "share.done", json!({"id": "0".repeat(32)})), now);
        for t in [now, now + 3_600_000] {
            h.tick(t); // the share-folder sweep
        }
        h.set_main(None).unwrap();
        h.revoke(DEMO_ID, now).unwrap();
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 0, "nothing written");
    }
}
