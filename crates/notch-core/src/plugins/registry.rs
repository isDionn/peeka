//! `plugins.json`: per paired plugin only the SHA-256 digest of its token, the scopes the owner gave,
//! the ones the owner turned off since, and when. The token itself is shown to the plugin once and never stored.
//! Also the main assistant (the owner's choice) and the "never ask again" list.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::Scope;

pub const FILE: &str = "plugins.json";

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    /// Hex SHA-256 of the token's 32 bytes.
    pub digest: String,
    pub granted: BTreeSet<Scope>,
    /// Granted, then turned off by the owner in Settings › Plugins.
    #[serde(default)]
    pub disabled: BTreeSet<Scope>,
    pub approved_at: u64,
    #[serde(default)]
    pub last_seen: Option<u64>,
    /// The manifest's `launch` at pairing (`manifest::launch_path`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch: Option<String>,
}

impl Record {
    pub fn active(&self, s: Scope) -> bool {
        self.granted.contains(&s) && !self.disabled.contains(&s)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default)]
    pub plugins: Vec<Record>,
    /// The main assistant's id (owner's choice only; it must hold `composer.handler`).
    #[serde(default)]
    pub main: Option<String>,
    /// "Never ask about this plugin again".
    #[serde(default)]
    pub blocked: BTreeSet<String>,
    /// Settings › Modules: tab order and the tabs turned off (Notch's ids and "<plugin id>/<tab id>").
    #[serde(default)]
    pub modules: ModulePrefs,
    /// A main assistant has reached Notch at least once (the "first connection" card shows once in a lifetime).
    #[serde(default)]
    pub main_seen: bool,
    /// That card is waiting for the owner (`first_connect_ack` puts it out).
    #[serde(default)]
    pub first_connect: bool,
    /// Settings › Permission history: who got or lost which scope, newest last, at most `PERMISSION_LOG_MAX`. Names and
    /// scope names only, never a token or digest.
    #[serde(default)]
    pub permission_log: Vec<PermissionEvent>,
}

pub const PERMISSION_LOG_MAX: usize = 100;

/// fidelity-api.ts `PermissionEvent`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionEvent {
    /// Unix ms.
    pub at: u64,
    /// The plugin's display name at that moment.
    pub plugin: String,
    pub scope: Scope,
    pub granted: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModulePrefs {
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub off: BTreeSet<String>,
}

