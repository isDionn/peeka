//! The Modules card's Claude chat: a plain conversation through the owner's own Claude Code CLI (their subscription,
//! no API key), in headless print mode. This file holds the pure parts: where the CLI is, its argument list and
//! the reading of its `stream-json` lines. Spawning, killing and events live in `crates/notch-app/src/claude_chat.rs`.
//!
//! Flags (https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/headless):
//! `-p --output-format stream-json --verbose --include-partial-messages` streams text deltas; `--tools ""` removes
//! every built-in tool, `--strict-mcp-config` (no `--mcp-config`) and `--disallowedTools mcp__*` every MCP tool,
//! `--permission-mode dontAsk` denies anything that would prompt, `--disable-slash-commands` keeps a typed `/name`
//! from running a skill, `--system-prompt` replaces the coding-agent prompt, `--settings <file>` turns the owner's
//! hooks off (Peeka's own Claude Code hook would otherwise report the chat as a coding session), `--resume <id>`
//! continues the conversation. The owner's text goes in on stdin, never on the command line.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// Longest message the UI may send (characters).
pub const MAX_TEXT: usize = 8000;
/// A request is killed after this long.
pub const TIMEOUT_SECS: u64 = 180;
/// What `--settings` gets (written next to the working folder).
pub const SETTINGS_JSON: &str = r#"{"disableAllHooks":true}"#;
/// No quotes: it is passed as one argument.
pub const SYSTEM_PROMPT: &str = "You are Claude, chatting with the user in a small chat panel of their desktop app. \
You have no tools and cannot see their screen or files. Reply in plain text without Markdown headings or tables, \
keep answers short unless asked for detail, and answer in the language the user writes in.";

/// How to start the CLI: its own exe, or Node with the npm package's script (a `.cmd` shim is never run: that
/// would go through cmd.exe).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cli {
    Exe(PathBuf),
    Node { node: PathBuf, script: PathBuf },
}

impl Cli {
    pub fn program(&self) -> &Path {
        match self {
            Cli::Exe(p) => p,
            Cli::Node { node, .. } => node,
        }
    }

    /// Arguments that come before the CLI's own.
    pub fn prefix(&self) -> Vec<OsString> {
        match self {
            Cli::Exe(_) => vec![],
            Cli::Node { script, .. } => vec![script.clone().into_os_string()],
        }
    }
}

/// The environment `find_cli` reads (`std::env::var_os` in the app; fixed values in tests).
#[derive(Default)]
pub struct Env {
    pub user_profile: Option<PathBuf>,
    pub app_data: Option<PathBuf>,
    pub program_files: Option<PathBuf>,
    pub path: Option<OsString>,
}

impl Env {
    pub fn from_process() -> Self {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        Env {
            user_profile: var("USERPROFILE"),
            app_data: var("APPDATA"),
            program_files: var("ProgramFiles"),
            path: std::env::var_os("PATH"),
        }
    }
}

/// The native installer's exe, then a `claude.exe` on PATH, then the npm package run by `node.exe`.
pub fn find_cli(env: &Env) -> Option<Cli> {
    let dirs: Vec<PathBuf> = env.path.as_ref().map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    let native = env.user_profile.as_ref().map(|u| u.join(".local").join("bin").join("claude.exe"));
    if let Some(exe) = native.into_iter().chain(dirs.iter().map(|d| d.join("claude.exe"))).find(|p| p.is_file()) {
        return Some(Cli::Exe(exe));
    }
    let script = env.app_data.as_ref()?.join("npm/node_modules/@anthropic-ai/claude-code/cli.js");
    if !script.is_file() {
        return None;
    }
    let node = dirs
        .iter()
        .map(|d| d.join("node.exe"))
        .chain(env.program_files.as_ref().map(|p| p.join("nodejs").join("node.exe")))
        .find(|p| p.is_file())?;
    Some(Cli::Node { node, script })
}

