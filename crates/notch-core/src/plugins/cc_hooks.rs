// Peeka — original implementation (MIT).
//! Coding agents without a main assistant (`docs/plugin-api.md` "Claude Code" and "Other agents"): Peeka's own hook.
//! `peeka.exe --cc-hook [agent [event]]` gets the hook's JSON on stdin and passes on only `{agent, kind, tool, reason,
//! sid}` ([`hook_params`]; Claude Code's line adds the one-word [`origin`]); the receiver checks it again with the same rules as `cc.event`. [`install`] / [`uninstall`]
//! add or remove exactly Peeka's entries in the agent's hook config; the owner's other hooks stay. Status only: the
//! hook never answers, so no agent waits on Peeka for a decision. Pure apart from the one file it is given.

use std::path::Path;

use serde_json::{json, Map, Value};

/// The `cc.event` kinds, `permission` = PermissionRequest.
pub const CC_KINDS: [&str; 12] = [
    "session_start",
    "session_end",
    "prompt",
    "pre_tool",
    "post_tool",
    "tool_failed",
    "notification",
    "permission",
    "stop",
    "stop_failure",
    "subagent_start",
    "subagent_stop",
];

/// The `agent` of `cc.event`; absent = `claude`. `opencode` is accepted from a main assistant, Peeka has no hook for it
/// (its plugin events are not documented field by field).
pub const AGENT_IDS: [&str; 6] = ["claude", "codex", "cursor", "gemini", "copilot", "opencode"];

/// Claude Code's hook event -> its `cc.event` kind.
const EVENTS: [(&str, &str); 12] = [
    ("SessionStart", "session_start"),
    ("SessionEnd", "session_end"),
    ("UserPromptSubmit", "prompt"),
    ("PreToolUse", "pre_tool"),
    ("PostToolUse", "post_tool"),
    ("PostToolUseFailure", "tool_failed"),
    ("Notification", "notification"),
    ("PermissionRequest", "permission"),
    ("Stop", "stop"),
    ("StopFailure", "stop_failure"),
    ("SubagentStart", "subagent_start"),
    ("SubagentStop", "subagent_stop"),
];
/// https://learn.chatgpt.com/docs/hooks (no Notification, StopFailure or tool failure event there).
const CODEX_EVENTS: [(&str, &str); 9] = [
    ("SessionStart", "session_start"),
    ("SessionEnd", "session_end"),
    ("UserPromptSubmit", "prompt"),
    ("PreToolUse", "pre_tool"),
    ("PostToolUse", "post_tool"),
    ("PermissionRequest", "permission"),
    ("Stop", "stop"),
    ("SubagentStart", "subagent_start"),
    ("SubagentStop", "subagent_stop"),
];
/// https://cursor.com/docs/agent/hooks: only the events that cannot block (no output there counts as a failed hook,
/// which is fail-open only for these).
const CURSOR_EVENTS: [(&str, &str); 6] = [
    ("sessionStart", "session_start"),
    ("sessionEnd", "session_end"),
    ("postToolUse", "post_tool"),
    ("postToolUseFailure", "tool_failed"),
    ("stop", "stop"),
    ("subagentStop", "subagent_stop"),
];
/// https://geminicli.com/docs/hooks/reference/
const GEMINI_EVENTS: [(&str, &str); 7] = [
    ("SessionStart", "session_start"),
    ("SessionEnd", "session_end"),
    ("BeforeAgent", "prompt"),
    ("BeforeTool", "pre_tool"),
    ("AfterTool", "post_tool"),
    ("AfterAgent", "stop"),
    ("Notification", "notification"),
];
/// https://docs.github.com/en/copilot/reference/hooks-configuration, PascalCase names (their payload is snake_case
/// with `hook_event_name`; the event also goes as the third argument in case it is not).
const COPILOT_EVENTS: [(&str, &str); 11] = [
    ("SessionStart", "session_start"),
    ("SessionEnd", "session_end"),
    ("UserPromptSubmit", "prompt"),
    ("PreToolUse", "pre_tool"),
    ("PostToolUse", "post_tool"),
    ("PostToolUseFailure", "tool_failed"),
    ("Notification", "notification"),
    ("PermissionRequest", "permission"),
    ("Stop", "stop"),
    ("ErrorOccurred", "stop_failure"),
    ("SubagentStop", "subagent_stop"),
];

/// One agent Peeka can install its hook for.
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    events: &'static [(&'static str, &'static str)],
    /// `hooks.<event>` is a list of handlers (Cursor, Copilot), not of `{matcher?, hooks: [handler]}` groups.
    flat: bool,
}

pub const CLAUDE: Agent = Agent { id: "claude", name: "Claude Code", events: &EVENTS, flat: false };
pub const AGENTS: [Agent; 5] = [
    CLAUDE,
    Agent { id: "codex", name: "Codex CLI", events: &CODEX_EVENTS, flat: false },
    Agent { id: "cursor", name: "Cursor", events: &CURSOR_EVENTS, flat: true },
    Agent { id: "gemini", name: "Gemini CLI", events: &GEMINI_EVENTS, flat: false },
    Agent { id: "copilot", name: "GitHub Copilot CLI", events: &COPILOT_EVENTS, flat: true },
];

pub fn agent(id: &str) -> Option<&'static Agent> {
    AGENTS.iter().find(|a| a.id == id)
}

/// The argument that marks an entry as Peeka's.
pub const HOOK_ARG: &str = crate::brand::HOOK_ARG;
/// Claude Code kills a hook after this; ours exits on its own after 2 s anyway.
const TIMEOUT_S: u64 = 5;

/// A tool name or a failure class: 1-64 of letters, digits, `_ . : -`. A path, a command or free text never is.
pub fn word(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
}

/// HMAC-SHA256 (RFC 2104) over the `sha2` we already have; a few lines are cheaper than one more dependency.
fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let pad = |b: u8| k.map(|x| x ^ b);
    let inner = Sha256::new().chain_update(pad(0x36)).chain_update(msg).finalize();
    Sha256::new().chain_update(pad(0x5c)).chain_update(inner).finalize().into()
}

/// The session tag: the first 8 hex chars of HMAC-SHA256(salt, `session_id`). The salt is random per install and never
/// leaves the machine, so the tag tells sessions apart on this desk and nowhere else, and the id cannot be got back.
pub fn session_tag(salt: &[u8], session_id: &str) -> String {
    hmac_sha256(salt, session_id.as_bytes()).iter().take(4).map(|b| format!("{b:02x}")).collect()
}

/// A `sid` as the receiver accepts it: exactly 8 lowercase hex chars.
pub fn is_sid(s: &str) -> bool {
    s.len() == 8 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The per-install salt in `path` (32 random bytes), made on first use. None = it could neither be read nor made:
/// the event then goes without a `sid`.
pub fn salt(path: &Path) -> Option<Vec<u8>> {
    use std::io::Write;
    let read = || std::fs::read(path).ok().filter(|b| b.len() == 32);
    if let Some(b) = read() {
        return Some(b);
    }
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).ok()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok()?;
    }
    // create_new: two hooks racing on the first event cannot write two different salts; the loser reads the winner's.
    match std::fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut f) => f.write_all(&b).ok().map(|()| b.to_vec()),
        Err(_) => read(),
    }
}

