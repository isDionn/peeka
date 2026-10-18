//! The Start panel's app list: every `.lnk` under the two Start Menu "Programs" folders (all users, this user),
//! junk names dropped (`notch_core::apps::keep_start_name`), one per name.
//! The shortcut's target exe is read (`IShellLinkW`) only for the
//! shortcut-exception list. shortcut: Store apps without a Start Menu `.lnk` are missing; Wave 2 can enumerate
//! `shell:AppsFolder` instead.

use std::path::{Path, PathBuf};

use notch_core::apps::{exe_name, keep_start_name, ListedApp};

/// How deep a Start Menu folder is walked (real ones are 2-3 levels).
const MAX_DEPTH: usize = 6;

/// The "Programs" folders that exist.
pub fn roots() -> Vec<PathBuf> {
    ["ProgramData", "APPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|b| PathBuf::from(b).join("Microsoft\\Windows\\Start Menu\\Programs"))
        .filter(|p| p.is_dir())
        .collect()
}

/// Every `.lnk` under `root` (a broken folder loses only itself).
pub fn walk(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(dir) = std::fs::read_dir(root) else { return };
    for e in dir.flatten() {
        let path = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() && depth < MAX_DEPTH => walk(&path, depth + 1, out),
            Ok(t) if t.is_file() && path.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) => out.push(path),
            _ => {}
        }
    }
}

/// Shortcut files -> the list, sorted by name, one per (case-folded) name. `target` reads a shortcut's exe path.
pub fn to_list(lnks: Vec<PathBuf>, target: impl Fn(&Path) -> Option<String>) -> Vec<ListedApp> {
    let mut list: Vec<ListedApp> = Vec::new();
    for lnk in lnks {
        let Some(name) = lnk.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if !keep_start_name(&name) || list.iter().any(|a| a.name.to_lowercase() == name.to_lowercase()) {
            continue;
        }
        let exe = target(&lnk).map(|t| exe_name(&t)).filter(|e| e.ends_with(".exe"));
        list.push(ListedApp { app_id: format!("lnk:{}", lnk.display()), name, exe });
    }
    list.sort_by_key(|a| notch_core::apps::fold(&a.name));
    list
}

/// The whole list. Needs COM on the calling thread.
#[cfg(windows)]
pub fn scan() -> Vec<ListedApp> {
    let mut lnks = Vec::new();
    for root in roots() {
        walk(&root, 0, &mut lnks);
    }
    to_list(lnks, target)
}

/// A shortcut's target path (`IShellLinkW::GetPath`, raw); None for a non-file target (Store app, URL).
#[cfg(windows)]
pub fn target(lnk: &Path) -> Option<String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_RAWPATH};

    let path = crate::to_wide(&lnk.to_string_lossy());
    // SAFETY: plain COM calls on objects released on drop; the path buffer outlives Load; GetPath writes into `buf`.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        link.cast::<IPersistFile>().ok()?.Load(PCWSTR(path.as_ptr()), STGM_READ).ok()?;
        let mut buf = [0u16; 1024];
        link.GetPath(&mut buf, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32).ok()?;
        Some(crate::wide_to_string(&buf)).filter(|s| !s.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn junk_dropped_one_per_name_sorted_and_exe_kept_only_for_exes() {
        let lnks = ["Zoom.lnk", "Uninstall Zoom.lnk", "code\\Visual Studio Code.lnk", "zoom.lnk", "Site.lnk"]
            .iter()
            .map(|p| PathBuf::from("C:\\SM").join(p))
            .collect();
        let list = to_list(lnks, |p| match p.file_stem()?.to_str()? {
            "Visual Studio Code" => Some("C:\\VS\\Code.exe".into()),
            "Site" => Some("https://x".into()),
            _ => None,
        });
        let shape: Vec<_> = list.iter().map(|a| (a.name.as_str(), a.exe.as_deref())).collect();
        assert_eq!(shape, [("Site", None), ("Visual Studio Code", Some("code.exe")), ("Zoom", None)]);
        assert!(list[1].app_id.starts_with("lnk:C:\\SM\\code\\") && list[1].app_id.ends_with(".lnk"));
    }
}
