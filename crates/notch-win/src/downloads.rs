// Peeka — original implementation (MIT).
//! The Downloads folder (scenario 29): where it is (the known-folder API, so a moved or redirected folder works),
//! a plain listing of its files (name and size only), and "Show in folder". What a listing means is
//! `notch_core::downloads` (tested there). Nothing is read from inside a file.

use std::path::{Path, PathBuf};

/// The user's Downloads folder; None when Windows has none or it does not exist.
#[cfg(windows)]
pub fn folder() -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    // SAFETY: a static folder id; on success Windows hands back a CoTaskMem string we free below.
    let raw = unsafe { SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None) }.ok()?;
    // SAFETY: `raw` is a valid NUL-terminated wide string until freed.
    let path = unsafe { raw.to_string() }.ok().map(PathBuf::from);
    // SAFETY: allocated by SHGetKnownFolderPath with CoTaskMemAlloc, freed once.
    unsafe { CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void)) };
    path.filter(|p| p.is_dir())
}

/// The folder cached in `slot`, else `find()` stored there. The lock is never held while `find` runs: the old
/// one-statement form (`slot.lock().clone().or_else(|| { *slot.lock() = .. })`) kept the first guard alive to the
/// end of the statement and the second lock deadlocked the whole tick thread (VM run 2, `ea09c27d`).
pub fn cached_folder(slot: &parking_lot::Mutex<Option<PathBuf>>, find: impl FnOnce() -> Option<PathBuf>) -> Option<PathBuf> {
    let cached = slot.lock().clone();
    cached.or_else(|| {
        let found = find();
        *slot.lock() = found.clone();
        found
    })
}

/// Plain files directly in `dir` as (name, size). A folder, a link to a folder, a name that is not Unicode: skipped.
/// At most `LIMIT` entries are looked at, so a folder with a huge pile never costs more than a few milliseconds.
pub fn list(dir: &Path) -> Vec<(String, u64)> {
    const LIMIT: usize = 20_000;
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        .take(LIMIT)
        .filter_map(|e| {
            let meta = e.metadata().ok().filter(std::fs::Metadata::is_file)?;
            Some((e.file_name().into_string().ok()?, meta.len()))
        })
        .collect()
}

/// Explorer with the file selected. `path` is a file Notch listed itself (no quote can be in a Windows file name).
#[cfg(windows)]
pub fn show_in_folder(path: &Path) -> bool {
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let Some(explorer) = windows_dir().map(|d| format!("{d}\\explorer.exe")) else { return false };
    let (exe, args) = (crate::to_wide(&explorer), crate::to_wide(&format!("/select,\"{}\"", path.display())));
    // SAFETY: NUL-terminated wide strings that outlive the call; a full path, not a PATH search; > 32 = success.
    let r = unsafe {
        ShellExecuteW(None, w!("open"), PCWSTR(exe.as_ptr()), PCWSTR(args.as_ptr()), PCWSTR::null(), SW_SHOWNORMAL)
    };
    r.0 as isize > 32
}

/// `C:\Windows` from `GetWindowsDirectoryW` (not `%SystemRoot%`, which any parent process can set).
#[cfg(windows)]
pub(crate) fn windows_dir() -> Option<String> {
    use windows::Win32::System::SystemInformation::GetWindowsDirectoryW;
    let mut buf = [0u16; 260];
    // SAFETY: the buffer is ours; the call writes at most its length.
    let n = unsafe { GetWindowsDirectoryW(Some(&mut buf)) } as usize;
    (n > 0 && n < buf.len()).then(|| crate::wide_to_string(&buf[..n]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_cache_never_holds_its_lock_while_finding() {
        use std::sync::{mpsc, Arc};
        let slot = Arc::new(parking_lot::Mutex::new(None));
        let (tx, rx) = mpsc::channel();
        let s = Arc::clone(&slot);
        std::thread::spawn(move || {
            let first = cached_folder(&s, || {
                assert!(s.try_lock().is_some(), "the lock is free while the folder is looked up");
                Some(PathBuf::from("D"))
            });
            let second = cached_folder(&s, || panic!("cached: not looked up again"));
            let _ = tx.send((first, second));
        });
        // The old one-statement form deadlocks here instead of answering.
        let got = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("cached_folder deadlocked");
        assert_eq!(got, (Some(PathBuf::from("D")), Some(PathBuf::from("D"))));
        assert_eq!(*slot.lock(), Some(PathBuf::from("D")));
    }

    #[test]
    fn a_listing_gives_plain_files_with_sizes_and_skips_folders() {
        let dir = std::env::temp_dir().join(format!("notch-dl-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), b"abc").unwrap();
        let mut got = list(&dir);
        got.sort();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(got, vec![("a.txt".to_string(), 3)]);
        assert!(list(&dir.join("missing")).is_empty());
    }

    /// Real machine, by hand: `cargo test -p notch-win --lib -- --ignored live_downloads`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_downloads_folder_is_found() {
        let d = folder().expect("Downloads folder");
        eprintln!("{} files in {}", list(&d).len(), d.display());
    }
}
