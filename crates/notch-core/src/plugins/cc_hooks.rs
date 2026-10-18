// Peeka — original implementation (MIT).
//! Claude Code without a main assistant (`docs/plugin-api.md` "Claude Code"): Peeka's own hook. `peeka.exe --cc-hook` gets
//! the hook's JSON on stdin and passes on only `{kind, tool, reason, sid}` ([`hook_params`]); the receiver checks it again
//! with the same rules as `cc.event`. [`install`] / [`uninstall`] add or remove exactly Peeka's entries in Claude
//! Code's `settings.json`; the owner's other hooks stay. Pure apart from the one file it is given.

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

/// The argument that marks an entry as Peeka's.
pub const HOOK_ARG: &str = "--cc-hook";
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

/// The hook's stdin JSON -> `cc.event` params. Reads `hook_event_name`, `tool_name`, `session_id` (only as the salted
/// [`session_tag`], and only with a `salt`) and (StopFailure) `error` / (Notification) `notification_type`, nothing
/// else; a field that is not a [`word`] goes as null. None = not one of the twelve events.
pub fn hook_params(raw: &Value, salt: Option<&[u8]>) -> Option<Value> {
    let event = raw.get("hook_event_name")?.as_str()?;
    let kind = EVENTS.iter().find(|(e, _)| *e == event)?.1;
    let w = |k: &str| raw.get(k).and_then(Value::as_str).filter(|s| word(s));
    let reason = match event {
        "StopFailure" => w("error"),
        "Notification" => w("notification_type"),
        _ => None,
    };
    let sid = salt.zip(raw.get("session_id").and_then(Value::as_str)).filter(|(_, id)| (1..=256).contains(&id.len()));
    Some(json!({ "kind": kind, "tool": w("tool_name"), "reason": reason, "sid": sid.map(|(k, id)| session_tag(k, id)) }))
}

fn is_ours(hook: &Value) -> bool {
    hook.get("args").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x == HOOK_ARG))
}

/// Takes Peeka's hooks out of one event list; a group left empty by that goes too (an empty group of the owner's
/// own stays). True = something was removed.
fn strip(list: &mut Vec<Value>) -> bool {
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

/// `hooks`, checked: an object whose twelve event entries are lists. Anything else is the owner's: refused, not
/// replaced.
fn hooks_of(doc: &mut Value) -> Result<&mut Map<String, Value>, String> {
    let obj = doc.as_object_mut().ok_or("The Claude Code settings file is not in the expected format; leaving it alone.")?;
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("The Claude Code settings file has \"hooks\" of an unexpected type; leaving it alone.")?;
    if let Some((ev, _)) = EVENTS.iter().find(|(ev, _)| hooks.get(*ev).is_some_and(|v| !v.is_array())) {
        return Err(format!("The Claude Code settings file has \"hooks.{ev}\" of an unexpected type; leaving it alone."));
    }
    Ok(hooks)
}

/// Peeka's group for every event, an older one of ours replaced. Exec form (no shell); `async`, so Claude Code
/// never waits, and it prints nothing, so a PermissionRequest still gets Claude Code's own prompt.
pub fn merge(doc: &mut Value, exe: &str) -> Result<(), String> {
    let hooks = hooks_of(doc)?;
    for (ev, _) in EVENTS {
        let list = hooks.entry(ev).or_insert_with(|| json!([])).as_array_mut().expect("checked in hooks_of");
        strip(list);
        list.push(json!({ "hooks": [{
            "type": "command", "command": exe, "args": [HOOK_ARG], "async": true, "timeout": TIMEOUT_S,
        }] }));
    }
    Ok(())
}

/// Only Peeka's entries go; an event list left empty by that goes too.
pub fn remove(doc: &mut Value) -> Result<(), String> {
    if doc.get("hooks").is_none() {
        return Ok(());
    }
    let hooks = hooks_of(doc)?;
    for (ev, _) in EVENTS {
        if let Some(list) = hooks.get_mut(ev).and_then(Value::as_array_mut) {
            if strip(list) && list.is_empty() {
                hooks.remove(ev);
            }
        }
    }
    Ok(())
}

/// (any entry of ours, every event has ours pointing at `exe`).
pub fn status(doc: &Value, exe: &str) -> (bool, bool) {
    let ours = |ev: &str| -> Vec<&Value> {
        doc.pointer(&format!("/hooks/{ev}"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|g| g.get("hooks").and_then(Value::as_array))
            .flatten()
            .filter(|h| is_ours(h))
            .collect()
    };
    let any = EVENTS.iter().any(|(ev, _)| !ours(ev).is_empty());
    let current = EVENTS.iter().all(|(ev, _)| ours(ev).iter().any(|h| h.get("command") == Some(&json!(exe))));
    (any, current)
}

fn read(path: &Path) -> Result<Option<Value>, String> {
    match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b)
            .map(Some)
            .map_err(|_| "The Claude Code settings file could not be read; leaving it alone until you fix it by hand.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("The Claude Code settings file could not be opened; leaving it alone.".into()),
    }
}

/// Read, change, and (only if it changed) back up to `settings.json.bak-peeka`, then tmp + rename.
fn edit(path: &Path, f: impl FnOnce(&mut Value) -> Result<(), String>) -> Result<(), String> {
    let old = read(path)?;
    let existed = old.is_some();
    let mut doc = old.clone().unwrap_or_else(|| json!({}));
    f(&mut doc)?;
    if Some(&doc) == old.as_ref() || (!existed && doc == json!({})) {
        return Ok(());
    }
    let fail = |_| "The Claude Code settings file could not be written.".to_string();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(fail)?;
    }
    if existed {
        std::fs::copy(path, path.with_extension("json.bak-peeka")).map_err(fail)?;
    }
    let tmp = path.with_extension("json.tmp-peeka");
    let bytes = serde_json::to_vec_pretty(&doc).map_err(|_| "The Claude Code settings file could not be written.".to_string())?;
    std::fs::write(&tmp, bytes).map_err(fail)?;
    std::fs::rename(&tmp, path).map_err(fail)
}

