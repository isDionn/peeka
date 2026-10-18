//! Notch core: the domain model, the ports the Windows adapters implement, and fakes for them.
//! Nothing here calls Windows or Tauri, so `cargo test` runs anywhere and can never touch the live desktop.

pub mod alerts;
pub mod apps;
pub mod capture;
pub mod clickthrough;
pub mod clip;
pub mod cmd;
pub mod contract;
pub mod downloads;
pub mod fake;
pub mod fidelity;
pub mod http_alerts;
pub mod input;
pub mod lock;
pub mod media;
pub mod mirror;
pub mod model;
pub mod plugins;
pub mod ports;
pub mod presence;
pub mod preview;
pub mod privacy;
pub mod recap;
pub mod screens;
pub mod search;
pub mod session_window;
pub mod settings;
pub mod shelf;
pub mod shortcuts;
pub mod sources;
pub mod status;
pub mod supervise;
pub mod sysmon;
pub mod taskbar;
pub mod timer;
pub mod tray;

#[cfg(test)]
pub(crate) mod test_util;

use std::path::{Path, PathBuf};

/// The only place the product name lives in Rust (the other is `tauri.conf.json`).
pub const PRODUCT_NAME: &str = "Peeka";
/// Code name: data folder, pipe name, file names. Never the product name.
pub const CODE_NAME: &str = "notch";
/// Tests and dev runs point the data folder elsewhere.
pub const DATA_DIR_ENV: &str = "NOTCH_DATA_DIR";

/// `NOTCH_DATA_DIR`, else `%LOCALAPPDATA%\notch`. None = neither is set (no place to keep the marker).
pub fn data_dir() -> Option<PathBuf> {
    data_dir_from(std::env::var_os(DATA_DIR_ENV), std::env::var_os("LOCALAPPDATA"))
}

fn data_dir_from(over: Option<std::ffi::OsString>, local: Option<std::ffi::OsString>) -> Option<PathBuf> {
    match over.filter(|v| !v.is_empty()) {
        Some(dir) => Some(PathBuf::from(dir)),
        None => local.filter(|v| !v.is_empty()).map(|l| PathBuf::from(l).join(CODE_NAME)),
    }
}

/// Names in the data folder that used to be Turkish (old, new); a parent comes before the names inside it.
const OLD_NAMES: [(&str, &str); 4] = [
    ("pano", "clipboard"),
    ("clipboard/gecmis.json", "clipboard/history.json"),
    ("clipboard/gizli.bin", "clipboard/vault.bin"),
    ("paylasim", "share"),
];

/// Startup, before anything opens these: renames each old name once, only when the new one isn't there (never
/// overwrites; a failed rename leaves the old name in place).
pub fn migrate_data_dir(dir: &Path) {
    for (old, new) in OLD_NAMES {
        let (old, new) = (dir.join(old), dir.join(new));
        if old.exists() && !new.exists() {
            let _ = std::fs::rename(old, new);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_env_override_wins_and_the_default_is_localappdata_code_name() {
        assert_eq!(data_dir_from(Some("X:\\t".into()), Some("C:\\L".into())), Some(PathBuf::from("X:\\t")));
        assert_eq!(data_dir_from(None, Some("C:\\L".into())), Some(PathBuf::from("C:\\L").join("notch")));
        assert_eq!(data_dir_from(Some("".into()), None), None);
    }

    #[test]
    fn the_old_turkish_names_are_renamed_once_and_never_overwrite() {
        let tmp = crate::test_util::Tmp::new();
        tmp.write("pano/gecmis.json", b"h");
        tmp.write("pano/gizli.bin", b"v");
        tmp.write("pano/img/a.png", b"i");
        tmp.write("paylasim/x.txt", b"s");
        tmp.write("share/keep.txt", b"new");
        migrate_data_dir(tmp.path());
        let read = |rel: &str| std::fs::read(tmp.path().join(rel)).ok();
        assert_eq!(read("clipboard/history.json").as_deref(), Some(&b"h"[..]));
        assert_eq!(read("clipboard/vault.bin").as_deref(), Some(&b"v"[..]));
        assert_eq!(read("clipboard/img/a.png").as_deref(), Some(&b"i"[..]));
        assert!(!tmp.path().join("pano").exists());
        assert_eq!(read("paylasim/x.txt").as_deref(), Some(&b"s"[..]), "share already exists: the old folder stays");
        migrate_data_dir(tmp.path());
        assert_eq!(read("clipboard/history.json").as_deref(), Some(&b"h"[..]));
    }
}
