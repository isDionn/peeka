//! `hello`'s manifest: checked at the trust boundary. Unknown scope = refused, unknown field = ignored.

use std::collections::BTreeMap;

use serde_json::Value;

use super::{Scope, API_VERSION};
use crate::alerts::text;

pub const MAX_ID: usize = 64;
const MAX_NAME: usize = 40;
const MAX_PUBLISHER: usize = 60;
const MAX_VERSION: usize = 24;
const MAX_WHY: usize = 200;
/// On top of `items::display`'s `›`-likes: what else reads as "Assistant › Claude Code" in a name. All become '-'.
const NAME_SEPARATORS: [char; 14] = ['>', '<', '/', '|', '¦', '‣', '→', '⇒', '⟶', '➔', '➜', '➤', '▸', '►'];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub scopes: Vec<Scope>,
    pub why: BTreeMap<Scope, String>,
    /// The exe Peeka may start on the owner's click while this plugin is the main assistant (`launch_path`).
    pub launch: Option<String>,
}

const MAX_LAUNCH: usize = 260;

/// `launch`: an absolute `X:\...\name.exe` path, nothing a shell would read (no quotes, arguments, wildcards,
/// `.`/`..` or UNC). Peeka runs it as given, never through a command line.
pub fn launch_path(s: &str) -> bool {
    let b = s.as_bytes();
    // The first three bytes are ASCII here, so `s[3..]` is a char boundary.
    let drive = b.len() > 7 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\';
    let part = |p: &str| !p.is_empty() && p != "." && p != ".." && p.trim_end() == p && !p.ends_with('.');
    drive
        && s.len() <= MAX_LAUNCH
        && s.to_ascii_lowercase().ends_with(".exe")
        && !s[3..].chars().any(|c| c.is_control() || matches!(c, '"' | '/' | ':' | '*' | '?' | '<' | '>' | '|'))
        && s[3..].split('\\').all(part)
}