/// Settings › "Install": Peeka's hooks into `path` (Claude Code's `settings.json`), pointing at `exe`.
pub fn install(path: &Path, exe: &str) -> Result<(), String> {
    edit(path, |d| merge(d, exe))
}

/// "Remove".
pub fn uninstall(path: &Path) -> Result<(), String> {
    edit(path, remove)
}

/// (installed, points at `exe`); a missing or unreadable file = not installed.
pub fn file_status(path: &Path, exe: &str) -> (bool, bool) {
    read(path).ok().flatten().map_or((false, false), |d| status(&d, exe))
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
        let p = hook_params(&raw, None).unwrap();
        assert_eq!(p, json!({"kind": "pre_tool", "tool": "Bash", "reason": null, "sid": null}), "no salt, no sid");
        let s = p.to_string();
        for leak in ["rm -rf", "secret", "b.txt", "hunter22", "output", "hidden", "jsonl", "raw-session"] {
            assert!(!s.contains(leak), "{leak}");
        }
        for bad in [r"C:\Windows\cmd.exe", "/usr/bin/bash", "rm -rf /", "Bash; echo x", &"a".repeat(65), "", "sécret"] {
            let p = hook_params(&json!({"hook_event_name": "PreToolUse", "tool_name": bad}), None).unwrap();
            assert_eq!(p["tool"], Value::Null, "{bad}");
        }
        assert!(word(&"a".repeat(64)) && word("mcp__x__web.search"));
        assert_eq!(
            hook_params(&json!({"hook_event_name": "StopFailure", "error": "rate_limit"}), None).unwrap(),
            json!({"kind": "stop_failure", "tool": null, "reason": "rate_limit", "sid": null})
        );
        let n = json!({"hook_event_name": "Notification", "notification_type": "permission_prompt", "message": "x y"});
        assert_eq!(hook_params(&n, None).unwrap()["reason"], "permission_prompt");
        assert_eq!(hook_params(&json!({"hook_event_name": "PermissionRequest"}), None).unwrap()["kind"], "permission");
        assert_eq!(
            hook_params(&json!({"hook_event_name": "Stop", "error": "rate_limit"}), None).unwrap()["reason"],
            Value::Null
        );
        assert!(hook_params(&json!({"hook_event_name": "PreCompact"}), None).is_none());
        assert!(hook_params(&json!({"tool_name": "Bash"}), None).is_none());
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
        let p = hook_params(&raw, Some(&[7; 32])).unwrap();
        assert_eq!(p["sid"], json!(session_tag(&[7; 32], "9c1d2e3f-raw-id")));
        let s = p.to_string();
        assert!(!s.contains("9c1d2e3f") && !s.contains("raw-id") && !s.contains("hidden"), "{s}");
        for bad in [json!(5), json!(""), json!("x".repeat(300))] {
            let q = hook_params(&json!({"hook_event_name": "Stop", "session_id": bad}), Some(&[7; 32])).unwrap();
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
        merge(&mut d, r"C:\Program Files\Peeka\notch.exe").unwrap();
        assert_eq!(status(&d, EXE), (true, false), "old notch.exe entries: Reinstall");
        merge(&mut d, EXE).unwrap();
        assert_eq!(status(&d, EXE), (true, true));
        assert_eq!(d["hooks"]["PreToolUse"].as_array().unwrap().len(), 3, "replaced, not added beside it");
    }

    #[test]
    fn merge_is_idempotent_and_keeps_the_owners_hooks() {
        let mut d = owner_doc();
        merge(&mut d, EXE).unwrap();
        let once = d.clone();
        merge(&mut d, EXE).unwrap();
        assert_eq!(d, once, "a second Install changes nothing");
        assert_eq!(status(&d, EXE), (true, true));
        assert_eq!(status(&d, r"C:\new\peeka.exe"), (true, false), "moved: points at the old exe");
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

        merge(&mut d, r"C:\new\peeka.exe").unwrap();
        assert_eq!(d["hooks"]["PreToolUse"].as_array().unwrap().len(), 3, "an older entry of ours is replaced");

        remove(&mut d).unwrap();
        assert_eq!(d, owner_doc(), "Remove leaves exactly the owner's file");
        assert_eq!(status(&d, EXE), (false, false));
        remove(&mut d).unwrap();
        assert_eq!(d, owner_doc());
    }

    #[test]
    fn a_file_of_an_unexpected_shape_is_refused_untouched() {
        for bad in [json!([]), json!({"hooks": []}), json!({"hooks": {"Stop": {"x": 1}}})] {
            let mut d = bad.clone();
            assert!(merge(&mut d, EXE).is_err(), "{bad}");
            assert_eq!(d, bad);
        }
        let tmp = Tmp::new();
        let path = tmp.write(".claude/settings.json", b"{nope");
        assert!(install(&path, EXE).is_err() && uninstall(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{nope", "never overwritten");
    }

    #[test]
    fn install_and_uninstall_on_a_file() {
        let tmp = Tmp::new();
        let path = tmp.path().join(".claude").join("settings.json");
        assert_eq!(file_status(&path, EXE), (false, false));
        uninstall(&path).unwrap();
        assert!(!path.exists(), "nothing to remove: no file made");
        install(&path, EXE).unwrap();
        assert_eq!(file_status(&path, EXE), (true, true));
        assert!(!path.with_extension("json.bak-peeka").exists(), "no backup of a file that did not exist");

        std::fs::write(&path, serde_json::to_vec(&owner_doc()).unwrap()).unwrap();
        install(&path, EXE).unwrap();
        let bak: Value =
            serde_json::from_slice(&std::fs::read(path.with_extension("json.bak-peeka")).unwrap()).unwrap();
        assert_eq!(bak, owner_doc(), "the backup is the file before the change");
        uninstall(&path).unwrap();
        let back: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(back, owner_doc());
        assert_eq!(back.to_string(), owner_doc().to_string(), "the owner's key order too (preserve_order)");
        assert!(!path.with_extension("json.tmp-peeka").exists());
    }
}
