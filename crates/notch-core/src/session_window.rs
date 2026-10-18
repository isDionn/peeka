//! "Terminali aç": from a Claude Code session's process, walk up the process tree to the terminal or editor that
//! owns its window (Windows Terminal, VS Code, conhost's host shell…). The pid comes only from the main assistant
//! (`cc.sessions.set`, `plugins::host::assistant`), never from the page. The OS calls live in
//! `notch_win::session_window`; this file is the rule, tested on fixed process tables.
//!
//! Adapted from CouCou (`windows/src-tauri/src/session_window.rs`, commit ff825663a959faf09310b571c6c8245d7e7cd1ee,
//! MIT, Copyright (c) 2026 Louis Raillé; see `docs/THIRD_PARTY_NOTICES.md`): the Windows tree tops, the depth cap,
//! the loop guard and "the nearest ancestor that owns a window".

use std::collections::HashMap;

/// One process as a snapshot lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    pub parent: u32,
    /// The executable's file name as the snapshot gives it (`Code.exe`).
    pub exe: String,
}

/// Never the window of a session: the desktop shell and the services at the top of every tree. Reaching one means
/// the terminal window was no ancestor (a classic console's window belongs to conhost), and raising the taskbar
/// would be wrong.
const TREE_TOPS: &[&str] = &[
    "explorer.exe",
    "services.exe",
    "wininit.exe",
    "winlogon.exe",
    "svchost.exe",
    "smss.exe",
    "csrss.exe",
    "system",
    "sihost.exe",
    "userinit.exe",
];

/// How far up we look; a session sits a handful of levels below its window.
pub const MAX_DEPTH: usize = 16;

/// The process itself and then its ancestors, nearest first, stopping before a tree top. The session's own process
/// comes first: `claude` started straight from a terminal may own nothing, but an editor-hosted one might. A loop in
/// the parent links (a parent id reused by a newer process) or a missing parent ends the walk.
pub fn lineage(procs: &HashMap<u32, Proc>, start: u32) -> Vec<u32> {
    let Some(first) = procs.get(&start) else { return vec![] };
    if is_top(first) {
        return vec![];
    }
    let mut out = vec![start];
    let mut current = start;
    while out.len() <= MAX_DEPTH {
        let Some(proc) = procs.get(&current) else { break };
        let parent = proc.parent;
        if parent == 0 || out.contains(&parent) {
            break;
        }
        let Some(up) = procs.get(&parent) else { break };
        if is_top(up) {
            break;
        }
        out.push(parent);
        current = parent;
    }
    out
}

fn is_top(p: &Proc) -> bool {
    TREE_TOPS.contains(&p.exe.to_ascii_lowercase().as_str())
}

/// The nearest process in the lineage that owns a top-level window: the terminal or the editor.
pub fn window_owner(procs: &HashMap<u32, Proc>, start: u32, has_window: impl Fn(u32) -> bool) -> Option<u32> {
    lineage(procs, start).into_iter().find(|pid| has_window(*pid))
}

/// A session id as Claude Code sends it (a UUID): ASCII letters, digits, `-` and `_`, at most 128 characters.
pub fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(entries: &[(u32, u32, &str)]) -> HashMap<u32, Proc> {
        entries.iter().map(|(pid, parent, exe)| (*pid, Proc { parent: *parent, exe: exe.to_string() })).collect()
    }

    #[test]
    fn windows_terminal_is_found_above_the_shells() {
        // explorer -> WindowsTerminal -> pwsh -> node (claude)
        let procs = tree(&[
            (4, 0, "System"),
            (100, 4, "explorer.exe"),
            (200, 100, "WindowsTerminal.exe"),
            (300, 200, "pwsh.exe"),
            (400, 300, "node.exe"),
        ]);
        assert_eq!(lineage(&procs, 400), [400, 300, 200]);
        assert_eq!(window_owner(&procs, 400, |pid| pid == 200 || pid == 100), Some(200));
    }

    #[test]
    fn vs_code_is_found_through_its_pty_host() {
        let procs = tree(&[
            (100, 1, "explorer.exe"),
            (210, 100, "Code.exe"),
            (220, 210, "Code.exe"),
            (300, 220, "powershell.exe"),
            (400, 300, "claude.exe"),
        ]);
        assert_eq!(window_owner(&procs, 400, |pid| pid == 210), Some(210));
    }

    #[test]
    fn conhost_and_other_hosts_own_the_window_when_they_are_ancestors() {
        // A console started by a launcher that is its own host (conhost / OpenConsole / WezTerm / Alacritty).
        for host in ["conhost.exe", "OpenConsole.exe", "wezterm-gui.exe", "alacritty.exe", "Hyper.exe"] {
            let procs =
                tree(&[(100, 1, "explorer.exe"), (150, 100, host), (300, 150, "cmd.exe"), (400, 300, "node.exe")]);
            assert_eq!(window_owner(&procs, 400, |pid| pid == 150), Some(150), "{host}");
        }
    }

    #[test]
    fn a_classic_console_finds_nothing_rather_than_the_desktop() {
        // cmd.exe's window belongs to a conhost that is no ancestor: the walk stops at explorer.
        let procs = tree(&[(100, 1, "explorer.exe"), (300, 100, "cmd.exe"), (400, 300, "node.exe")]);
        assert_eq!(window_owner(&procs, 400, |pid| pid == 100), None);
        assert_eq!(lineage(&procs, 100), Vec::<u32>::new(), "a tree top is never a session's window");
    }

    #[test]
    fn a_missing_parent_a_gone_process_and_a_loop_end_the_walk() {
        assert!(lineage(&tree(&[]), 600).is_empty(), "the session's process is gone");
        let orphan = tree(&[(300, 999, "pwsh.exe"), (400, 300, "node.exe")]);
        assert_eq!(lineage(&orphan, 400), [400, 300], "parent 999 is not in the table");
        let looped = tree(&[(1, 2, "a.exe"), (2, 1, "b.exe"), (3, 1, "node.exe")]);
        assert_eq!(lineage(&looped, 3), [3, 1, 2]);
        let self_parent = tree(&[(7, 7, "x.exe")]);
        assert_eq!(lineage(&self_parent, 7), [7]);
        let deep: Vec<(u32, u32, &str)> = (1..100).map(|i| (i, i + 1, "x.exe")).collect();
        assert_eq!(lineage(&tree(&deep), 1).len(), MAX_DEPTH + 1);
    }

    #[test]
    fn session_ids_are_plain() {
        assert!(valid_session("0b1c2d3e-aaaa-bbbb-cccc-1234567890ab"));
        assert!(
            !valid_session("") && !valid_session("a/../b") && !valid_session("a b") && !valid_session(&"x".repeat(129))
        );
    }
}