/// The CLI's arguments for one turn. `session` (from the previous turn's stream) is used only if it looks like the
/// UUID the CLI gave.
pub fn args(session: Option<&str>, settings: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> = [
        "-p",
        // Sonnet: quick and cheap for a small island chat.
        "--model",
        "sonnet",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--disallowedTools",
        "mcp__*",
        "--strict-mcp-config",
        "--permission-mode",
        "dontAsk",
        "--disable-slash-commands",
        "--system-prompt",
        SYSTEM_PROMPT,
        "--settings",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    a.push(settings.as_os_str().to_owned());
    if let Some(id) = session.filter(|s| is_session_id(s)) {
        a.push("--resume".into());
        a.push(id.into());
    }
    a
}

fn is_session_id(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The owner's message as sent on stdin: trimmed, not empty, at most `MAX_TEXT` characters (longer is refused,
/// not cut: the UI caps the box).
pub fn check_text(text: &str) -> Option<&str> {
    let t = text.trim();
    (!t.is_empty() && t.chars().count() <= MAX_TEXT).then_some(t)
}

/// One `stream-json` line, as far as the chat cares.
#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    /// The session id (first in `system/init`; every line carries it).
    Session(String),
    /// Reply text as it streams.
    Delta(String),
    /// The last line: `ok` false carries the CLI's error text (sign-in, limits...).
    Done { ok: bool, text: String, session: Option<String> },
}

/// Everything else (whole `assistant` messages, thinking, status, retries) is None: the text already came as deltas.
pub fn parse_line(line: &str) -> Option<Line> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let session = || v["session_id"].as_str().map(str::to_string);
    match v["type"].as_str()? {
        "stream_event" => {
            let e = &v["event"];
            (e["type"] == "content_block_delta" && e["delta"]["type"] == "text_delta")
                .then(|| e["delta"]["text"].as_str().map(|t| Line::Delta(t.to_string())))
                .flatten()
        }
        "result" => Some(Line::Done {
            ok: v["is_error"] == false && v["subtype"] == "success",
            text: v["result"].as_str().unwrap_or_default().to_string(),
            session: session(),
        }),
        "system" if v["subtype"] == "init" => session().map(Line::Session),
        _ => None,
    }
}

/// `claude --version` prints e.g. `2.1.290 (Claude Code)`: the number only.
pub fn version_of(out: &str) -> Option<String> {
    let v = out.split_whitespace().next()?;
    v.chars().all(|c| c.is_ascii_digit() || c == '.').then(|| v.to_string())
}