impl Registry {
    pub fn get(&self, id: &str) -> Option<&Record> {
        self.plugins.iter().find(|r| r.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Record> {
        self.plugins.iter_mut().find(|r| r.id == id)
    }

    pub fn upsert(&mut self, r: Record) {
        self.plugins.retain(|x| x.id != r.id);
        self.plugins.push(r);
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.plugins.len();
        self.plugins.retain(|r| r.id != id);
        if self.main.as_deref() == Some(id) {
            self.main = None;
        }
        self.plugins.len() != before
    }

    pub fn is_main(&self, id: &str) -> bool {
        self.main.as_deref() == Some(id)
    }

    pub fn main_name(&self) -> Option<&str> {
        self.main.as_deref().and_then(|m| self.get(m)).map(|r| r.name.as_str())
    }

    /// `auth`: the record when the token's digest matches (compared without an early exit). Unknown id and wrong
    /// token look the same to the caller.
    pub fn verify(&self, id: &str, token: &str) -> Option<&Record> {
        let presented = digest_of(token)?;
        self.get(id).filter(|r| ct_eq(r.digest.as_bytes(), presented.as_bytes()))
    }
}

/// Length-independent of where the first difference is (digests are fixed-length).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A fresh token (32 OS-random bytes, base64) and its digest.
pub fn new_token() -> std::io::Result<(String, String)> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let token = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok((token, hex(&Sha256::digest(bytes))))
}

/// The digest of a presented token; None when it is not base64 of exactly 32 bytes.
pub fn digest_of(token: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(token.as_bytes()).ok()?;
    (bytes.len() == 32).then(|| hex(&Sha256::digest(&bytes)))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Notch's core module ids were Turkish before; saved prefs are mapped to the English ids on load (old id, new id).
const OLD_MODULE_IDS: [(&str, &str); 8] = [
    ("genel", "general"),
    ("müzik", "music"),
    ("pano", "clipboard"),
    ("raf", "shelf"),
    ("takvim", "calendar"),
    ("zamanlayıcı", "timer"),
    ("sistem", "system"),
    ("bildirimler", "notifications"),
];

fn migrate_module_ids(m: &mut ModulePrefs) {
    let new = |id: String| OLD_MODULE_IDS.iter().find(|(old, _)| *old == id).map_or(id, |(_, n)| n.to_string());
    m.order = std::mem::take(&mut m.order).into_iter().map(new).collect();
    m.off = std::mem::take(&mut m.off).into_iter().map(new).collect();
}

/// Missing or corrupt = empty (a corrupt file is kept aside, like the settings file; nobody is paired then).
pub fn load(path: &Path) -> Registry {
    let Ok(bytes) = std::fs::read(path) else { return Registry::default() };
    match serde_json::from_slice::<Registry>(&bytes) {
        Ok(mut r) => {
            migrate_module_ids(&mut r.modules);
            r
        }
        Err(_) => {
            let _ = std::fs::rename(path, path.with_extension("json.bad"));
            Registry::default()
        }
    }
}

pub fn save(path: &Path, r: &Registry) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(r).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    fn record(id: &str, digest: String) -> Record {
        Record {
            id: id.into(),
            name: "Compass".into(),
            publisher: "Ornek".into(),
            version: "1".into(),
            digest,
            granted: [Scope::IslandProtrusion].into(),
            disabled: BTreeSet::new(),
            approved_at: 1,
            last_seen: None,
            launch: None,
        }
    }

    #[test]
    fn only_the_digest_is_stored_and_verify_needs_the_exact_token() {
        let tmp = Tmp::new();
        let (token, digest) = new_token().unwrap();
        let mut r = Registry::default();
        r.upsert(record("dev.example", digest.clone()));
        save(&path(tmp.path()), &r).unwrap();
        let file = std::fs::read_to_string(path(tmp.path())).unwrap();
        assert!(!file.contains(&token) && file.contains(&digest), "token never on disk");
        let r = load(&path(tmp.path()));
        assert!(r.verify("dev.example", &token).is_some());
        let (other, _) = new_token().unwrap();
        assert!(r.verify("dev.example", &other).is_none(), "wrong token");
        assert!(r.verify("dev.other", &token).is_none(), "right token, wrong id");
        assert!(r.verify("dev.example", "").is_none() && r.verify("dev.example", "bm90LTMyLWJ5dGVz").is_none());
        assert!(r.verify("dev.example", &digest).is_none(), "the digest is not a token");
    }

    #[test]
    fn a_corrupt_file_is_kept_aside_and_nobody_is_paired() {
        let tmp = Tmp::new();
        let p = tmp.write(FILE, b"{not json");
        assert_eq!(load(&p), Registry::default());
        assert!(tmp.path().join("plugins.json.bad").exists());
    }

    #[test]
    fn old_turkish_module_ids_load_as_english() {
        let tmp = Tmp::new();
        // Old Turkish module ids on purpose: they feed the migration table with ids saved by earlier versions.
        let p = tmp.write(FILE, r#"{"modules":{"order":["müzik","genel","dev.x/cc"],"off":["sistem"]}}"#.as_bytes());
        let m = load(&p).modules;
        assert_eq!(m.order, ["music", "general", "dev.x/cc"]);
        assert_eq!(m.off, ["system".to_string()].into());
    }

    #[test]
    fn removing_the_main_assistant_clears_the_choice() {
        let mut r = Registry::default();
        r.upsert(record("dev.example", "d".into()));
        r.main = Some("dev.example".into());
        assert_eq!(r.main_name(), Some("Compass"));
        assert!(r.remove("dev.example") && r.main.is_none());
    }
}
