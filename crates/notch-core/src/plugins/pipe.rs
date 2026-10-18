//! Discovery and the pipe's identity, the parts without Windows calls: the per-user pipe name,
//! the DACL as SDDL (built here so a test can read it), and `endpoint.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::API_VERSION;
use crate::CODE_NAME;

pub const ENDPOINT_FILE: &str = "endpoint.json";

/// A string SID: `S-1-` and then digits and dashes only (nothing that could close the SDDL ACE).
pub fn valid_sid(sid: &str) -> bool {
    sid.len() <= 184 && sid.starts_with("S-1-") && sid[4..].chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// `\\.\pipe\notch-<SID>`.
pub fn pipe_name(sid: &str) -> Option<String> {
    valid_sid(sid).then(|| format!(r"\\.\pipe\{CODE_NAME}-{sid}"))
}

/// `\\.\pipe\notch-cc-<SID>`: Peeka's own Claude Code hook (one `cc.event` line per connection, no handshake).
pub fn cc_pipe_name(sid: &str) -> Option<String> {
    valid_sid(sid).then(|| format!(r"\\.\pipe\{CODE_NAME}-cc-{sid}"))
}

/// Protected DACL (`P`: nothing inherited): the NETWORK logon SID (`NU`) is denied first, then full access for this
/// one user SID and nobody else. Remote clients are also refused by `PIPE_REJECT_REMOTE_CLIENTS` (tokio's default).
pub fn sddl(sid: &str) -> Option<String> {
    valid_sid(sid).then(|| format!("D:P(D;;GA;;;NU)(A;;GA;;;{sid})"))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Endpoint {
    pub pipe: String,
    pub api_version: u32,
    pub pid: u32,
}

pub fn endpoint_path(data_dir: &Path) -> PathBuf {
    data_dir.join(ENDPOINT_FILE)
}

pub fn write_endpoint(data_dir: &Path, pipe: &str, pid: u32) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = endpoint_path(data_dir);
    let tmp = path.with_extension("json.tmp");
    let e = Endpoint { pipe: pipe.into(), api_version: API_VERSION, pid };
    std::fs::write(&tmp, serde_json::to_vec(&e).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, path)
}

/// Deletes `endpoint.json` only when it is ours (another Notch may have written it since).
pub fn remove_endpoint(data_dir: &Path, pid: u32) {
    let path = endpoint_path(data_dir);
    let ours = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Endpoint>(&b).ok())
        .is_some_and(|e| e.pid == pid);
    if ours {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    const SID: &str = "S-1-5-21-1004336348-1177238915-682003330-1001";

    #[test]
    fn the_dacl_allows_only_the_user_sid_and_denies_the_network() {
        let s = sddl(SID).unwrap();
        assert_eq!(s, format!("D:P(D;;GA;;;NU)(A;;GA;;;{SID})"));
        let aces: Vec<&str> = s.trim_start_matches("D:P").split(['(', ')']).filter(|a| !a.is_empty()).collect();
        let allows: Vec<&str> = aces.iter().filter(|a| a.starts_with("A;")).copied().collect();
        assert_eq!(allows, [format!("A;;GA;;;{SID}")], "exactly one allow ACE: this user");
        assert!(aces[0].starts_with("D;") && aces[0].ends_with(";NU"), "deny ACE first, for NETWORK");
        for other in ["WD", "AU", "BU", "SY", "BA", "AN", "IU"] {
            assert!(!aces.iter().any(|a| a.ends_with(&format!(";{other}")) && a.starts_with("A;")), "{other}");
        }
        assert!(s.starts_with("D:P"), "protected: nothing inherited");
    }

    #[test]
    fn a_sid_cannot_inject_aces_or_change_the_pipe_name() {
        for bad in ["S-1-5-21)(A;;GA;;;WD", "WD", "S-1-5-21-1\\..\\x", "", "s-1-5-21"] {
            assert!(sddl(bad).is_none() && pipe_name(bad).is_none(), "{bad}");
        }
        assert_eq!(pipe_name(SID).unwrap(), format!(r"\\.\pipe\notch-{SID}"));
        assert_eq!(cc_pipe_name(SID).unwrap(), format!(r"\\.\pipe\notch-cc-{SID}"));
        assert!(cc_pipe_name("S-1-5)(A;;GA;;;WD").is_none());
    }

    #[test]
    fn endpoint_is_written_and_removed_only_by_its_owner() {
        let tmp = Tmp::new();
        write_endpoint(tmp.path(), r"\\.\pipe\notch-S-1-5", 42).unwrap();
        let e: Endpoint = serde_json::from_slice(&std::fs::read(endpoint_path(tmp.path())).unwrap()).unwrap();
        assert_eq!((e.api_version, e.pid), (1, 42));
        remove_endpoint(tmp.path(), 7);
        assert!(endpoint_path(tmp.path()).exists(), "another pid's file stays");
        remove_endpoint(tmp.path(), 42);
        assert!(!endpoint_path(tmp.path()).exists());
    }
}