/// Reverse domain name: at least two dot-separated labels of `a-z 0-9 -`, none empty or starting/ending with `-`.
pub fn valid_id(id: &str) -> bool {
    let label = |l: &str| {
        !l.is_empty()
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    id.len() <= MAX_ID && id.split('.').count() >= 2 && id.split('.').all(label)
}

/// A display name (Notch draws "<name> › <title>"): tags stripped, separators flattened, so a plugin cannot draw
/// "Assistant › Claude Code" as its own name.
fn name_text(v: &Value, limit: usize) -> Option<String> {
    let s = super::items::display(v, limit)?;
    let s: String = s.chars().map(|c| if NAME_SEPARATORS.contains(&c) { '-' } else { c }).collect();
    text(&Value::String(s), limit)
}

pub fn parse(p: &Value) -> Result<Manifest, String> {
    let get = |k: &str| p.get(k).unwrap_or(&Value::Null);
    let id = get("id").as_str().filter(|s| valid_id(s)).ok_or("id: must be in reverse-domain form (64 characters at most)")?;
    let name = name_text(get("name"), MAX_NAME).ok_or("name gerekli")?;
    let publisher = name_text(get("publisher"), MAX_PUBLISHER).ok_or("publisher gerekli")?;
    let version = text(get("version"), MAX_VERSION).ok_or("version gerekli")?;
    if get("api").as_u64() != Some(u64::from(API_VERSION)) {
        return Err(format!("api: this Peeka only speaks {API_VERSION}"));
    }
    let list = get("scopes").as_array().ok_or("scopes must be a list")?;
    let mut scopes = vec![];
    for s in list {
        let name = s.as_str().unwrap_or_default();
        let scope = Scope::parse(name)
            .ok_or_else(|| format!("bilinmeyen kapsam: {}", name.chars().take(40).collect::<String>()))?;
        if !scopes.contains(&scope) {
            scopes.push(scope);
        }
    }
    if scopes.is_empty() {
        return Err("request at least one scope".into());
    }
    let why = get("why")
        .as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| Some((Scope::parse(k).filter(|s| scopes.contains(s))?, text(v, MAX_WHY)?)))
                .collect()
        })
        .unwrap_or_default();
    let launch = match get("launch") {
        Value::Null => None,
        v => Some(v.as_str().filter(|s| launch_path(s)).ok_or(r"launch: must be an absolute .exe path (C:\...\name.exe)")?.into()),
    };
    Ok(Manifest { id: id.into(), name, publisher, version, scopes, why, launch })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hello() -> Value {
        json!({"id":"com.example.assistant","name":"Sample Assistant","publisher":"Sample","version":"1.2.0","api":1,
               "scopes":["island.protrusion","card.module","composer.handler"],
               "why":{"composer.handler":"for Ctrl+Space","clipboard.read":"not requested","x":"y"},
               "icon":"https://evil.test/logo.png"})
    }

    #[test]
    fn the_doc_example_parses_and_extra_fields_are_ignored() {
        let m = parse(&hello()).unwrap();
        assert_eq!(m.id, "com.example.assistant");
        assert_eq!(m.scopes, [Scope::IslandProtrusion, Scope::CardModule, Scope::ComposerHandler]);
        assert_eq!(m.why.len(), 1, "why only for requested scopes");
    }

    #[test]
    fn an_unknown_scope_is_refused() {
        let mut h = hello();
        h["scopes"] = json!(["island.protrusion", "keyboard.read"]);
        assert!(parse(&h).unwrap_err().contains("keyboard.read"));
        h["scopes"] = json!([]);
        assert!(parse(&h).is_err());
    }

    #[test]
    fn ids_names_and_api_are_checked() {
        for id in ["assistant", "Com.Example.X", "com..x", "-a.b", "a.b-", &format!("a.{}", "b".repeat(70)), "a.b/c"] {
            assert!(!valid_id(id), "{id}");
        }
        assert!(valid_id("dev.example.core") && valid_id("com.example-1.x2"));
        let mut h = hello();
        h["api"] = json!(2);
        assert!(parse(&h).is_err());
        let mut h = hello();
        h["name"] = json!("\u{202e}\u{200b}");
        assert!(parse(&h).is_err(), "only invisible characters = no name");
        let mut h = hello();
        h["name"] = json!("C\u{202e}ompass\n");
        assert_eq!(parse(&h).unwrap().name, "Compass", "bidi and control characters are dropped");
    }

    #[test]
    fn separators_in_names_are_flattened() {
        for (raw, want) in [
            ("Compass › Claude Code", "Compass - Claude Code"),
            ("Notch » Security", "Notch - Security"),
            ("Compass > X / Y | Z", "Compass - X - Y - Z"),
            ("Compass ‣ X → Y", "Compass - X - Y"),
            ("<b>Compass</b> Help", "Compass Help"),
        ] {
            let mut h = hello();
            h["name"] = json!(raw);
            h["publisher"] = json!(raw);
            let m = parse(&h).unwrap();
            assert_eq!((m.name.as_str(), m.publisher.as_str()), (want, want), "{raw}");
        }
    }

    #[test]
    fn launch_is_an_absolute_exe_path_or_refused() {
        for ok in [r"C:\Program Files\Ornek\ornek.exe", r"d:\a\B.EXE"] {
            assert!(launch_path(ok), "{ok}");
        }
        for bad in [
            "ornek.exe",
            r"\\server\share\x.exe",
            r"C:ornek.exe",
            r"C:\a\..\x.exe",
            r"C:\a\x.bat",
            r#"C:\a\x.exe" --kill"#,
            "C:/a/x.exe",
            r"C:\a\x.exe:alt.exe",
            "C:\\a\nb\\x.exe",
            r"C:\a\\x.exe",
        ] {
            assert!(!launch_path(bad), "{bad}");
        }
        let mut h = hello();
        assert_eq!(parse(&h).unwrap().launch, None, "optional");
        h["launch"] = json!(r"C:\Ornek\ornek.exe");
        assert_eq!(parse(&h).unwrap().launch.as_deref(), Some(r"C:\Ornek\ornek.exe"));
        h["launch"] = json!("cmd /c calc");
        assert!(parse(&h).unwrap_err().starts_with("launch"));
        h["launch"] = json!(7);
        assert!(parse(&h).is_err());
    }
}