/// Demo mode's reply, streamed in these pieces.
pub fn demo_reply(text: &str) -> Vec<String> {
    let reply = if text.to_lowercase().contains("hi") || text.to_lowercase().contains("hello") {
        "Hi! This is a demo reply. With Claude Code installed and signed in, your messages go to Claude when you press Send."
    } else {
        "This is a demo reply, so nothing was sent. In the real app Peeka asks your Claude Code to answer, using your own subscription."
    };
    reply.split_inclusive(' ').map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    // Lines from a real `claude -p` run (2.1.290), trimmed, and the docs' delta shape.
    const INIT: &str = r#"{"type":"system","subtype":"init","cwd":"C:\\t","session_id":"a16e38e3-2eaf-4df6-b3eb-fb64be7d4eca","tools":[],"mcp_servers":[],"permissionMode":"dontAsk"}"#;
    const DELTA: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}},"session_id":"a16e38e3-2eaf-4df6-b3eb-fb64be7d4eca"}"#;
    const THINK: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hm"}}}"#;
    const ASSISTANT: &str = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]},"session_id":"a16e38e3-2eaf-4df6-b3eb-fb64be7d4eca"}"#;
    const ERROR: &str = r#"{"duration_api_ms":0,"session_id":"a16e38e3-2eaf-4df6-b3eb-fb64be7d4eca","is_error":true,"num_turns":1,"subtype":"success","result":"Failed to refresh OAuth token","type":"result"}"#;
    const OK: &str = r#"{"type":"result","subtype":"success","is_error":false,"result":"Hi there","session_id":"a16e38e3-2eaf-4df6-b3eb-fb64be7d4eca"}"#;
    const SID: &str = "a16e38e3-2eaf-4df6-b3eb-fb64be7d4eca";

    #[test]
    fn stream_lines() {
        assert_eq!(parse_line(INIT), Some(Line::Session(SID.into())));
        assert_eq!(parse_line(DELTA), Some(Line::Delta("Hi".into())));
        assert_eq!(parse_line(THINK), None);
        assert_eq!(parse_line(ASSISTANT), None, "the text already came as deltas");
        assert_eq!(parse_line(OK), Some(Line::Done { ok: true, text: "Hi there".into(), session: Some(SID.into()) }));
        assert_eq!(
            parse_line(ERROR),
            Some(Line::Done { ok: false, text: "Failed to refresh OAuth token".into(), session: Some(SID.into()) })
        );
        assert_eq!(parse_line("not json"), None);
        assert_eq!(parse_line(r#"{"type":"system","subtype":"status"}"#), None);
    }

    #[test]
    fn arguments_never_carry_the_message_and_take_only_a_real_session() {
        let a = args(Some(SID), Path::new("C:\\t\\settings.json"));
        let s: Vec<String> = a.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        for want in ["-p", "--strict-mcp-config", "--disable-slash-commands", "dontAsk", "--include-partial-messages"] {
            assert!(s.iter().any(|x| x == want), "{want}");
        }
        let tools = s.iter().position(|x| x == "--tools").unwrap();
        assert_eq!(s[tools + 1], "", "no built-in tools");
        let model = s.iter().position(|x| x == "--model").unwrap();
        assert_eq!(s[model + 1], "sonnet");
        assert_eq!(&s[s.len() - 2..], ["--resume", SID]);
        // a forged id from a line never becomes an argument
        for bad in ["--dangerously-skip-permissions", "a16e38e3-2eaf-4df6-b3eb-fb64be7d4ec\"", "x; rm"] {
            let s = args(Some(bad), Path::new("s.json"));
            assert!(!s.iter().any(|x| x == "--resume" || x.to_string_lossy() == bad), "{bad}");
        }
        assert!(!SYSTEM_PROMPT.contains('"'));
    }

    #[test]
    fn message_checks() {
        assert_eq!(check_text("  hi \n"), Some("hi"));
        assert_eq!(check_text("   "), None);
        assert!(check_text(&"é".repeat(MAX_TEXT)).is_some());
        assert_eq!(check_text(&"a".repeat(MAX_TEXT + 1)), None);
        assert_eq!(version_of("2.1.290 (Claude Code)\n").as_deref(), Some("2.1.290"));
        assert_eq!(version_of("error: x"), None);
        assert!(demo_reply("hello").concat().starts_with("Hi!"));
    }

    #[test]
    fn finds_the_cli_and_never_a_cmd_shim() {
        let t = Tmp::new();
        let bin = t.path().join("bin");
        let env = |p: &Tmp| Env {
            user_profile: Some(p.path().join("home")),
            app_data: Some(p.path().join("roaming")),
            program_files: Some(p.path().join("pf")),
            path: Some(std::env::join_paths([bin.clone()]).unwrap()),
        };
        assert_eq!(find_cli(&env(&t)), None);
        // only the npm shim: never the .cmd, Node + the script instead (once node is found)
        t.write("roaming/npm/claude.cmd", b"@node cli.js %*");
        t.write("bin/claude.cmd", b"x");
        let script = t.write("roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js", b"");
        assert_eq!(find_cli(&env(&t)), None, "no node");
        let node = t.write("pf/nodejs/node.exe", b"");
        assert_eq!(find_cli(&env(&t)), Some(Cli::Node { node: node.clone(), script: script.clone() }));
        let cli = find_cli(&env(&t)).unwrap();
        assert_eq!(cli.program(), node);
        assert_eq!(cli.prefix().iter().map(PathBuf::from).collect::<Vec<_>>(), [script]);
        // a claude.exe on PATH wins over npm, the native installer's over PATH
        let on_path = t.write("bin/claude.exe", b"");
        assert_eq!(find_cli(&env(&t)), Some(Cli::Exe(on_path)));
        let native = t.write("home/.local/bin/claude.exe", b"");
        assert_eq!(find_cli(&env(&t)), Some(Cli::Exe(native)));
    }
}