/// The hook's stdin JSON -> `cc.event` params. Reads the event name, the tool name, the session id (only as the salted
/// [`session_tag`], and only with a `salt`) and (stop_failure) `error` / (notification) `notification_type`, nothing
/// else; a field that is not a [`word`] goes as null. None = not one of `a`'s events. The field names differ a little
/// across agents (`sessionId`, Cursor's `conversation_id`, `toolName`), so each is the first of its spellings present.
pub fn hook_params(a: &Agent, raw: &Value, salt: Option<&[u8]>) -> Option<Value> {
    let event = raw.get("hook_event_name")?.as_str()?;
    let kind = a.events.iter().find(|(e, _)| *e == event)?.1;
    let first = |ks: &[&str]| ks.iter().find_map(|k| raw.get(*k).and_then(Value::as_str));
    let w = |ks: &[&str]| first(ks).filter(|s| word(s));
    let reason = match kind {
        "stop_failure" => w(&["error"]),
        "notification" => w(&["notification_type"]),
        _ => None,
    };
    let id = first(&["session_id", "sessionId", "conversation_id"]);
    let sid = salt.zip(id).filter(|(_, id)| (1..=256).contains(&id.len()));
    Some(json!({
        "agent": a.id, "kind": kind, "tool": w(&["tool_name", "toolName"]), "reason": reason,
        "sid": sid.map(|(k, id)| session_tag(k, id)),
    }))
}

/// `origin` of `cc.event`: where a Claude Code session was started.
pub const ORIGINS: [&str; 4] = ["terminal", "desktop", "cursor", "vscode"];

/// The session's [`ORIGINS`] word from the hook's environment; only these three variables are looked at and only the
/// word leaves. `VSCODE_GIT_ASKPASS_NODE` is set in VS Code and in its forks, so it means Cursor only when its path
/// says so.
pub fn origin(env: impl Fn(&str) -> Option<String>) -> &'static str {
    let entry = env("CLAUDE_CODE_ENTRYPOINT").unwrap_or_default();
    let askpass = env("VSCODE_GIT_ASKPASS_NODE").unwrap_or_default().to_ascii_lowercase();
    if entry.contains("desktop") {
        "desktop"
    } else if env("CURSOR_TRACE_ID").is_some_and(|v| !v.is_empty()) || askpass.contains("cursor") {
        "cursor"
    } else if entry.contains("vscode") || !askpass.is_empty() {
        "vscode"
    } else {
        "terminal"
    }
}

/// The diff view shows at most this many lines; the rest is a count ("Open in editor").
pub const DIFF_MAX: usize = 200;
/// A cached diff older than this is gone (the hook's cache is short-lived by design).
pub const DIFF_TTL_MS: u64 = 30 * 60_000;
/// A forwarded relative path is at most this long (the hook's line must stay under the receiver's 1 KiB).
const REL_MAX: usize = 160;

/// One Edit/Write, worked out inside the hook process. Only `rel`, `add` and `del` cross the pipe; `abs` and `lines`
/// go to the local cache file ([`write_diff`]) and are read only when the owner asks for the diff.
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Edit {
    pub rel: String,
    pub abs: String,
    pub add: usize,
    pub del: usize,
    /// `+x` / `-x` / ` x`, at most [`DIFF_MAX`].
    pub lines: Vec<String>,
    /// Lines past [`DIFF_MAX`].
    pub more: usize,
}

/// A path relative to the session cwd, as the receiver accepts it: 1-160 chars, `/`-separated, no `..`, no drive,
/// no leading separator, no control chars. Display only; nothing is opened by it.
pub fn is_rel(s: &str) -> bool {
    (1..=REL_MAX).contains(&s.chars().count())
        && !s.starts_with(['/', '\\'])
        && !s.contains(':')
        && !s.chars().any(char::is_control)
        && s.split(['/', '\\']).all(|c| !c.is_empty() && c != "..")
}

/// Line diff of `old` -> `new`: (ops as `+x`/`-x`/` x`, added, removed). Common head and tail are cut first; the rest
/// is an LCS. shortcut: past 1M cells (two ~1000-line middles) it is "all removed, then all added", upgrade to Myers
/// if real edits hit that.
pub fn line_diff(old: &str, new: &str) -> (Vec<String>, usize, usize) {
    let (a, b): (Vec<&str>, Vec<&str>) = (old.lines().collect(), new.lines().collect());
    let head = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let tail = a[head..].iter().rev().zip(b[head..].iter().rev()).take_while(|(x, y)| x == y).count();
    let (x, y) = (&a[head..a.len() - tail], &b[head..b.len() - tail]);
    let mut ops: Vec<String> = a[..head].iter().map(|l| format!(" {l}")).collect();
    if x.len().saturating_mul(y.len()) > 1_000_000 {
        ops.extend(x.iter().map(|l| format!("-{l}")).chain(y.iter().map(|l| format!("+{l}"))));
    } else {
        let w = y.len() + 1;
        let mut t = vec![0u32; (x.len() + 1) * w];
        for i in (0..x.len()).rev() {
            for j in (0..y.len()).rev() {
                t[i * w + j] = if x[i] == y[j] { t[(i + 1) * w + j + 1] + 1 } else { t[(i + 1) * w + j].max(t[i * w + j + 1]) };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < x.len() || j < y.len() {
            if i < x.len() && j < y.len() && x[i] == y[j] {
                ops.push(format!(" {}", x[i]));
                (i, j) = (i + 1, j + 1);
            } else if j == y.len() || (i < x.len() && t[(i + 1) * w + j] >= t[i * w + j + 1]) {
                ops.push(format!("-{}", x[i]));
                i += 1;
            } else {
                ops.push(format!("+{}", y[j]));
                j += 1;
            }
        }
    }
    ops.extend(a[a.len() - tail..].iter().map(|l| format!(" {l}")));
    let count = |c: char| ops.iter().filter(|l| l.starts_with(c)).count();
    let (add, del) = (count('+'), count('-'));
    (ops, add, del)
}

/// PostToolUse of `Edit` (`old_string` -> `new_string`) or `Write` (`content`) on a file inside the session's `cwd`.
/// None = another event or tool, or the file is outside `cwd` (then nothing about it is sent or kept).
/// shortcut: Write's payload has no old content, so a rewrite of an existing file counts every line as added; a
/// PreToolUse snapshot would fix it, but async hooks race the write.
pub fn edit_of(raw: &Value) -> Option<Edit> {
    use std::path::{Component, Path};
    if raw.get("hook_event_name")?.as_str()? != "PostToolUse" {
        return None;
    }
    let input = raw.get("tool_input")?;
    let s = |k: &str| input.get(k).and_then(Value::as_str);
    let (old, new) = match raw.get("tool_name")?.as_str()? {
        "Edit" => (s("old_string")?, s("new_string")?),
        "Write" => ("", s("content")?),
        _ => return None,
    };
    let (file, cwd) = (Path::new(s("file_path")?), Path::new(raw.get("cwd")?.as_str()?));
    if !file.is_absolute() || !cwd.is_absolute() || file.components().any(|c| c == Component::ParentDir) {
        return None;
    }
    let rel = file.strip_prefix(cwd).ok()?.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
    if !is_rel(&rel) {
        return None;
    }
    let (mut lines, add, del) = line_diff(old, new);
    let more = lines.len().saturating_sub(DIFF_MAX);
    lines.truncate(DIFF_MAX);
    Some(Edit { rel, abs: file.to_string_lossy().into_owned(), add, del, lines, more })
}

/// `<dir>/<sid>.json`, the session's last edit. `sid` is checked, so the page's argument cannot leave `dir`.
pub fn diff_file(dir: &Path, sid: &str) -> Option<std::path::PathBuf> {
    is_sid(sid).then(|| dir.join(format!("{sid}.json")))
}

/// The hook keeps only the session's latest edit (overwritten each time, removed at SessionEnd).
pub fn write_diff(dir: &Path, sid: &str, e: &Edit) -> Option<()> {
    let path = diff_file(dir, sid)?;
    std::fs::create_dir_all(dir).ok()?;
    // sessions that never sent SessionEnd: their cached text goes after the TTL, not only when read
    for old in std::fs::read_dir(dir).ok()?.flatten() {
        let age = old.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).unwrap_or_default();
        if age.as_millis() as u64 > DIFF_TTL_MS {
            let _ = std::fs::remove_file(old.path());
        }
    }
    std::fs::write(path, serde_json::to_vec(e).ok()?).ok()
}

/// The cached edit, if younger than [`DIFF_TTL_MS`]; an older one is deleted on the way.
pub fn read_diff(dir: &Path, sid: &str) -> Option<Edit> {
    let path = diff_file(dir, sid)?;
    let age = std::fs::metadata(&path).ok()?.modified().ok()?.elapsed().unwrap_or_default();
    if age.as_millis() as u64 > DIFF_TTL_MS {
        let _ = std::fs::remove_file(&path);
        return None;
    }
    serde_json::from_slice(&std::fs::read(&path).ok()?).ok()
}

/// What `peeka.exe --cc-hook <agent>` sends: [`hook_params`], plus `edit: {file, add, del}` for an [`edit_of`] (the diff
/// itself goes only to `<dir>/<sid>.json`). SessionEnd removes that session's cached diff.
pub fn hook_line(a: &Agent, raw: &Value, salt: Option<&[u8]>, dir: Option<&Path>) -> Option<Value> {
    let mut p = hook_params(a, raw, salt)?;
    let cache = dir.zip(p["sid"].as_str().map(str::to_owned));
    if p["kind"] == "session_end" {
        if let Some(f) = cache.as_ref().and_then(|(d, s)| diff_file(d, s)) {
            let _ = std::fs::remove_file(f);
        }
    }
    // Edit/Write with old_string/new_string is Claude Code's payload; other agents' edits are not read.
    if let Some(e) = edit_of(raw).filter(|_| a.id == "claude") {
        if let Some((d, s)) = &cache {
            let _ = write_diff(d, s, &e);
        }
        p["edit"] = json!({ "file": e.rel, "add": e.add, "del": e.del });
    }
    Some(p)
}

/// Ours: `--cc-hook` in `args` (Claude Code, Copilot) or as a word of the `command` line (Codex, Gemini, Cursor).
fn is_ours(hook: &Value) -> bool {
    hook.get("args").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x == HOOK_ARG))
        || hook.get("command").and_then(Value::as_str).is_some_and(|c| c.split_whitespace().any(|t| t == HOOK_ARG))
}

