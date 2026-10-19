//! The Claude chat tab: one `claude -p` process per message (arguments: `notch_core::claude_chat`), started with no
//! console in an empty folder under %TEMP%, the message written to its stdin. Its stream becomes `claude_chat_delta`
//! (`{text}`) events and one `claude_chat_done` (`{ok, error, stopped}`). One request at a time; Stop, a new chat,
//! the timeout and quitting kill it. Only the CLI's session id is kept (memory); the CLI itself saves the
//! conversation like any Claude Code session (`~/.claude/projects/...`).

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use notch_core::claude_chat::{self as chat, Line};
use notch_core::cmd::CmdError;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Longest error text the card shows.
const MAX_ERROR: usize = 300;

struct Inner {
    /// Bumped by every send, stop and new chat: a thread from an older request emits nothing.
    gen: u64,
    busy: bool,
    child: Option<Child>,
    session: Option<String>,
}

static CHAT: Mutex<Inner> = Mutex::new(Inner { gen: 0, busy: false, child: None, session: None });

/// bridge.ts `ClaudeChatState`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub available: bool,
    pub version: Option<String>,
    pub signed_in: bool,
    pub busy: bool,
}

#[derive(Clone, Serialize)]
struct Done {
    ok: bool,
    error: Option<String>,
    stopped: bool,
}

/// Cheap checks only (no tokens): `--version` and `auth status` (exit code 0 = signed in; its output is not read).
pub fn state() -> State {
    let busy = CHAT.lock().busy;
    if crate::app::demo() {
        return State { available: true, version: Some("demo".into()), signed_in: true, busy };
    }
    let Some(cli) = chat::find_cli(&chat::Env::from_process()) else {
        return State { available: false, version: None, signed_in: false, busy };
    };
    let run = |args: &[&str]| {
        Command::new(cli.program())
            .args(cli.prefix())
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
    };
    let version = run(&["--version"]).and_then(|o| chat::version_of(&String::from_utf8_lossy(&o.stdout)));
    let signed_in = run(&["auth", "status"]).is_some_and(|o| o.status.success());
    State { available: version.is_some(), version, signed_in, busy }
}

pub fn send(app: &AppHandle, text: &str) -> Result<(), CmdError> {
    let text = chat::check_text(text).ok_or(CmdError::Invalid)?.to_string();
    let mut c = CHAT.lock();
    if c.busy {
        return Err(CmdError::Refused);
    }
    if crate::app::demo() {
        c.gen += 1;
        c.busy = true;
        let (gen, app) = (c.gen, app.clone());
        std::thread::spawn(move || demo(&app, gen, &text));
        return Ok(());
    }
    let cli = chat::find_cli(&chat::Env::from_process()).ok_or(CmdError::Missing)?;
    let dir = std::env::temp_dir().join(format!("{}-claude-chat", notch_core::CODE_NAME));
    let cwd = dir.join("cwd");
    let settings = dir.join("settings.json");
    std::fs::create_dir_all(&cwd).and_then(|_| std::fs::write(&settings, chat::SETTINGS_JSON)).map_err(|_| CmdError::Io)?;
    let mut child = Command::new(cli.program())
        .args(cli.prefix())
        .args(chat::args(c.session.as_deref(), &settings))
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| CmdError::Refused)?;
    let (stdin, stdout) = (child.stdin.take(), child.stdout.take());
    c.gen += 1;
    c.busy = true;
    c.child = Some(child);
    let gen = c.gen;
    drop(c);
    // stdin on its own thread (a full pipe must not block the reader); dropping it is the end of the message
    if let Some(mut stdin) = stdin {
        std::thread::spawn(move || {
            let _ = stdin.write_all(text.as_bytes());
        });
    }
    let reader_app = app.clone();
    std::thread::spawn(move || read(&reader_app, gen, stdout));
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(chat::TIMEOUT_SECS));
        finish(&app, gen, Done { ok: false, error: Some("No reply after 3 minutes. Try again.".into()), stopped: false });
    });
    Ok(())
}

fn read(app: &AppHandle, gen: u64, stdout: Option<std::process::ChildStdout>) {
    let mut last = None;
    for line in stdout.into_iter().flat_map(|o| BufReader::new(o).lines()).map_while(Result::ok) {
        let current = CHAT.lock().gen == gen;
        if !current {
            return;
        }
        match chat::parse_line(&line) {
            Some(Line::Session(id)) => CHAT.lock().session = Some(id),
            Some(Line::Delta(text)) => {
                let _ = app.emit("claude_chat_delta", serde_json::json!({ "text": text }));
            }
            Some(Line::Done { ok, text, session }) => {
                if let Some(id) = session {
                    CHAT.lock().session = Some(id);
                }
                last = Some((ok, text));
            }
            None => {}
        }
    }
    let done = match last {
        Some((true, _)) => Done { ok: true, error: None, stopped: false },
        Some((false, text)) if !text.trim().is_empty() => {
            Done { ok: false, error: Some(text.chars().take(MAX_ERROR).collect()), stopped: false }
        }
        _ => Done { ok: false, error: Some("Claude Code stopped without a reply.".into()), stopped: false },
    };
    finish(app, gen, done);
}

/// Ends request `gen` once (later calls for it do nothing): kills the process if it still runs, then emits `done`.
fn finish(app: &AppHandle, gen: u64, done: Done) {
    let mut c = CHAT.lock();
    if c.gen != gen || !c.busy {
        return;
    }
    c.busy = false;
    if let Some(mut child) = c.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(c);
    let _ = app.emit("claude_chat_done", done);
}

fn demo(app: &AppHandle, gen: u64, text: &str) {
    std::thread::sleep(Duration::from_millis(700));
    for piece in chat::demo_reply(text) {
        if CHAT.lock().gen != gen {
            return;
        }
        let _ = app.emit("claude_chat_delta", serde_json::json!({ "text": piece }));
        std::thread::sleep(Duration::from_millis(45));
    }
    finish(app, gen, Done { ok: true, error: None, stopped: false });
}

/// Stop: the process is killed and the card hears `stopped`. The conversation stays (the next message continues it).
pub fn stop(app: &AppHandle) {
    let gen = CHAT.lock().gen;
    finish(app, gen, Done { ok: false, error: None, stopped: true });
    CHAT.lock().gen += 1;
}

/// New chat: stop, and forget the session id.
pub fn reset(app: &AppHandle) {
    stop(app);
    CHAT.lock().session = None;
}

/// Quitting: kill the process, emit nothing.
pub fn kill() {
    let mut c = CHAT.lock();
    c.gen += 1;
    c.busy = false;
    if let Some(mut child) = c.child.take() {
        let _ = child.kill();
    }
}
