// Peeka — original implementation (MIT).
//! "Open terminal": which process above a Claude Code session owns the window the owner sees it in (a terminal,
//! an editor, a console host). The session pid is supplied by the main assistant (`cc.sessions.set`,
//! `plugins::host::assistant`), never by the page. This module only decides, on a process table handed to it; the
//! Windows snapshot and window list are in `notch_win::session_window`.

use std::collections::HashMap;

/// A row of the process table: parent pid and exe file name (no path).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    pub parent: u32,
    pub exe: String,
}

/// Processes every tree hangs from (desktop shell, session and service hosts). The climb stops below them: if the
/// window was not found by then, it belongs to something outside the session's ancestry.
const TREE_TOPS: [&str; 10] = [
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

/// Most ancestors `lineage` climbs past the start; sessions are only a few levels under their window.
pub const MAX_DEPTH: usize = 16;

fn tree_top(exe: &str) -> bool {
    TREE_TOPS.iter().any(|t| t.eq_ignore_ascii_case(exe))
}

/// `start` and then its parent, grandparent… nearest first. Empty when `start` is unknown or itself a tree top; the
/// climb ends at pid 0, a parent missing from the table, a pid already seen, or a tree top (left out).
pub fn lineage(procs: &HashMap<u32, Proc>, start: u32) -> Vec<u32> {
    let Some(first) = procs.get(&start).filter(|p| !tree_top(&p.exe)) else { return Vec::new() };
    let mut chain = vec![start];
    let mut next = first.parent;
    while chain.len() <= MAX_DEPTH && next != 0 && !chain.contains(&next) {
        match procs.get(&next) {
            Some(p) if !tree_top(&p.exe) => {
                chain.push(next);
                next = p.parent;
            }
            _ => break,
        }
    }
    chain
}

/// First pid of the lineage, nearest first, for which `has_window` holds.
pub fn window_owner(procs: &HashMap<u32, Proc>, start: u32, has_window: impl Fn(u32) -> bool) -> Option<u32> {
    lineage(procs, start).into_iter().find(|&pid| has_window(pid))
}

/// Accepts a plain session id (a UUID in practice): 1 to 128 ASCII letters, digits, `-` or `_`.
pub fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
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