/// `exe --cc-hook <agent>` for agents whose `command` is a shell line (no `args` in their docs). shortcut: the shell
/// is not documented on Windows; a path with a space is double-quoted, which cmd and bash take but PowerShell does
/// not. Peeka installs per user under %LOCALAPPDATA% (no space unless the user name has one); upgrade if one shows.
fn command_line(exe: &str, agent: &str) -> String {
    let exe = if exe.contains(' ') { format!("\"{exe}\"") } else { exe.to_string() };
    format!("{exe} {HOOK_ARG} {agent}")
}

/// Peeka's handler for event `ev` in `a`'s format. Every one is status only: no stdout, exit 0. Claude Code and Codex
/// run it `async`; Copilot's docs say empty output = default behaviour; Cursor's count no output as a failed hook,
/// fail-open (so only its non-blocking events are used); Gemini's docs do not say (an owner check on a real PC).
fn handler(a: &Agent, exe: &str, ev: &str) -> Value {
    match a.id {
        "claude" => json!({ "type": "command", "command": exe, "args": [HOOK_ARG], "async": true, "timeout": TIMEOUT_S }),
        // Codex caps SessionEnd's timeout at 3 s; the hook is done in 2 s anyway
        "codex" => json!({ "type": "command", "command": command_line(exe, "codex"), "async": true, "timeout": 3 }),
        // Gemini's timeout is in ms; `name` lets the owner `/hooks disable peeka`
        "gemini" => json!({ "name": crate::brand::EXE_NAME, "type": "command", "command": command_line(exe, "gemini"), "timeout": 5000 }),
        "cursor" => json!({ "command": command_line(exe, "cursor") }),
        // Copilot CLI's `exec` + `args`: no shell at all
        _ => json!({ "type": "command", "exec": exe, "args": [HOOK_ARG, a.id, ev], "timeoutSec": TIMEOUT_S }),
    }
}

/// What goes into `hooks.<ev>`: the handler itself for a flat list, else a group around it.
fn entry(a: &Agent, exe: &str, ev: &str) -> Value {
    match (a.flat, a.id) {
        (true, _) => handler(a, exe, ev),
        // Gemini's docs: "*" matches everything (no word on an absent matcher)
        (_, "gemini") => json!({ "matcher": "*", "hooks": [handler(a, exe, ev)] }),
        _ => json!({ "hooks": [handler(a, exe, ev)] }),
    }
}

/// Takes Peeka's hooks out of one event list; a group left empty by that goes too (an empty group of the owner's
/// own stays). True = something was removed.
fn strip(list: &mut Vec<Value>, flat: bool) -> bool {
    let before = list.len();
    if flat {
        list.retain(|h| !is_ours(h));
        return list.len() < before;
    }
    let mut removed = false;
    list.retain_mut(|g| {
        let Some(hs) = g.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
        let before = hs.len();
        hs.retain(|h| !is_ours(h));
        removed |= hs.len() < before;
        !(before > 0 && hs.is_empty())
    });
    removed
}

/// `hooks`, checked: an object whose event entries (of `a`) are lists. Anything else is the owner's: refused, not
/// replaced.
fn hooks_of<'d>(a: &Agent, doc: &'d mut Value) -> Result<&'d mut Map<String, Value>, String> {
    let name = a.name;
    let obj = doc.as_object_mut().ok_or(format!("The {name} settings file is not in the expected format; leaving it alone."))?;
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or(format!("The {name} settings file has \"hooks\" of an unexpected type; leaving it alone."))?;
    if let Some((ev, _)) = a.events.iter().find(|(ev, _)| hooks.get(*ev).is_some_and(|v| !v.is_array())) {
        return Err(format!("The {name} settings file has \"hooks.{ev}\" of an unexpected type; leaving it alone."));
    }
    Ok(hooks)
}

/// Peeka's entry for every event of `a`, an older one of ours replaced. It prints nothing, so a permission request
/// still gets the agent's own prompt.
pub fn merge(a: &Agent, doc: &mut Value, exe: &str) -> Result<(), String> {
    hooks_of(a, &mut doc.clone())?; // refused before anything changes
    if a.flat {
        // Cursor's and Copilot's files need `"version": 1`; an owner's own value stays
        doc.as_object_mut().expect("checked in hooks_of").entry("version").or_insert(json!(1));
    }
    let hooks = hooks_of(a, doc)?;
    for (ev, _) in a.events {
        let list = hooks.entry(*ev).or_insert_with(|| json!([])).as_array_mut().expect("checked in hooks_of");
        strip(list, a.flat);
        list.push(entry(a, exe, ev));
    }
    Ok(())
}

/// Only Peeka's entries go; an event list left empty by that goes too.
pub fn remove(a: &Agent, doc: &mut Value) -> Result<(), String> {
    if doc.get("hooks").is_none() {
        return Ok(());
    }
    let hooks = hooks_of(a, doc)?;
    for (ev, _) in a.events {
        if let Some(list) = hooks.get_mut(*ev).and_then(Value::as_array_mut) {
            if strip(list, a.flat) && list.is_empty() {
                hooks.remove(*ev);
            }
        }
    }
    Ok(())
}

