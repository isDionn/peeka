//! One-shot share folder `%LOCALAPPDATA%\notch\share\`: a large attachment is written here and
//! only its path goes over the pipe; it is deleted on `share.done {id}` or after 10 minutes at the latest. Nothing
//! else of Notch's ever goes in here.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const DIR: &str = "share";
pub const TTL: Duration = Duration::from_secs(600);

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join(DIR)
}

/// A share id: 32 lowercase hex characters (also the file stem). Anything else is never a path.
pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// Writes `bytes` as `<random id>.<ext>`; returns (id, full path). `ext` is Notch's own ("png", "txt").
pub fn put(data_dir: &Path, bytes: &[u8], ext: &str) -> std::io::Result<(String, PathBuf)> {
    let mut r = [0u8; 16];
    getrandom::fill(&mut r).map_err(|e| std::io::Error::other(e.to_string()))?;
    let id: String = r.iter().map(|b| format!("{b:02x}")).collect();
    let d = dir(data_dir);
    std::fs::create_dir_all(&d)?;
    let path = d.join(format!("{id}.{ext}"));
    std::fs::write(&path, bytes)?;
    Ok((id, path))
}

/// `share.done {id}`: the file with that stem goes. False = no such share.
pub fn done(data_dir: &Path, id: &str) -> bool {
    if !valid_id(id) {
        return false;
    }
    let Ok(rd) = std::fs::read_dir(dir(data_dir)) else { return false };
    let mut hit = false;
    for e in rd.flatten() {
        if e.path().file_stem().and_then(|s| s.to_str()) == Some(id) {
            hit |= std::fs::remove_file(e.path()).is_ok();
        }
    }
    hit
}

/// Deletes every file older than `ttl` (by modification time); returns how many went.
pub fn sweep(data_dir: &Path, now: SystemTime, ttl: Duration) -> usize {
    let Ok(rd) = std::fs::read_dir(dir(data_dir)) else { return 0 };
    rd.flatten()
        .filter(|e| {
            let age = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| now.duration_since(t).ok());
            age.is_some_and(|a| a >= ttl) && e.file_type().is_ok_and(|t| t.is_file())
        })
        .filter(|e| std::fs::remove_file(e.path()).is_ok())
        .count()
}

/// A share-folder file's text when it is small (1..=`max` bytes), UTF-8, without NUL and without a secret shape;
/// None otherwise. Only `<32 hex>.<ext>` files directly in `share\`, never a link: what Notch itself wrote.
pub fn small_text(data_dir: &Path, path: &Path, max: usize) -> Option<String> {
    let ours = path.parent() == Some(dir(data_dir).as_path())
        && path.file_stem().and_then(|s| s.to_str()).is_some_and(valid_id);
    let meta = std::fs::symlink_metadata(path).ok().filter(|m| ours && m.is_file())?;
    if meta.len() == 0 || meta.len() > max as u64 {
        return None;
    }
    let text = String::from_utf8(std::fs::read(path).ok()?).ok()?;
    (!text.contains('\0') && !crate::clip::secret::has_secret(&text)).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    #[test]
    fn put_done_and_the_ten_minute_sweep() {
        let tmp = Tmp::new();
        let (id, path) = put(tmp.path(), b"png", "png").unwrap();
        assert!(valid_id(&id) && path.starts_with(dir(tmp.path())) && path.exists());
        assert!(!done(tmp.path(), "../../plugins"), "not an id");
        assert!(done(tmp.path(), &id) && !path.exists());
        let (_, old) = put(tmp.path(), b"x", "txt").unwrap();
        assert_eq!(sweep(tmp.path(), SystemTime::now(), TTL), 0, "young files stay");
        assert_eq!(sweep(tmp.path(), SystemTime::now() + TTL, TTL), 1);
        assert!(!old.exists());
    }

    #[test]
    fn small_text_only_for_notchs_own_small_utf8_copies() {
        let tmp = Tmp::new();
        let (_, txt) = put(tmp.path(), "small note".as_bytes(), "txt").unwrap();
        assert_eq!(small_text(tmp.path(), &txt, 100).as_deref(), Some("small note"));
        assert_eq!(small_text(tmp.path(), &txt, 5), None, "over the cap");
        let (_, png) = put(tmp.path(), &[0x89, b'P', b'N', b'G', 0xff], "png").unwrap();
        assert_eq!(small_text(tmp.path(), &png, 100), None, "not UTF-8");
        let (_, nul) = put(tmp.path(), b"a\0b", "bin").unwrap();
        assert_eq!(small_text(tmp.path(), &nul, 100), None, "binary");
        let (_, key) = put(tmp.path(), concat!("sk-ant-api03-abcdefghijklmnop", "qrstuvwxyz012345").as_bytes(), "txt").unwrap(); // allow-secret
        assert_eq!(small_text(tmp.path(), &key, 100), None, "a secret shape is never inlined");
        let outside = tmp.path().join("plugins.json");
        std::fs::write(&outside, "{}").unwrap();
        assert_eq!(small_text(tmp.path(), &outside, 100), None, "outside the share folder");
        let renamed = dir(tmp.path()).join("not-an-id.txt");
        std::fs::write(&renamed, "x").unwrap();
        assert_eq!(small_text(tmp.path(), &renamed, 100), None, "not a share id");
    }
}