/// (any entry of ours, every event has exactly the handler [`install`] would write for `exe`).
pub fn status(a: &Agent, doc: &Value, exe: &str) -> (bool, bool) {
    let ours = |ev: &str| -> Vec<&Value> {
        let list = doc.pointer(&format!("/hooks/{ev}")).and_then(Value::as_array).into_iter().flatten();
        let handlers: Vec<&Value> = if a.flat {
            list.collect()
        } else {
            list.filter_map(|g| g.get("hooks").and_then(Value::as_array)).flatten().collect()
        };
        handlers.into_iter().filter(|h| is_ours(h)).collect()
    };
    let any = a.events.iter().any(|(ev, _)| !ours(ev).is_empty());
    let current = a.events.iter().all(|(ev, _)| ours(ev).contains(&&handler(a, exe, ev)));
    (any, current)
}

/// The file's bytes (None = no file) and its fingerprint: SHA-256 of those bytes plus the mtime in ms, `absent` for no
/// file. Taken from the same read the change is planned from, so a confirm refuses a file changed after the preview.
fn load(a: &Agent, path: &Path) -> Result<(Option<Vec<u8>>, String), String> {
    use sha2::{Digest, Sha256};
    let mtime = std::fs::metadata(path).and_then(|m| m.modified()).ok();
    match std::fs::read(path) {
        Ok(b) => {
            let ms = mtime.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis());
            let hash: String = Sha256::digest(&b).iter().map(|x| format!("{x:02x}")).collect();
            Ok((Some(b), format!("{hash}-{ms}")))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((None, "absent".into())),
        Err(_) => Err(format!("The {} settings file could not be opened; leaving it alone.", a.name)),
    }
}

fn parse(a: &Agent, bytes: Option<&[u8]>) -> Result<Option<Value>, String> {
    bytes.map(serde_json::from_slice).transpose().map_err(|_| {
        format!("The {} settings file could not be read; leaving it alone until you fix it by hand.", a.name)
    })
}

fn read(a: &Agent, path: &Path) -> Result<Option<Value>, String> {
    parse(a, load(a, path)?.0.as_deref())
}

/// A change to one hook config, worked out but not written: the fingerprint of the file it was read from, its old
/// bytes and the new ones (None = nothing changes).
struct Plan {
    fingerprint: String,
    old: Option<Vec<u8>>,
    new: Option<Vec<u8>>,
}

fn plan(a: &Agent, path: &Path, f: impl FnOnce(&mut Value) -> Result<(), String>) -> Result<Plan, String> {
    let (old, fingerprint) = load(a, path)?;
    let before = parse(a, old.as_deref())?;
    let mut doc = before.clone().unwrap_or_else(|| json!({}));
    f(&mut doc)?;
    let same = Some(&doc) == before.as_ref() || (before.is_none() && doc == json!({}));
    let new = match same {
        true => None,
        false => Some(serde_json::to_vec_pretty(&doc).map_err(|_| format!("The {} settings file could not be written.", a.name))?),
    };
    Ok(Plan { fingerprint, old, new })
}

/// What Settings shows before Install / Remove: the file's line diff (changed lines with one line of context, ` …`
/// for the parts left out, at most [`DIFF_MAX`]) and the fingerprint the confirm must bring back.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Preview {
    pub fingerprint: String,
    pub add: usize,
    pub del: usize,
    pub lines: Vec<String>,
    pub more: usize,
}

/// Install's (`exe` given) or Remove's (None) change to `path`; nothing is written.
pub fn preview(a: &Agent, path: &Path, exe: Option<&str>) -> Result<Preview, String> {
    let p = match exe {
        Some(exe) => plan(a, path, |d| merge(a, d, exe))?,
        None => plan(a, path, |d| remove(a, d))?,
    };
    let text = |b: &Option<Vec<u8>>| b.as_deref().map(String::from_utf8_lossy).unwrap_or_default().into_owned();
    let (ops, add, del) = if p.new.is_some() { line_diff(&text(&p.old), &text(&p.new)) } else { (vec![], 0, 0) };
    let near = |i: usize| ops[i.saturating_sub(1)..(i + 2).min(ops.len())].iter().any(|l| !l.starts_with(' '));
    let mut lines: Vec<String> = Vec::new();
    for (i, l) in ops.iter().enumerate() {
        if near(i) {
            lines.push(l.clone());
        } else if lines.last().is_some_and(|l| l != " …") {
            lines.push(" …".into());
        }
    }
    if lines.last().is_some_and(|l| l == " …") {
        lines.pop();
    }
    let more = lines.len().saturating_sub(DIFF_MAX);
    lines.truncate(DIFF_MAX);
    Ok(Preview { fingerprint: p.fingerprint, add, del, lines, more })
}

/// Plan, check `expect` (the preview's fingerprint; None = no preview was shown), and only if something changes: a
/// one-time backup `<file>.json.bak-peeka` (the file as it was before Peeka first changed it, never overwritten),
/// then tmp + rename. shortcut: a write landing between the check and the rename (milliseconds) is still lost; a
/// lock would need every writer of the file to take it.
fn edit(a: &Agent, path: &Path, expect: Option<&str>, f: impl FnOnce(&mut Value) -> Result<(), String>) -> Result<(), String> {
    let p = plan(a, path, f)?;
    if expect.is_some_and(|e| e != p.fingerprint) {
        return Err(format!(
            "The {} settings file changed after you looked at the changes, so nothing was written. Click again to see the new changes.",
            a.name
        ));
    }
    let Some(bytes) = p.new else { return Ok(()) };
    let msg = format!("The {} settings file could not be written.", a.name);
    let fail = |_| msg.clone();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(fail)?;
    }
    let bak = path.with_extension(format!("json.bak-{}", crate::brand::EXE_NAME));
    if p.old.is_some() && !bak.exists() {
        std::fs::copy(path, &bak).map_err(fail)?;
    }
    let tmp = path.with_extension(format!("json.tmp-{}", crate::brand::EXE_NAME));
    std::fs::write(&tmp, bytes).map_err(fail)?;
    std::fs::rename(&tmp, path).map_err(fail)
}

/// Settings › "Install": Peeka's hooks into `path` (`a`'s hook config), pointing at `exe`. `expect`: see [`edit`].
pub fn install(a: &Agent, path: &Path, exe: &str, expect: Option<&str>) -> Result<(), String> {
    edit(a, path, expect, |d| merge(a, d, exe))
}

/// "Remove". Copilot's file is Peeka's own (`hooks/peeka.json`): left with no hooks, it goes (its backup stays).
pub fn uninstall(a: &Agent, path: &Path, expect: Option<&str>) -> Result<(), String> {
    edit(a, path, expect, |d| remove(a, d))?;
    let empty = |d: Value| d.get("hooks").and_then(Value::as_object).is_some_and(Map::is_empty);
    if a.id == "copilot" && read(a, path)?.is_some_and(empty) {
        std::fs::remove_file(path).map_err(|_| format!("The {} settings file could not be written.", a.name))?;
    }
    Ok(())
}

/// (installed, points at `exe`); a missing or unreadable file = not installed.
pub fn file_status(a: &Agent, path: &Path, exe: &str) -> (bool, bool) {
    read(a, path).ok().flatten().map_or((false, false), |d| status(a, &d, exe))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    const EXE: &str = r"C:\Program Files\Peeka\peeka.exe";

    #[test]
    fn the_sanitizer_passes_only_names() {
        let raw = json!({
            "hook_event_name": "PreToolUse", "session_id": "raw-session-7f3a", "cwd": r"C:\work\hidden-project",
            "tool_name": "Bash", "tool_input": {"command": "rm -rf C:\\secret", "file_path": "C:\\a\\b.txt"},
            "prompt": "my password hunter22", "tool_response": "output", "transcript_path": "C:\\t.jsonl",
        });
        let p = hook_params(&CLAUDE, &raw, None).unwrap();
        assert_eq!(p, json!({"agent": "claude", "kind": "pre_tool", "tool": "Bash", "reason": null, "sid": null}), "no salt, no sid");
        let s = p.to_string();
        for leak in ["rm -rf", "secret", "b.txt", "hunter22", "output", "hidden", "jsonl", "raw-session"] {
            assert!(!s.contains(leak), "{leak}");
        }
        for bad in [r"C:\Windows\cmd.exe", "/usr/bin/bash", "rm -rf /", "Bash; echo x", &"a".repeat(65), "", "sécret"] {
            let p = hook_params(&CLAUDE, &json!({"hook_event_name": "PreToolUse", "tool_name": bad}), None).unwrap();
            assert_eq!(p["tool"], Value::Null, "{bad}");
        }
        assert!(word(&"a".repeat(64)) && word("mcp__x__web.search"));
        assert_eq!(
            hook_params(&CLAUDE, &json!({"hook_event_name": "StopFailure", "error": "rate_limit"}), None).unwrap(),
            json!({"agent": "claude", "kind": "stop_failure", "tool": null, "reason": "rate_limit", "sid": null})
        );
        let n = json!({"hook_event_name": "Notification", "notification_type": "permission_prompt", "message": "x y"});
        assert_eq!(hook_params(&CLAUDE, &n, None).unwrap()["reason"], "permission_prompt");
        let q = json!({"hook_event_name": "Notification", "notification_type": "quota_auto_resume_fired"});
        assert_eq!(hook_params(&CLAUDE, &q, None).unwrap()["reason"], "quota_auto_resume_fired", "the UI clears the plan limit on it");
        assert_eq!(hook_params(&CLAUDE, &json!({"hook_event_name": "PermissionRequest"}), None).unwrap()["kind"], "permission");
        assert_eq!(
            hook_params(&CLAUDE, &json!({"hook_event_name": "Stop", "error": "rate_limit"}), None).unwrap()["reason"],
            Value::Null
        );
        assert!(hook_params(&CLAUDE, &json!({"hook_event_name": "PreCompact"}), None).is_none());
        assert!(hook_params(&CLAUDE, &json!({"tool_name": "Bash"}), None).is_none());
        assert!(EVENTS.iter().all(|(_, k)| CC_KINDS.contains(k)));
    }

    #[test]
    fn hmac_matches_rfc_4231() {
        let hex = |b: [u8; 32]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(
            hex(hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        assert_eq!(
            hex(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        let long = hex(hmac_sha256(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First"));
        assert_eq!(long, "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
    }

    #[test]
    fn the_session_tag_is_stable_per_install_and_differs_across_salts() {
        let (a, b) = (session_tag(&[1; 32], "sess-1"), session_tag(&[1; 32], "sess-1"));
        assert_eq!(a, b);
        assert!(is_sid(&a));
        assert_ne!(a, session_tag(&[2; 32], "sess-1"), "another install: another tag");
        assert_ne!(a, session_tag(&[1; 32], "sess-2"), "another session: another tag");
        assert!(!is_sid("ABCDEF01") && !is_sid("abcdef0") && !is_sid("abcdef012"));
    }

    #[test]
    fn the_raw_session_id_never_leaves_the_hook() {
        let raw = json!({"hook_event_name": "Stop", "session_id": "9c1d2e3f-raw-id", "cwd": r"C:\work\hidden"});
        let p = hook_params(&CLAUDE, &raw, Some(&[7; 32])).unwrap();
        assert_eq!(p["sid"], json!(session_tag(&[7; 32], "9c1d2e3f-raw-id")));
        let s = p.to_string();
        assert!(!s.contains("9c1d2e3f") && !s.contains("raw-id") && !s.contains("hidden"), "{s}");
        for bad in [json!(5), json!(""), json!("x".repeat(300))] {
            let q = hook_params(&CLAUDE, &json!({"hook_event_name": "Stop", "session_id": bad}), Some(&[7; 32])).unwrap();
            assert_eq!(q["sid"], Value::Null);
        }
    }

    #[test]
    fn the_salt_is_made_once_and_then_kept() {
        let tmp = Tmp::new();
        let path = tmp.path().join("cc-salt.bin");
        let a = salt(&path).unwrap();
        assert_eq!(a.len(), 32);
        assert_eq!(salt(&path).unwrap(), a, "the second hook reads the same salt");
        std::fs::write(&path, b"short").unwrap();
        assert!(salt(&path).is_none(), "a damaged file is not replaced under a running install");
    }

    #[test]
    fn line_diff_counts_and_orders() {
        let (ops, add, del) = line_diff("a\nb\nc\nd", "a\nB\nc\nd\ne");
        assert_eq!(ops, [" a", "-b", "+B", " c", " d", "+e"]);
        assert_eq!((add, del), (2, 1));
        assert_eq!(line_diff("x", "x"), (vec![" x".to_string()], 0, 0));
        assert_eq!(line_diff("", "1\n2\n3").1, 3, "a new file: all added");
        let (_, a, d) = line_diff("1\n2\n3\n4", "1\n3\n4\n5\n2");
        assert_eq!((a, d), (2, 1), "LCS, not a block replace");
    }

    fn post(tool: &str, input: Value) -> Value {
        json!({"hook_event_name": "PostToolUse", "tool_name": tool, "cwd": r"C:\work\proj", "session_id": "s1", "tool_input": input})
    }

    #[test]
    fn an_edit_inside_cwd_becomes_a_relative_path_and_counts() {
        let e = edit_of(&post("Edit", json!({"file_path": r"C:\work\proj\src\a.rs", "old_string": "x\ny", "new_string": "x\nz\nw"}))).unwrap();
        assert_eq!((e.rel.as_str(), e.add, e.del, e.more), ("src/a.rs", 2, 1, 0));
        assert_eq!(e.abs, r"C:\work\proj\src\a.rs");
        let w = edit_of(&post("Write", json!({"file_path": "C:/work/proj/n.txt", "content": "1\n2"}))).unwrap();
        assert_eq!((w.rel.as_str(), w.add, w.del), ("n.txt", 2, 0));
        for outside in [r"C:\work\other\a.rs", r"C:\work\proj\..\secret.txt", r"D:\work\proj\a.rs", "src/a.rs", r"C:\work\proj"] {
            let raw = post("Edit", json!({"file_path": outside, "old_string": "a", "new_string": "b"}));
            assert!(edit_of(&raw).is_none(), "{outside}");
        }
        assert!(edit_of(&post("Bash", json!({"command": "echo"}))).is_none());
        let mut pre = post("Edit", json!({"file_path": r"C:\work\proj\a.rs", "old_string": "a", "new_string": "b"}));
        pre["hook_event_name"] = json!("PreToolUse");
        assert!(edit_of(&pre).is_none(), "only after the edit happened");
    }

    #[test]
    fn a_long_diff_is_cut_at_200_lines_with_a_count() {
        let big = (0..250).map(|i| i.to_string()).collect::<Vec<_>>().join("\n");
        let e = edit_of(&post("Write", json!({"file_path": r"C:\work\proj\big.txt", "content": big}))).unwrap();
        assert_eq!((e.lines.len(), e.more, e.add), (DIFF_MAX, 50, 250), "the counts are the whole edit");
    }

    #[test]
    fn rel_paths_the_receiver_accepts() {
        for ok in ["a.rs", "src/a.rs", ".env", "x/.hidden/y"] {
            assert!(is_rel(ok), "{ok}");
        }
        for bad in ["", "/a", r"\a", "C:/a", "a/../b", "..", "a//b", "a\nb", &"a".repeat(161)] {
            assert!(!is_rel(bad), "{bad}");
        }
    }

    #[test]
    fn the_hook_line_carries_counts_and_the_cache_holds_the_diff() {
        let tmp = Tmp::new();
        let dir = tmp.path().join("cc-diff");
        let raw = post("Edit", json!({"file_path": r"C:\work\proj\src\a.rs", "old_string": "secret1", "new_string": "secret2"}));
        let line = hook_line(&CLAUDE, &raw, Some(&[3; 32]), Some(&dir)).unwrap();
        assert_eq!(line["edit"], json!({"file": "src/a.rs", "add": 1, "del": 1}));
        let s = line.to_string();
        assert!(!s.contains("secret") && !s.contains("work") && !s.contains("proj"), "no code, no absolute path: {s}");
        let sid = line["sid"].as_str().unwrap();
        let cached = read_diff(&dir, sid).unwrap();
        assert_eq!(cached.lines, ["-secret1", "+secret2"]);
        assert!(read_diff(&dir, "../x").is_none() && diff_file(&dir, "..\\..\\x").is_none(), "a page argument cannot escape");
        let end = json!({"hook_event_name": "SessionEnd", "session_id": "s1"});
        assert!(hook_line(&CLAUDE, &end, Some(&[3; 32]), Some(&dir)).unwrap().get("edit").is_none());
        assert!(read_diff(&dir, sid).is_none(), "SessionEnd removes the cache");
        assert!(hook_line(&CLAUDE, &raw, None, Some(&dir)).unwrap()["edit"].is_object(), "no salt: counts still go, nothing cached");
    }

    fn owner_doc() -> Value {
        json!({
            "env": {"X": "1"},
            "statusLine": {"type": "command", "command": "mine"},
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Bash", "hooks": [{"type": "command", "command": "my-guard.exe"}]},
                    {"hooks": [{"type": "command", "command": "python", "args": ["-I", "-S", "C:/a/bin/cc_hook.py"]}]},
                ],
                "Stop": [{"hooks": []}],
                "PreCompact": [{"hooks": [{"type": "command", "command": "c.exe"}]}],
            },
        })
    }

    #[test]
    fn a_pre_rename_notch_exe_hook_is_offered_and_replaced() {
        let mut d = owner_doc();
        merge(&CLAUDE, &mut d, r"C:\Program Files\Peeka\notch.exe").unwrap();
        assert_eq!(status(&CLAUDE, &d, EXE), (true, false), "old notch.exe entries: Reinstall");
        merge(&CLAUDE, &mut d, EXE).unwrap();
        assert_eq!(status(&CLAUDE, &d, EXE), (true, true));
        assert_eq!(d["hooks"]["PreToolUse"].as_array().unwrap().len(), 3, "replaced, not added beside it");
    }

    #[test]
    fn merge_is_idempotent_and_keeps_the_owners_hooks() {
        let mut d = owner_doc();
        merge(&CLAUDE, &mut d, EXE).unwrap();
        let once = d.clone();
        merge(&CLAUDE, &mut d, EXE).unwrap();
        assert_eq!(d, once, "a second Install changes nothing");
        assert_eq!(status(&CLAUDE, &d, EXE), (true, true));
        assert_eq!(status(&CLAUDE, &d, r"C:\new\peeka.exe"), (true, false), "moved: points at the old exe");
        let pre = d["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 3);
        assert_eq!(pre[0], owner_doc()["hooks"]["PreToolUse"][0], "the owner's own hook");
        assert_eq!(pre[1], owner_doc()["hooks"]["PreToolUse"][1], "the owner's other hook");
        assert_eq!(
            pre[2]["hooks"][0],
            json!({"type": "command", "command": EXE, "args": ["--cc-hook"], "async": true, "timeout": 5})
        );
        assert_eq!(d["hooks"]["Stop"][0], json!({"hooks": []}), "an empty group of the owner's stays");
        assert_eq!(
            (d["env"].clone(), d["statusLine"].clone()),
            (json!({"X": "1"}), json!({"type": "command", "command": "mine"}))
        );
        assert_eq!(d["hooks"]["PreCompact"], owner_doc()["hooks"]["PreCompact"]);
        assert_eq!(d["hooks"].as_object().unwrap().len(), 13, "twelve events plus the owner's PreCompact");

        merge(&CLAUDE, &mut d, r"C:\new\peeka.exe").unwrap();
        assert_eq!(d["hooks"]["PreToolUse"].as_array().unwrap().len(), 3, "an older entry of ours is replaced");

        remove(&CLAUDE, &mut d).unwrap();
        assert_eq!(d, owner_doc(), "Remove leaves exactly the owner's file");
        assert_eq!(status(&CLAUDE, &d, EXE), (false, false));
        remove(&CLAUDE, &mut d).unwrap();
        assert_eq!(d, owner_doc());
    }

    #[test]
    fn a_file_of_an_unexpected_shape_is_refused_untouched() {
        for bad in [json!([]), json!({"hooks": []}), json!({"hooks": {"Stop": {"x": 1}}})] {
            let mut d = bad.clone();
            assert!(merge(&CLAUDE, &mut d, EXE).is_err(), "{bad}");
            assert_eq!(d, bad);
        }
        let tmp = Tmp::new();
        let path = tmp.write(".claude/settings.json", b"{nope");
        assert!(install(&CLAUDE, &path, EXE, None).is_err() && uninstall(&CLAUDE, &path, None).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{nope", "never overwritten");
    }

    #[test]
    fn install_and_uninstall_on_a_file() {
        let tmp = Tmp::new();
        let path = tmp.path().join(".claude").join("settings.json");
        assert_eq!(file_status(&CLAUDE, &path, EXE), (false, false));
        uninstall(&CLAUDE, &path, None).unwrap();
        assert!(!path.exists(), "nothing to remove: no file made");
        install(&CLAUDE, &path, EXE, None).unwrap();
        assert_eq!(file_status(&CLAUDE, &path, EXE), (true, true));
        assert!(!path.with_extension("json.bak-peeka").exists(), "no backup of a file that did not exist");

        std::fs::write(&path, serde_json::to_vec(&owner_doc()).unwrap()).unwrap();
        install(&CLAUDE, &path, EXE, None).unwrap();
        let bak: Value =
            serde_json::from_slice(&std::fs::read(path.with_extension("json.bak-peeka")).unwrap()).unwrap();
        assert_eq!(bak, owner_doc(), "the backup is the file before the change");
        uninstall(&CLAUDE, &path, None).unwrap();
        let back: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(back, owner_doc());
        assert_eq!(back.to_string(), owner_doc().to_string(), "the owner's key order too (preserve_order)");
        assert!(!path.with_extension("json.tmp-peeka").exists());
    }

    #[test]
    fn the_preview_shows_the_change_and_a_confirm_refuses_a_file_changed_since() {
        let tmp = Tmp::new();
        let owner = serde_json::to_vec_pretty(&owner_doc()).unwrap();
        let path = tmp.write(".claude/settings.json", &owner);
        let p = preview(&CLAUDE, &path, Some(EXE)).unwrap();
        assert!(p.add > 0 && p.del == 0, "{p:?}");
        assert!(p.lines.iter().any(|l| l.starts_with('+') && l.contains(HOOK_ARG)));
        assert!(p.lines.iter().any(|l| l.starts_with(' ')), "context around the change");
        assert_eq!(std::fs::read(&path).unwrap(), owner, "a preview writes nothing");

        // the owner (or Claude Code) saves the file after the preview: the confirm writes nothing
        let mut edited = owner_doc();
        edited["model"] = json!("opus");
        let edited = serde_json::to_vec_pretty(&edited).unwrap();
        std::fs::write(&path, &edited).unwrap();
        let e = install(&CLAUDE, &path, EXE, Some(&p.fingerprint)).unwrap_err();
        assert!(e.contains("changed after you looked"), "{e}");
        assert_eq!(std::fs::read(&path).unwrap(), edited);
        assert!(!path.with_extension("json.bak-peeka").exists());

        // a fresh preview of the same bytes confirms
        let p = preview(&CLAUDE, &path, Some(EXE)).unwrap();
        install(&CLAUDE, &path, EXE, Some(&p.fingerprint)).unwrap();
        assert_eq!(file_status(&CLAUDE, &path, EXE), (true, true));
        assert_eq!(std::fs::read(path.with_extension("json.bak-peeka")).unwrap(), edited, "backup of the file before");

        // Remove previews only Peeka's lines going; the backup is one-time, never overwritten
        let r = preview(&CLAUDE, &path, None).unwrap();
        assert!(r.add == 0 && r.del > 0 && r.lines.iter().filter(|l| l.starts_with('-')).all(|l| !l.contains("opus")));
        uninstall(&CLAUDE, &path, Some(&r.fingerprint)).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(&path).unwrap()).unwrap()["model"], "opus");
        assert_eq!(std::fs::read(path.with_extension("json.bak-peeka")).unwrap(), edited);

        // nothing to change: an empty preview, and the file is not touched
        let n = preview(&CLAUDE, &path, None).unwrap();
        assert!(n.lines.is_empty() && n.add == 0 && n.del == 0);
        let before = std::fs::read(&path).unwrap();
        uninstall(&CLAUDE, &path, Some(&n.fingerprint)).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn a_file_that_appears_or_goes_after_the_preview_is_refused() {
        let tmp = Tmp::new();
        let path = tmp.path().join(".claude").join("settings.json");
        let p = preview(&CLAUDE, &path, Some(EXE)).unwrap();
        assert_eq!(p.fingerprint, "absent");
        let path = tmp.write(".claude/settings.json", b"{}");
        assert!(install(&CLAUDE, &path, EXE, Some(&p.fingerprint)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{}");
        let p = preview(&CLAUDE, &path, Some(EXE)).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(install(&CLAUDE, &path, EXE, Some(&p.fingerprint)).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn the_origin_is_one_word_from_the_environment() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string());
        assert_eq!(origin(env(&[])), "terminal");
        assert_eq!(origin(env(&[("CLAUDE_CODE_ENTRYPOINT", "cli")])), "terminal");
        assert_eq!(origin(env(&[("CLAUDE_CODE_ENTRYPOINT", "claude-desktop")])), "desktop");
        assert_eq!(origin(env(&[("CURSOR_TRACE_ID", "abc")])), "cursor");
        assert_eq!(origin(env(&[("VSCODE_GIT_ASKPASS_NODE", r"C:\Users\me\AppData\Local\Programs\cursor\Cursor.exe")])), "cursor");
        assert_eq!(origin(env(&[("VSCODE_GIT_ASKPASS_NODE", r"C:\Program Files\Microsoft VS Code\Code.exe")])), "vscode", "VS Code is not Cursor");
        assert_eq!(origin(env(&[("CLAUDE_CODE_ENTRYPOINT", "claude-vscode")])), "vscode");
        assert_eq!(origin(env(&[("CLAUDE_CODE_ENTRYPOINT", "claude-vscode"), ("CURSOR_TRACE_ID", "x")])), "cursor", "the extension inside Cursor");
        assert_eq!(origin(env(&[("CURSOR_TRACE_ID", "")])), "terminal");
        assert!(ORIGINS.iter().all(|o| word(o)));
    }

    // Payload fixtures: the fields each agent's official hook docs list for that event (values made up).
    fn by(id: &str) -> &'static Agent {
        agent(id).unwrap()
    }

    fn no_leak(p: &Value, leaks: &[&str]) {
        let s = p.to_string();
        for l in leaks {
            assert!(!s.contains(l), "{l} in {s}");
        }
    }

    #[test]
    fn every_agents_payload_becomes_the_same_filtered_line() {
        let salt = Some(&[5u8; 32][..]);
        // Codex PreToolUse (learn.chatgpt.com/docs/hooks)
        let codex = json!({"session_id": "019a-codex-thread", "transcript_path": "C:\\Users\\me\\.codex\\t.jsonl", "cwd": "C:\\work\\secret-proj",
            "hook_event_name": "PreToolUse", "model": "gpt-5-codex", "turn_id": "turn-9", "tool_name": "Bash", "tool_use_id": "call_1",
            "tool_input": {"command": "cat .env"}});
        let p = hook_params(by("codex"), &codex, salt).unwrap();
        assert_eq!(p, json!({"agent": "codex", "kind": "pre_tool", "tool": "Bash", "reason": null, "sid": session_tag(&[5; 32], "019a-codex-thread")}));
        no_leak(&p, &["019a", "secret", ".env", "gpt-5", "turn-9", "jsonl"]);
        // Cursor postToolUse (cursor.com/docs/agent/hooks): the session is `conversation_id`
        let cursor = json!({"conversation_id": "conv-42", "generation_id": "gen-1", "model": "claude-x", "hook_event_name": "postToolUse",
            "cursor_version": "2.0", "workspace_roots": ["C:\\work\\secret-proj"], "user_email": "me@example.com",
            "transcript_path": "C:\\t.txt", "tool_name": "Shell", "tool_input": {"command": "ls"}, "tool_output": "passwords.txt",
            "tool_use_id": "t1", "cwd": "C:\\work\\secret-proj", "duration": 12});
        let p = hook_params(by("cursor"), &cursor, salt).unwrap();
        assert_eq!(p, json!({"agent": "cursor", "kind": "post_tool", "tool": "Shell", "reason": null, "sid": session_tag(&[5; 32], "conv-42")}));
        no_leak(&p, &["conv-42", "example.com", "secret", "passwords", "claude-x"]);
        assert!(hook_params(by("cursor"), &json!({"hook_event_name": "preToolUse", "tool_name": "Shell"}), None).is_none(), "blocking events are not ours");
        // Gemini CLI AfterTool and Notification (geminicli.com/docs/hooks/reference)
        let gemini = json!({"session_id": "g-1", "transcript_path": "/t", "cwd": "C:\\work\\secret-proj", "hook_event_name": "AfterTool",
            "timestamp": "2026-10-19T10:00:00Z", "tool_name": "write_file", "tool_input": {"file_path": "a.txt", "content": "hunter2"},
            "tool_response": {"llmContent": "ok"}});
        let p = hook_params(by("gemini"), &gemini, None).unwrap();
        assert_eq!(p, json!({"agent": "gemini", "kind": "post_tool", "tool": "write_file", "reason": null, "sid": null}));
        no_leak(&p, &["hunter2", "a.txt", "secret"]);
        let n = json!({"session_id": "g-1", "hook_event_name": "Notification", "notification_type": "ToolPermission", "message": "Allow rm -rf?", "details": {}});
        let p = hook_params(by("gemini"), &n, None).unwrap();
        assert_eq!((p["kind"].as_str(), p["reason"].as_str()), (Some("notification"), Some("ToolPermission")));
        no_leak(&p, &["rm -rf"]);
        assert_eq!(hook_params(by("gemini"), &json!({"hook_event_name": "AfterAgent", "prompt_response": "x"}), None).unwrap()["kind"], "stop");
        // Copilot CLI, PascalCase event (snake_case payload) and the camelCase one with the event from the argument
        let pascal = json!({"hook_event_name": "PreToolUse", "session_id": "cp-1", "cwd": "C:\\work\\secret-proj", "tool_name": "bash", "tool_input": {"command": "ls"}});
        assert_eq!(hook_params(by("copilot"), &pascal, None).unwrap()["tool"], "bash");
        let mut camel = json!({"sessionId": "cp-1", "timestamp": 1704614400000u64, "cwd": "/tmp", "toolName": "bash", "toolArgs": "{\"command\":\"ls\"}"});
        assert!(hook_params(by("copilot"), &camel, None).is_none(), "no event name, no line");
        camel["hook_event_name"] = json!("PreToolUse"); // what the hook does with its third argument
        let p = hook_params(by("copilot"), &camel, salt).unwrap();
        assert_eq!(p, json!({"agent": "copilot", "kind": "pre_tool", "tool": "bash", "reason": null, "sid": session_tag(&[5; 32], "cp-1")}));
        no_leak(&p, &["command", "/tmp"]);
        let err = json!({"hook_event_name": "ErrorOccurred", "error": {"message": "C:\\secret", "name": "Error"}});
        assert_eq!(hook_params(by("copilot"), &err, None).unwrap()["reason"], Value::Null, "an object is never a word");
        // every table maps only to known kinds, and only Claude Code's edits are read
        assert!(AGENTS.iter().all(|a| a.events.iter().all(|(_, k)| CC_KINDS.contains(k)) && AGENT_IDS.contains(&a.id)));
        let edit = json!({"hook_event_name": "PostToolUse", "tool_name": "Edit", "cwd": "C:\\w", "session_id": "s",
            "tool_input": {"file_path": "C:\\w\\a.rs", "old_string": "a", "new_string": "b"}});
        assert!(hook_line(by("codex"), &edit, None, None).unwrap().get("edit").is_none());
        assert!(hook_line(&CLAUDE, &edit, None, None).unwrap()["edit"].is_object());
    }

    fn other_doc() -> Value {
        json!({"version": 1, "hooks": {"postToolUse": [{"command": "./hooks/format.sh"}], "stop": [{"command": "mine.exe --x"}]}, "keep": true})
    }

    #[test]
    fn each_agents_install_has_its_format_and_remove_restores_the_owners_file() {
        let exe = r"C:\Users\me\AppData\Local\Peeka\peeka.exe";
        // Cursor: flat lists, a shell command line
        let mut d = other_doc();
        merge(by("cursor"), &mut d, exe).unwrap();
        let post = d["hooks"]["postToolUse"].as_array().unwrap();
        assert_eq!(post[0], json!({"command": "./hooks/format.sh"}), "the owner's hook stays first");
        assert_eq!(post[1], json!({"command": format!("{exe} --cc-hook cursor")}));
        assert_eq!(status(by("cursor"), &d, exe), (true, true));
        let once = d.clone();
        merge(by("cursor"), &mut d, exe).unwrap();
        assert_eq!(d, once, "idempotent");
        remove(by("cursor"), &mut d).unwrap();
        assert_eq!(d, other_doc());
        assert!(d["hooks"].get("sessionStart").is_none(), "an event list we made goes again");
        // a fresh Cursor file gets its version
        let mut fresh = json!({});
        merge(by("cursor"), &mut fresh, exe).unwrap();
        assert_eq!(fresh["version"], 1);
        // Codex and Gemini: groups like Claude Code's, Gemini with a "*" matcher and a ms timeout
        let mut c = json!({"description": "mine", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "notify.py"}]}]}});
        merge(by("codex"), &mut c, exe).unwrap();
        assert_eq!(c["hooks"]["Stop"][1]["hooks"][0], json!({"type": "command", "command": format!("{exe} --cc-hook codex"), "async": true, "timeout": 3}));
        assert!(c["hooks"].get("Notification").is_none(), "only the agent's own events");
        remove(by("codex"), &mut c).unwrap();
        assert_eq!(c, json!({"description": "mine", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "notify.py"}]}]}}));
        let mut g = json!({"theme": "x"});
        merge(by("gemini"), &mut g, r"C:\Program Files\Peeka\peeka.exe").unwrap();
        assert_eq!(g["hooks"]["BeforeTool"][0]["matcher"], "*");
        assert_eq!(g["hooks"]["BeforeTool"][0]["hooks"][0]["command"], r#""C:\Program Files\Peeka\peeka.exe" --cc-hook gemini"#, "a path with a space is quoted");
        assert_eq!(g["hooks"]["BeforeTool"][0]["hooks"][0]["timeout"], 5000);
        assert_eq!(status(by("gemini"), &g, exe), (true, false), "another exe: Reinstall");
        // Copilot: exec + args, the event as the third argument
        let mut cp = json!({});
        merge(by("copilot"), &mut cp, exe).unwrap();
        assert_eq!(cp["hooks"]["PreToolUse"][0], json!({"type": "command", "exec": exe, "args": ["--cc-hook", "copilot", "PreToolUse"], "timeoutSec": 5}));
        // a Claude Code entry is not mistaken for another agent's and vice versa only by file: is_ours sees both forms
        assert!(is_ours(&json!({"command": "x --cc-hook gemini"})) && !is_ours(&json!({"command": "x --cc-hooks"})));
    }

    #[test]
    fn copilots_own_file_is_written_backed_up_and_removed() {
        let tmp = Tmp::new();
        let path = tmp.path().join(".copilot").join("hooks").join("peeka.json");
        install(by("copilot"), &path, EXE, None).unwrap();
        assert_eq!(file_status(by("copilot"), &path, EXE), (true, true));
        uninstall(by("copilot"), &path, None).unwrap();
        assert!(!path.exists(), "nothing of the owner's left in it: the file goes");
        // the owner added a hook of their own to it: that stays, with a backup of the file before
        install(by("copilot"), &path, EXE, None).unwrap();
        let mut d: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        d["hooks"]["Stop"].as_array_mut().unwrap().push(json!({"type": "command", "bash": "./mine.sh"}));
        std::fs::write(&path, serde_json::to_vec(&d).unwrap()).unwrap();
        uninstall(by("copilot"), &path, None).unwrap();
        let left: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(left, json!({"version": 1, "hooks": {"Stop": [{"type": "command", "bash": "./mine.sh"}]}}));
        assert!(path.with_extension("json.bak-peeka").exists());
        // Cursor's shared file: backup first, refused untouched when it is not JSON
        let cur = tmp.write(".cursor/hooks.json", serde_json::to_vec(&other_doc()).unwrap().as_slice());
        install(by("cursor"), &cur, EXE, None).unwrap();
        let bak: Value = serde_json::from_slice(&std::fs::read(cur.with_extension("json.bak-peeka")).unwrap()).unwrap();
        assert_eq!(bak, other_doc());
        uninstall(by("cursor"), &cur, None).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(&cur).unwrap()).unwrap(), other_doc());
        let bad = tmp.write(".gemini/settings.json", b"{nope");
        let e = install(by("gemini"), &bad, EXE, None).unwrap_err();
        assert!(e.contains("Gemini CLI"), "{e}");
        assert_eq!(std::fs::read(&bad).unwrap(), b"{nope");
    }
}
